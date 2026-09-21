import { Types } from 'mongoose';
import { AgentToolRegistry } from './agentToolRegistry.js';
import { defaultToolPolicy, type ToolPolicy } from './agentToolInvocation.js';
import { AgentToolPolicyModel } from '../../models/AgentToolPolicyModel.js';

export interface ToolPolicyEntry {
  toolName: string;
  policy: ToolPolicy;
  updatedBy?: string;
}

// Cache-first reads with persisted workspace overrides (Phase 12.6).
// Defaults come from defaultToolPolicy (dangerous tools REQUIRE_APPROVAL).
const overrides = new Map<string, Map<string, ToolPolicyEntry>>();
const hydrated = new Set<string>();

function workspacePolicies(workspaceId: string): Map<string, ToolPolicyEntry> {
  let map = overrides.get(workspaceId);
  if (!map) {
    map = new Map();
    overrides.set(workspaceId, map);
  }
  return map;
}

export class AgentToolPolicyService {
  private static instance: AgentToolPolicyService;
  public static getInstance(): AgentToolPolicyService {
    if (!AgentToolPolicyService.instance) AgentToolPolicyService.instance = new AgentToolPolicyService();
    return AgentToolPolicyService.instance;
  }

  private async ensureHydrated(workspaceId: string): Promise<void> {
    if (hydrated.has(workspaceId)) return;
    if (!Types.ObjectId.isValid(workspaceId)) {
      hydrated.add(workspaceId);
      return;
    }
    const docs = await AgentToolPolicyModel.find({ workspaceId: new Types.ObjectId(workspaceId) }).lean();
    const map = workspacePolicies(workspaceId);
    for (const doc of docs) {
      map.set(doc.toolName, {
        toolName: doc.toolName,
        policy: doc.policy,
        ...(doc.updatedBy ? { updatedBy: doc.updatedBy.toString() } : {}),
      });
    }
    hydrated.add(workspaceId);
  }

  getPolicy(workspaceId: string, toolName: string): ToolPolicy {
    const override = workspacePolicies(workspaceId).get(toolName);
    if (override) return override.policy;
    return defaultToolPolicy(toolName);
  }

  async resolvePolicy(workspaceId: string, toolName: string): Promise<ToolPolicy> {
    await this.ensureHydrated(workspaceId);
    return this.getPolicy(workspaceId, toolName);
  }
  async setPolicy(
    workspaceId: string,
    toolName: string,
    policy: ToolPolicy,
    updatedBy?: string,
  ): Promise<ToolPolicyEntry> {
    if (!AgentToolRegistry.getInstance().hasTool(toolName)) throw new Error('TOOL_NOT_FOUND');
    if (policy !== 'ALLOW' && policy !== 'DENY' && policy !== 'REQUIRE_APPROVAL') throw new Error('INVALID_REQUEST');
    const doc: Record<string, unknown> = { workspaceId: new Types.ObjectId(workspaceId), toolName, policy };
    if (updatedBy) doc.updatedBy = new Types.ObjectId(updatedBy);
    await AgentToolPolicyModel.findOneAndUpdate(
      { workspaceId: new Types.ObjectId(workspaceId), toolName },
      doc,
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    const entry: ToolPolicyEntry = { toolName, policy, ...(updatedBy ? { updatedBy } : {}) };
    workspacePolicies(workspaceId).set(toolName, entry);
    hydrated.add(workspaceId);
    return entry;
  }

  async listPolicies(
    workspaceId: string,
  ): Promise<Array<{ toolName: string; policy: ToolPolicy; source: 'DEFAULT' | 'OVERRIDE' }>> {
    await this.ensureHydrated(workspaceId);
    const tools = AgentToolRegistry.getInstance().listTools();
    const map = workspacePolicies(workspaceId);
    return tools.map((t) => {
      const override = map.get(t.name);
      if (override) return { toolName: t.name, policy: override.policy, source: 'OVERRIDE' as const };
      return { toolName: t.name, policy: defaultToolPolicy(t.name), source: 'DEFAULT' as const };
    });
  }

  /** Test helper: clear cached and hydrated state for a workspace. */
  clearWorkspace(workspaceId: string): void {
    overrides.delete(workspaceId);
    hydrated.delete(workspaceId);
  }
}