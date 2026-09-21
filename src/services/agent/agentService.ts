import { Types } from 'mongoose';
import { AgentModel, type IAgent } from '../../models/AgentModel.js';
import { AgentMemoryModel, type AgentMemoryScope } from '../../models/AgentMemoryModel.js';
import { checkUserPermission } from '../permissionService.js';

export interface CreateAgentInput {
  name: string;
  description?: string;
  systemPrompt: string;
  modelConfig?: {
    provider?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    maxTurns?: number;
  };
  orchestrationMode?: 'autonomous' | 'sequential' | 'parallel' | 'consensus' | 'supervisor_worker';
  toolsAllowed?: string[];
  requiredPermissions?: string[];
  memoryEnabled?: boolean;
  status?: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
}

export type UpdateAgentInput = Partial<CreateAgentInput>;

function toId(value: unknown): Types.ObjectId {
  return new Types.ObjectId(String(value));
}

export class AgentService {
  private static instance: AgentService;
  public static getInstance(): AgentService {
    if (!AgentService.instance) AgentService.instance = new AgentService();
    return AgentService.instance;
  }

  async createAgent(workspaceId: string, userId: string, input: CreateAgentInput): Promise<IAgent> {
    if (!input.name?.trim()) throw new Error('INVALID_REQUEST');
    if (!input.systemPrompt?.trim()) throw new Error('INVALID_REQUEST');
    const createDoc: Record<string, unknown> = {
      workspaceId: toId(workspaceId),
      name: input.name.trim(),
      systemPrompt: input.systemPrompt,
      orchestrationMode: input.orchestrationMode ?? 'autonomous',
      toolsAllowed: input.toolsAllowed ?? [],
      requiredPermissions: input.requiredPermissions ?? [],
      memoryEnabled: input.memoryEnabled ?? false,
      status: input.status ?? 'DRAFT',
      version: 1,
      createdBy: toId(userId),
    };
    if (input.description !== undefined) createDoc.description = input.description;
    const modelConfig: Record<string, unknown> = {
      provider: input.modelConfig?.provider ?? 'mock',
      temperature: input.modelConfig?.temperature ?? 0.7,
      maxTokens: input.modelConfig?.maxTokens ?? 1000,
      maxTurns: input.modelConfig?.maxTurns ?? 5,
    };
    if (input.modelConfig?.model !== undefined) modelConfig.model = input.modelConfig.model;
    createDoc.modelConfig = modelConfig;
    const agent = await AgentModel.create(createDoc);
    return agent;
  }

  async listAgents(workspaceId: string): Promise<IAgent[]> {
    return AgentModel.find({ workspaceId: toId(workspaceId) }).sort({ updatedAt: -1 }) as unknown as Promise<IAgent[]>;
  }

  async getAgent(agentId: string, workspaceId: string): Promise<IAgent | null> {
    if (!Types.ObjectId.isValid(agentId)) throw new Error('INVALID_REQUEST');
    return AgentModel.findOne({ _id: toId(agentId), workspaceId: toId(workspaceId) });
  }

  async updateAgent(agentId: string, workspaceId: string, input: UpdateAgentInput): Promise<IAgent | null> {
    if (!Types.ObjectId.isValid(agentId)) throw new Error('INVALID_REQUEST');
    const agent = await AgentModel.findOne({ _id: toId(agentId), workspaceId: toId(workspaceId) });
    if (!agent) return null;
    if (input.name !== undefined) agent.name = input.name.trim();
    if (input.description !== undefined) agent.description = input.description as string;
    if (input.systemPrompt !== undefined) agent.systemPrompt = input.systemPrompt as string;
          if (input.modelConfig !== undefined) {
        if (input.modelConfig.provider !== undefined) agent.modelConfig.provider = input.modelConfig.provider;
      if (input.modelConfig.model !== undefined) agent.modelConfig.model = input.modelConfig.model;
      if (input.modelConfig.temperature !== undefined) agent.modelConfig.temperature = input.modelConfig.temperature;
      if (input.modelConfig.maxTokens !== undefined) agent.modelConfig.maxTokens = input.modelConfig.maxTokens;
      if (input.modelConfig.maxTurns !== undefined) agent.modelConfig.maxTurns = input.modelConfig.maxTurns;
    }
    if (input.orchestrationMode !== undefined) agent.orchestrationMode = input.orchestrationMode;
    if (input.toolsAllowed !== undefined) agent.toolsAllowed = input.toolsAllowed;
    if (input.requiredPermissions !== undefined) agent.requiredPermissions = input.requiredPermissions;
    if (input.memoryEnabled !== undefined) agent.memoryEnabled = input.memoryEnabled;
    if (input.status !== undefined) agent.status = input.status;
    agent.version += 1;
    await agent.save();
    return agent;
  }

  async deleteAgent(agentId: string, workspaceId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(agentId)) throw new Error('INVALID_REQUEST');
    const res = await AgentModel.deleteOne({ _id: toId(agentId), workspaceId: toId(workspaceId) });
    return res.deletedCount > 0;
  }

  async setMemory(
    agentId: string,
    workspaceId: string,
    scope: AgentMemoryScope,
    key: string,
    value: unknown,
    options: { scopeId?: string; ttlSeconds?: number } = {},
  ): Promise<void> {
    if (!Types.ObjectId.isValid(agentId)) throw new Error('INVALID_REQUEST');
    if (!key?.trim()) throw new Error('INVALID_REQUEST');
    const setDoc: Record<string, unknown> = { value };
    if (options.scopeId !== undefined) setDoc.scopeId = options.scopeId;
    if (options.ttlSeconds !== undefined) setDoc.expiresAt = new Date(Date.now() + options.ttlSeconds * 1000);
    await AgentMemoryModel.findOneAndUpdate(
      { agentId: toId(agentId), workspaceId: toId(workspaceId), scope, key: key.trim() },
      { $set: { ...setDoc, agentId: toId(agentId), workspaceId: toId(workspaceId), scope, key: key.trim() } },
      { upsert: true },
    );
  }

  async listMemory(agentId: string, workspaceId: string) {
    return AgentMemoryModel.find({ agentId: toId(agentId), workspaceId: toId(workspaceId) }).sort({ updatedAt: -1 }).lean();
  }

  async getMemorySnapshot(agentId: string, workspaceId: string, scope?: AgentMemoryScope): Promise<Record<string, unknown>> {
    const filter: Record<string, unknown> = { agentId: toId(agentId), workspaceId: toId(workspaceId) };
    if (scope) filter.scope = scope;
    const docs = await AgentMemoryModel.find({
      ...filter,
      $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: new Date() } }],
    }).lean();
    const out: Record<string, unknown> = {};
    for (const d of docs) out[`${d.scope}:${d.key}`] = d.value;
    return out;
  }

  async assertCanExecuteAgent(workspaceId: string, userId: string): Promise<void> {
    const check = await checkUserPermission(workspaceId, userId, 'AGENT_TOOL_EXECUTE' as never);
    if (check.outcome === 'allow') return;
    const legacy = await checkUserPermission(workspaceId, userId, 'AGENT_EXECUTE');
    if (legacy.outcome !== 'allow') throw new Error('FORBIDDEN');
  }
}
