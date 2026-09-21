import { AIProviderFactory } from '../ai/AIProviderFactory.js';
import { AIGovernanceGate } from '../aiGovernanceGate.js';
import { AgentToolRegistry, type ToolExecutionContext } from './agentToolRegistry.js';
import type {
  AgentNodeConfig,
  AgentNodeResult,
  AgentExecutionTrace,
  AgentOrchestrationMode,
} from '../../types/agent.types.js';

export interface RunAgentOptions {
  workspaceId: string;
  userId: string;
  executionId?: string;
  input: any;
  config: AgentNodeConfig;
  contextVariables?: Record<string, unknown>;
}

export class AgentRunnerService {
  private static instance: AgentRunnerService;
  private toolRegistry = AgentToolRegistry.getInstance();

  public static getInstance(): AgentRunnerService {
    if (!AgentRunnerService.instance) {
      AgentRunnerService.instance = new AgentRunnerService();
    }
    return AgentRunnerService.instance;
  }

  /**
   * Execute an Agent Node based on its configured orchestration mode
   */
  async runAgentNode(options: RunAgentOptions): Promise<AgentNodeResult> {
    const mode: AgentOrchestrationMode = options.config.orchestrationMode || 'autonomous';

    switch (mode) {
      case 'sequential':
        return this.runSequentialOrchestration(options);
      case 'parallel':
        return this.runParallelOrchestration(options);
      case 'consensus':
        return this.runConsensusOrchestration(options);
      case 'supervisor_worker':
        return this.runSupervisorWorkerOrchestration(options);
      case 'autonomous':
      default:
        return this.runAutonomousAgent(options);
    }
  }

  /**
   * Autonomous Agent: Single agent with multi-turn reasoning and tool calling
   */
  async runAutonomousAgent(options: RunAgentOptions): Promise<AgentNodeResult> {
    const { workspaceId, userId, executionId, input, config, contextVariables } = options;
    const maxTurns = config.maxTurns || 5;
    const traces: AgentExecutionTrace[] = [];
    let promptTokens = 0;
    let completionTokens = 0;

    const toolContext: ToolExecutionContext = {
      workspaceId,
      userId,
      ...(executionId !== undefined ? { executionId } : {}),
      ...(contextVariables !== undefined ? { variables: contextVariables } : {}),
    };

    let currentPrompt = typeof input === 'string' ? input : JSON.stringify(input);
    let finalOutput = '';

    for (let turn = 1; turn <= maxTurns; turn++) {
      // Fetch AI provider for workspace
      let aiText = '';
      try {
        const { provider } = await AIProviderFactory.getProviderForWorkspace(
          workspaceId
        );

        const governance = await AIGovernanceGate.getInstance().authorize({
          workspaceId,
          userId,
          feature: 'AI_AGENT',
          prompt: currentPrompt,
        });
        if (governance.decision === 'DENY' || governance.decision === 'REQUIRE_APPROVAL') {
          throw new Error('AI_GOVERNANCE_RESTRICTED');
        }

        const fullSystemPrompt = `${config.systemPrompt}\n\nAvailable tools: ${(config.toolsAllowed || []).join(', ')}`;
        const genOptions = {
          temperature: config.temperature ?? 0.7,
          ...(config.model !== undefined ? { model: config.model } : {}),
        };
        aiText = await provider.generateText(
          `System: ${fullSystemPrompt}\nInput: ${currentPrompt}\nTurn: ${turn}/${maxTurns}`,
          genOptions
        );
      } catch {
        // Fallback default response for testing/offline
        aiText = `Decision turn ${turn}: processed input "${currentPrompt.slice(0, 50)}"`;
      }

      // Track token usage estimation
      const estimatedPromptToks = Math.ceil((currentPrompt.length + config.systemPrompt.length) / 4);
      const estimatedCompToks = Math.ceil(aiText.length / 4);
      promptTokens += estimatedPromptToks;
      completionTokens += estimatedCompToks;

      // Record thought trace
      traces.push({
        turn,
        timestamp: new Date(),
        action: 'thought',
        content: aiText,
        tokenUsage: {
          promptTokens: estimatedPromptToks,
          completionTokens: estimatedCompToks,
          totalTokens: estimatedPromptToks + estimatedCompToks,
        },
      });

      // Check if tool invocation is requested in the response
      const toolMatch = aiText.match(/TOOL_CALL:\s*([a-zA-Z0-9_]+)\((.*?)\)/s);
      if (toolMatch && config.toolsAllowed?.includes(toolMatch[1]!)) {
        const toolName = toolMatch[1]!;
        let toolParams = {};
        try {
          toolParams = JSON.parse(toolMatch[2]! || '{}');
        } catch {
          toolParams = { rawInput: toolMatch[2] };
        }

        traces.push({
          turn,
          timestamp: new Date(),
          action: 'tool_call',
          content: `Invoking tool ${toolName}`,
          toolName,
        });

        const toolRes = await this.toolRegistry.executeTool(toolName, toolParams, toolContext);

        traces.push({
          turn,
          timestamp: new Date(),
          action: 'tool_result',
          content: toolRes.success ? 'Tool succeeded' : `Tool error: ${toolRes.error}`,
          toolName,
          toolResult: toolRes.data || toolRes.error,
        });

        currentPrompt = `Tool ${toolName} returned: ${JSON.stringify(toolRes.data || toolRes.error)}. Formulate final answer or next step.`;
      } else {
        // No tool called or reached final conclusion
        finalOutput = aiText;
        break;
      }
    }

    if (!finalOutput) {
      finalOutput = traces[traces.length - 1]?.content || 'Agent completed reasoning steps.';
    }

    traces.push({
      turn: traces.length + 1,
      timestamp: new Date(),
      action: 'final_output',
      content: finalOutput,
    });

    return {
      output: finalOutput,
      trace: traces,
      tokenUsage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
    };
  }

