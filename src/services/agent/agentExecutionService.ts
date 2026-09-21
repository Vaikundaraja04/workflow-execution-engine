import { Types } from 'mongoose';
import { AgentModel } from '../../models/AgentModel.js';
import { AgentRunModel } from '../../models/AgentRunModel.js';
import { AgentRunnerService } from './agentRunnerService.js';
import { AgentService } from './agentService.js';
import { AgentToolPolicyService } from './agentToolPolicyService.js';
import { ApprovalService } from './approvalService.js';
import { AgentToolRegistry } from './agentToolRegistry.js';
import { parseStructuredToolInvocation } from './agentToolInvocation.js';

export interface AgentTestInput {
  input: unknown;
  invocation?: unknown;
}

export class AgentExecutionService {
  private static instance: AgentExecutionService;
  public static getInstance(): AgentExecutionService {
    if (!AgentExecutionService.instance) AgentExecutionService.instance = new AgentExecutionService();
    return AgentExecutionService.instance;
  }

  private runner = AgentRunnerService.getInstance();
  private agents = AgentService.getInstance();
  private policies = AgentToolPolicyService.getInstance();
  private approvals = ApprovalService.getInstance();
  private tools = AgentToolRegistry.getInstance();

  async testAgent(agentId: string, workspaceId: string, userId: string, body: AgentTestInput) {
    const agent = await AgentModel.findOne({
      _id: Types.ObjectId.isValid(agentId) ? new Types.ObjectId(agentId) : agentId,
      workspaceId: new Types.ObjectId(workspaceId),
    });
    if (!agent) throw new Error('AGENT_NOT_FOUND');
    const invocation = parseStructuredToolInvocation(body.invocation);
    const run = await AgentRunModel.create({
      agentId: agent._id,
      workspaceId: agent.workspaceId,
      status: 'RUNNING',
      trace: [],
      toolCalls: [],
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      requestedBy: new Types.ObjectId(userId),
      startedAt: new Date(),
    });
    if (invocation) {
      return this.runStructured(agent as never, run as never, workspaceId, userId, invocation);
    }
    const maxTurns = agent.modelConfig?.maxTurns ?? 5;
        const result = await this.runner.runAgentNode({
      workspaceId,
      userId,
      input: body.input ?? {},
      config: {
        systemPrompt: agent.systemPrompt,
        ...(agent.modelConfig?.model !== undefined ? { model: agent.modelConfig.model } : {}),
        toolsAllowed: agent.toolsAllowed,
        maxTurns,
        temperature: agent.modelConfig?.temperature ?? 0.7,
        memoryEnabled: agent.memoryEnabled,
        orchestrationMode: agent.orchestrationMode as never,
      },
    });
    run.trace.push(...(result.trace as never[]));
    (run as { tokenUsage: unknown }).tokenUsage = result.tokenUsage;
    run.output = result.output;
    run.status = 'SUCCEEDED';
    run.completedAt = new Date();
    await run.save();
    if (agent.memoryEnabled) {
      await this.agents.setMemory(agent._id.toString(), workspaceId, 'WORKSPACE', 'last_output', result.output, {});
    }
    return run;
  }

