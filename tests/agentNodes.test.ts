import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { AgentToolRegistry } from '../src/services/agent/agentToolRegistry.js';
import { AgentRunnerService } from '../src/services/agent/agentRunnerService.js';
import { executeWorkflow } from '../src/engine/executeWorkflow.js';
import type { WorkflowDefinition } from '../src/types/workflow.js';

describe('Module 12B — AI Agent Node & Multi-Agent Orchestration Framework', () => {
  const toolRegistry = AgentToolRegistry.getInstance();
  const agentRunner = AgentRunnerService.getInstance();
  const workspaceId = 'test-workspace-agent';
  const userId = 'test-user-agent';

  it('should list all built-in tools in the AgentToolRegistry', () => {
    const tools = toolRegistry.listTools();
    const toolNames = tools.map((t) => t.name);

    expect(toolNames).toContain('http_request');
    expect(toolNames).toContain('database_query');
    expect(toolNames).toContain('workflow_trigger');
    expect(toolNames).toContain('calculate');
    expect(toolNames).toContain('summarize');
    expect(toolNames).toContain('json_transform');
  });

  it('should execute built-in tools (calculate, http_request, database_query, workflow_trigger, summarize, json_transform)', async () => {
    // 1. Calculate tool
    const calcRes = await toolRegistry.executeTool(
      'calculate',
      { expression: '10 + 20 * 2' },
      { workspaceId, userId }
    );
    expect(calcRes.success).toBe(true);
    expect(calcRes.data).toBe(50);

    // 2. HTTP Request tool
    const httpRes = await toolRegistry.executeTool(
      'http_request',
      { url: 'https://api.example.com/v1/orders', method: 'GET' },
      { workspaceId, userId }
    );
    expect(httpRes.success).toBe(true);
    expect(httpRes.data.status).toBe(200);

    // 3. Database Query tool
    const dbRes = await toolRegistry.executeTool(
      'database_query',
      { connectionId: 'postgres-prod', query: 'SELECT * FROM users' },
      { workspaceId, userId }
    );
    expect(dbRes.success).toBe(true);
    expect(Array.isArray(dbRes.data)).toBe(true);

    // 4. Workflow Trigger tool
    const wfRes = await toolRegistry.executeTool(
      'workflow_trigger',
      { workflowId: 'wf-12345', waitForCompletion: true },
      { workspaceId, userId }
    );
    expect(wfRes.success).toBe(true);
    expect(wfRes.data.status).toBe('SUCCEEDED');

    // 5. Summarize tool
    const sumRes = await toolRegistry.executeTool(
      'summarize',
      { text: 'Enterprise autonomous operations engine executing closed-loop workflows with high confidence and automated safety boundaries.', format: 'paragraph' },
      { workspaceId, userId }
    );
    expect(sumRes.success).toBe(true);
    expect(typeof sumRes.data).toBe('string');

    // 6. JSON Transform tool
    const jsonRes = await toolRegistry.executeTool(
      'json_transform',
      { input: { key: 'value' }, transformation: 'toArray' },
      { workspaceId, userId }
    );
    expect(jsonRes.success).toBe(true);
    expect(Array.isArray(jsonRes.data)).toBe(true);
  });

  it('should allow registering and executing custom workspace tools', async () => {
    toolRegistry.registerTool({
      name: 'sentiment_analyzer',
      description: 'Analyzes user feedback sentiment',
      inputSchema: z.object({ feedback: z.string() }),
      execute: async (input: { feedback: string }) => {
        const sentiment = input.feedback.includes('great') ? 'POSITIVE' : 'NEUTRAL';
        return { success: true, data: { sentiment, score: 0.95 } };
      },
    });

    expect(toolRegistry.hasTool('sentiment_analyzer')).toBe(true);

    const customRes = await toolRegistry.executeTool(
      'sentiment_analyzer',
      { feedback: 'This engine is great and reliable!' },
      { workspaceId, userId }
    );

    expect(customRes.success).toBe(true);
    expect(customRes.data.sentiment).toBe('POSITIVE');
  });

  it('should run an autonomous agent with reasoning turns and trace recording', async () => {
    const result = await agentRunner.runAgentNode({
      workspaceId,
      userId,
      input: { task: 'Calculate quarterly revenue growth and summarize findings' },
      config: {
        systemPrompt: 'You are an autonomous financial analyst assistant.',
        toolsAllowed: ['calculate', 'summarize'],
        maxTurns: 3,
        temperature: 0.5,
        orchestrationMode: 'autonomous',
      },
    });

    expect(result).toBeDefined();
    expect(result.output).toBeDefined();
    expect(result.trace.length).toBeGreaterThan(0);
    expect(result.tokenUsage.totalTokens).toBeGreaterThan(0);
    expect(result.trace.some((t) => t.action === 'thought' || t.action === 'final_output')).toBe(true);
  });

  it('should execute multi-agent sequential handoff orchestration', async () => {
    const result = await agentRunner.runAgentNode({
      workspaceId,
      userId,
      input: 'Customer support ticket: payment gateway timeout',
      config: {
        systemPrompt: 'Resolve incident',
        orchestrationMode: 'sequential',
      },
    });

    expect(result).toBeDefined();
    expect(result.delegatedTo).toEqual(['ExtractorAgent', 'AnalystAgent', 'SynthesizerAgent']);
    expect(result.trace.some((t) => t.action === 'delegation')).toBe(true);
  });

  it('should execute multi-agent parallel delegation orchestration', async () => {
    const result = await agentRunner.runAgentNode({
      workspaceId,
      userId,
      input: 'Audit log security scan',
      config: {
        systemPrompt: 'Perform security compliance check',
        orchestrationMode: 'parallel',
      },
    });

    expect(result).toBeDefined();
    expect(result.delegatedTo).toEqual(['Worker-Alpha', 'Worker-Beta', 'Worker-Gamma']);
    expect(result.trace.filter((t) => t.action === 'delegation').length).toBe(3);
  });

  it('should execute multi-agent consensus voting orchestration', async () => {
    const result = await agentRunner.runAgentNode({
      workspaceId,
      userId,
      input: { policyChange: 'Increase rate limit threshold to 1000 RPM' },
      config: {
        systemPrompt: 'Review rate limit policy',
        orchestrationMode: 'consensus',
      },
    });

    expect(result).toBeDefined();
    expect(result.consensusVote).toBeDefined();
    expect(result.consensusVote?.winningOption).toBeDefined();
    expect(result.consensusVote?.confidence).toBeGreaterThan(0);
    expect(result.output).toContain('Consensus Reached:');
  });

  it('should execute multi-agent supervisor-worker hierarchy orchestration', async () => {
    const result = await agentRunner.runAgentNode({
      workspaceId,
      userId,
      input: { data: 'Large dataset migration pipeline' },
      config: {
        systemPrompt: 'Coordinate multi-step data migration',
        orchestrationMode: 'supervisor_worker',
      },
    });

    expect(result).toBeDefined();
    expect(result.delegatedTo).toEqual(['Supervisor', 'SpecialistWorker']);
    expect(result.output).toContain('Supervisor-Worker Synthesis:');
  });

  it('should execute a workflow DAG containing an agent node and transition through ready states', async () => {
    const workflow: WorkflowDefinition = {
      nodes: [
        {
          id: 'trigger',
          type: 'webhook',
          config: {},
        },
        {
          id: 'agent_analyst',
          type: 'agent',
          config: {
            systemPrompt: 'Analyze incoming webhook payload and return diagnostic insights',
            toolsAllowed: ['calculate'],
            maxTurns: 2,
            orchestrationMode: 'autonomous',
          },
        },
        {
          id: 'log_summary',
          type: 'log',
          config: {
            message: 'Agent processing completed successfully',
          },
        },
      ],
      edges: [
        { source: 'trigger', target: 'agent_analyst' },
        { source: 'agent_analyst', target: 'log_summary' },
      ],
    };

    const execution = await executeWorkflow(workflow, {
      workspaceId,
      userId,
      payload: { value: 42 },
    });

    expect(execution.status).toBe('SUCCEEDED');
    expect(execution.stepStatuses['trigger']).toBe('SUCCEEDED');
    expect(execution.stepStatuses['agent_analyst']).toBe('SUCCEEDED');
    expect(execution.stepStatuses['log_summary']).toBe('SUCCEEDED');

    const agentOutput = execution.outputs['agent_analyst'] as any;
    expect(agentOutput).toBeDefined();
    expect(agentOutput.output).toBeDefined();
    expect(agentOutput.trace.length).toBeGreaterThan(0);
    expect(agentOutput.tokenUsage.totalTokens).toBeGreaterThan(0);
  });
});