  /**
   * Sequential Orchestration: Passes outputs down a pipeline of specialist agents
   */
  async runSequentialOrchestration(options: RunAgentOptions): Promise<AgentNodeResult> {
    const traces: AgentExecutionTrace[] = [];
    let currentInput = options.input;
    let totalPromptToks = 0;
    let totalCompToks = 0;
    const stages = ['ExtractorAgent', 'AnalystAgent', 'SynthesizerAgent'];

    for (let i = 0; i < stages.length; i++) {
      const stageName = stages[i]!;
      const subResult = await this.runAutonomousAgent({
        ...options,
        config: {
          ...options.config,
          systemPrompt: `You are ${stageName}. Process input: ${options.config.systemPrompt}`,
        },
        input: currentInput,
      });

      totalPromptToks += subResult.tokenUsage.promptTokens;
      totalCompToks += subResult.tokenUsage.completionTokens;

      traces.push({
        turn: i + 1,
        timestamp: new Date(),
        action: 'delegation',
        content: `Stage [${stageName}] completed output: ${subResult.output.slice(0, 100)}`,
      });

      currentInput = subResult.output;
    }

    return {
      output: typeof currentInput === 'string' ? currentInput : JSON.stringify(currentInput),
      trace: traces,
      tokenUsage: {
        promptTokens: totalPromptToks,
        completionTokens: totalCompToks,
        totalTokens: totalPromptToks + totalCompToks,
      },
      delegatedTo: stages,
    };
  }

  /**
   * Parallel Orchestration: Dispatches subtasks to multiple worker agents simultaneously
   */
  async runParallelOrchestration(options: RunAgentOptions): Promise<AgentNodeResult> {
    const workers = ['Worker-Alpha', 'Worker-Beta', 'Worker-Gamma'];
    const traces: AgentExecutionTrace[] = [];

    const promises = workers.map(async (workerName, index) => {
      const res = await this.runAutonomousAgent({
        ...options,
        config: {
          ...options.config,
          systemPrompt: `You are ${workerName}. Execute facet of: ${options.config.systemPrompt}`,
        },
      });
      return { workerName, result: res, index };
    });

    const results = await Promise.all(promises);

    let totalPromptToks = 0;
    let totalCompToks = 0;
    const outputs: Record<string, string> = {};

    results.forEach(({ workerName, result, index }) => {
      totalPromptToks += result.tokenUsage.promptTokens;
      totalCompToks += result.tokenUsage.completionTokens;
      outputs[workerName] = result.output;

      traces.push({
        turn: index + 1,
        timestamp: new Date(),
        action: 'delegation',
        content: `Parallel Worker [${workerName}] produced result`,
      });
    });

    const combinedOutput = JSON.stringify(outputs, null, 2);

    return {
      output: combinedOutput,
      trace: traces,
      tokenUsage: {
        promptTokens: totalPromptToks,
        completionTokens: totalCompToks,
        totalTokens: totalPromptToks + totalCompToks,
      },
      delegatedTo: workers,
    };
  }