  private async runStructured(
    agent: { _id: Types.ObjectId; toolsAllowed?: string[] },
    run: {
      trace: Array<never>; toolCalls: Array<never>; status: string;
      output?: string; completedAt?: Date; save: () => Promise<unknown>;
      _id: Types.ObjectId;
    },
    workspaceId: string,
    userId: string,
    invocation: { toolName: string; arguments: Record<string, unknown> },
  ) {
    const { toolName, arguments: args } = invocation;
    const trace = (e: Record<string, unknown>) => {
      run.trace.push({ turn: run.trace.length + 1, timestamp: new Date(), action: 'thought', content: '', ...e } as never);
    };
    if (agent.toolsAllowed && agent.toolsAllowed.length > 0 && !agent.toolsAllowed.includes(toolName)) {
      run.toolCalls.push({ toolName, args, status: 'DENIED', error: 'TOOL_NOT_ALLOWED' } as never);
      trace({ action: 'tool_result', content: `Tool ${toolName} is not allowed`, toolName });
      run.status = 'FAILED';
      run.output = `Tool ${toolName} is not allowed for this agent`;
      run.completedAt = new Date();
      await run.save();
      throw new Error('TOOL_NOT_ALLOWED');
    }
    const policy = await this.policies.resolvePolicy(workspaceId, toolName);
    trace({ action: 'tool_call', content: `Invoking tool ${toolName} (policy=${policy})`, toolName });
    if (policy === 'DENY') {
      run.toolCalls.push({ toolName, args, status: 'DENIED', error: 'TOOL_DENIED_BY_POLICY' } as never);
      run.status = 'FAILED';
      run.output = `Tool ${toolName} denied by policy`;
      run.completedAt = new Date();
      await run.save();
      throw new Error('TOOL_DENIED_BY_POLICY');
    }
    if (policy === 'REQUIRE_APPROVAL') {
      const approval = await this.approvals.requestApproval(workspaceId, userId, {
        resourceType: 'AGENT_TOOL',
        resourceId: `${run._id.toString()}:${toolName}`,
        action: `agent.tool.${toolName}`,
        payload: { runId: run._id.toString(), toolName, arguments: args },
        ttlSeconds: 24 * 3600,
      });
      run.toolCalls.push({ toolName, args, status: 'REQUIRES_APPROVAL', approvalId: approval._id } as never);
      trace({ action: 'approval_requested', content: `Approval required for ${toolName}`, toolName });
      run.status = 'WAITING_APPROVAL';
      await run.save();
      return { run, approval, approvalRequired: true };
    }
    const toolRes = await this.tools.executeTool(toolName, args, { workspaceId, userId });
    run.toolCalls.push({
      toolName, args, status: toolRes.success ? 'SUCCEEDED' : 'FAILED',
      result: toolRes.data, error: toolRes.error, executedAt: new Date(),
    } as never);
    trace({
      action: 'tool_result', content: toolRes.success ? 'Tool succeeded' : `Tool error: ${toolRes.error}`,
      toolName, toolResult: toolRes.data ?? toolRes.error,
    });
    run.output = JSON.stringify(toolRes.data ?? toolRes.error ?? null);
    run.status = toolRes.success ? 'SUCCEEDED' : 'FAILED';
    run.completedAt = new Date();
    await run.save();
    return { run, toolResult: toolRes, approvalRequired: false };
  }

  async resolveApproval(approvalId: string, workspaceId: string, approverId: string, decision: 'APPROVE' | 'REJECT', reason?: string) {
    const approval = decision === 'APPROVE'
      ? await this.approvals.approve(approvalId, workspaceId, approverId, reason)
      : await this.approvals.reject(approvalId, workspaceId, approverId, reason);
    const pendingRun = await AgentRunModel.findOne({
      workspaceId: new Types.ObjectId(workspaceId),
      status: 'WAITING_APPROVAL',
      'toolCalls.approvalId': approval._id,
    });
    if (!pendingRun) return { approval, run: null };
    const call = pendingRun.toolCalls.find((c) => String(c.approvalId) === String(approval._id));
    if (decision === 'REJECT') {
      if (call) call.status = 'DENIED';
      pendingRun.trace.push({
        turn: pendingRun.trace.length + 1, timestamp: new Date(), action: 'approval_resolved',
        content: `Approval rejected for ${call?.toolName}`, toolName: call?.toolName,
      } as never);
      pendingRun.status = 'FAILED';
      pendingRun.output = `Tool ${call?.toolName} rejected by approver`;
      pendingRun.completedAt = new Date();
      await pendingRun.save();
      return { approval, run: pendingRun };
    }
    if (call) {
      const toolRes = await this.tools.executeTool(call.toolName, (call.args ?? {}) as Record<string, unknown>, {
        workspaceId, userId: approverId,
      });
      call.status = toolRes.success ? 'SUCCEEDED' : 'FAILED';
            (call as { result?: unknown }).result = toolRes.data;
      if (toolRes.error) call.error = toolRes.error;
      call.executedAt = new Date();
      pendingRun.trace.push({
        turn: pendingRun.trace.length + 1, timestamp: new Date(), action: 'tool_result',
        content: toolRes.success ? 'Tool succeeded after approval' : `Tool error: ${toolRes.error}`,
        toolName: call.toolName, toolResult: (toolRes.data ?? toolRes.error) as never,
      } as never);
      pendingRun.status = toolRes.success ? 'SUCCEEDED' : 'FAILED';
      pendingRun.output = JSON.stringify(toolRes.data ?? toolRes.error ?? null);
      pendingRun.completedAt = new Date();
      await pendingRun.save();
    }
    return { approval, run: pendingRun };
  }
}