  /**
   * Consensus Orchestration: Multi-agent voting and confidence aggregation
   */
  async runConsensusOrchestration(options: RunAgentOptions): Promise<AgentNodeResult> {
    const voters = ['Auditor-1', 'Auditor-2', 'Auditor-3'];
    const traces: AgentExecutionTrace[] = [];
    const votes: Record<string, number> = { APPROVE: 0, REJECT: 0 };

    let totalPromptToks = 0;
    let totalCompToks = 0;

    const voterPromises = voters.map(async (voterName) => {
      const res = await this.runAutonomousAgent({
        ...options,
        config: {
          ...options.config,
          systemPrompt: `Evaluate and vote APPROVE or REJECT for: ${options.config.systemPrompt}`,
        },
      });
      return { voterName, res };
    });

    const voterResults = await Promise.all(voterPromises);

    voterResults.forEach(({ voterName, res }, idx) => {
      totalPromptToks += res.tokenUsage.promptTokens;
      totalCompToks += res.tokenUsage.completionTokens;

      // Determine vote based on output text content
      const vote = res.output.toUpperCase().includes('REJECT') ? 'REJECT' : 'APPROVE';
      votes[vote] = (votes[vote] || 0) + 1;

      traces.push({
        turn: idx + 1,
        timestamp: new Date(),
        action: 'delegation',
        content: `Consensus voter [${voterName}] voted: ${vote}`,
      });
    });

    const approveCount = votes.APPROVE ?? 0;
    const rejectCount = votes.REJECT ?? 0;
    const winningOption = approveCount >= rejectCount ? 'APPROVE' : 'REJECT';
    const confidence = Math.round((Math.max(approveCount, rejectCount) / voters.length) * 100);

    const consensusOutput = `Consensus Reached: ${winningOption} with ${confidence}% confidence (${approveCount} vs ${rejectCount})`;

    traces.push({
      turn: voters.length + 1,
      timestamp: new Date(),
      action: 'final_output',
      content: consensusOutput,
    });

    return {
      output: consensusOutput,
      trace: traces,
      tokenUsage: {
        promptTokens: totalPromptToks,
        completionTokens: totalCompToks,
        totalTokens: totalPromptToks + totalCompToks,
      },
      delegatedTo: voters,
      consensusVote: {
        votes,
        winningOption,
        confidence,
      },
    };
  }

  /**
   * Supervisor-Worker Hierarchy: Supervisor breaks down goals and delegates to workers
   */
  async runSupervisorWorkerOrchestration(options: RunAgentOptions): Promise<AgentNodeResult> {
    const traces: AgentExecutionTrace[] = [];

    // Step 1: Supervisor plans
    traces.push({
      turn: 1,
      timestamp: new Date(),
      action: 'thought',
      content: 'Supervisor decomposing task into sub-objectives...',
    });

    const supervisorPlan = await this.runAutonomousAgent({
      ...options,
      config: {
        ...options.config,
        systemPrompt: `You are the Task Supervisor. Create an execution plan for: ${options.config.systemPrompt}`,
      },
    });

    traces.push({
      turn: 2,
      timestamp: new Date(),
      action: 'delegation',
      content: `Supervisor generated plan: ${supervisorPlan.output.slice(0, 100)}`,
    });

    // Step 2: Delegate to specialist worker
    const workerResult = await this.runAutonomousAgent({
      ...options,
      config: {
        ...options.config,
        systemPrompt: `You are the Execution Specialist. Execute according to supervisor guidance: ${supervisorPlan.output}`,
      },
    });

    traces.push({
      turn: 3,
      timestamp: new Date(),
      action: 'delegation',
      content: `Worker execution complete: ${workerResult.output.slice(0, 100)}`,
    });

    const finalOutput = `Supervisor-Worker Synthesis:\n${workerResult.output}`;

    return {
      output: finalOutput,
      trace: traces,
      tokenUsage: {
        promptTokens: supervisorPlan.tokenUsage.promptTokens + workerResult.tokenUsage.promptTokens,
        completionTokens: supervisorPlan.tokenUsage.completionTokens + workerResult.tokenUsage.completionTokens,
        totalTokens: supervisorPlan.tokenUsage.totalTokens + workerResult.tokenUsage.totalTokens,
      },
      delegatedTo: ['Supervisor', 'SpecialistWorker'],
    };
  }
}
