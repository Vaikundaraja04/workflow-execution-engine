import apiClient from '@/lib/apiClient';
import type {
  Agent,
  AgentRun,
  AgentMemory,
  ApprovalRequest,
  CreateAgentInput,
  UpdateAgentInput,
  ToolPolicy,
  ToolPolicyEntry,
  StructuredToolInvocation,
  AgentTestResponse,
} from '@/types/agent';

function wsHeaders(workspaceId: string) {
  return { headers: { 'X-Workspace-Id': workspaceId } };
}

function normalizeId<T extends { _id?: string; id?: string }>(doc: T): T & { id: string } {
  if (doc && typeof doc === 'object') {
    const _id = (doc as { _id?: string })._id;
    if (_id) (doc as { id?: string }).id = _id;
  }
  return doc as T & { id: string };
}

function normalizeList<T extends { _id?: string; id?: string }>(docs: T[]): (T & { id: string })[] {
  return docs.map(normalizeId);
}

export const agentApi = {
    listAgents: (workspaceId: string) =>
    apiClient.get('/api/v1/agents', wsHeaders(workspaceId)).then((res) => normalizeList(res.data.data as Agent[])),

  /** Get a single agent by ID */
  getAgent: (workspaceId: string, id: string) =>
    apiClient.get(`/api/v1/agents/${id}`, wsHeaders(workspaceId)).then((res) => normalizeId(res.data.data as Agent)),

  /** Create a new agent */
  createAgent: (workspaceId: string, input: CreateAgentInput) =>
    apiClient.post('/api/v1/agents', input, wsHeaders(workspaceId)).then((res) => normalizeId(res.data.data as Agent)),

  /** Update an existing agent */
  updateAgent: (workspaceId: string, id: string, input: UpdateAgentInput) =>
    apiClient.put(`/api/v1/agents/${id}`, input, wsHeaders(workspaceId)).then((res) => normalizeId(res.data.data as Agent)),

  /** Delete an agent */
  deleteAgent: (workspaceId: string, id: string) =>
    apiClient.delete(`/api/v1/agents/${id}`, wsHeaders(workspaceId)).then((res) => res.data),

  /** Test (execute) an agent with structured tool invocation or free-form input */
  testAgent: (
    workspaceId: string,
    id: string,
    body: { input?: unknown; invocation?: StructuredToolInvocation | string },
  ) =>
    apiClient
      .post(`/api/v1/agents/${id}/test`, body, wsHeaders(workspaceId))
      .then((res) => res.data.data as AgentTestResponse),

  /** List execution runs for an agent */
    listRuns: (workspaceId: string, id: string) =>
    apiClient.get(`/api/v1/agents/${id}/runs`, wsHeaders(workspaceId)).then((res) => normalizeList(res.data.data as AgentRun[])),

  /** Get agent memory entries */
  listMemory: (workspaceId: string, id: string) =>
    apiClient.get(`/api/v1/agents/${id}/memory`, wsHeaders(workspaceId)).then((res) => normalizeList(res.data.data as AgentMemory[])),

  /** List tool policies for the workspace */
  listToolPolicies: (workspaceId: string, agentId: string) =>
    apiClient
      .get(`/api/v1/agents/${agentId}/tools/policies`, wsHeaders(workspaceId))
      .then((res) => res.data.data as ToolPolicyEntry[]),

  /** Set a tool policy override */
  setToolPolicy: (workspaceId: string, agentId: string, toolName: string, policy: ToolPolicy, updatedBy?: string) =>
    apiClient
      .put(
        `/api/v1/agents/${agentId}/tools/policies`,
        { toolName, policy, updatedBy },
        wsHeaders(workspaceId),
      )
      .then((res) => res.data.data as ToolPolicyEntry),

  /** List the approval queue for the workspace */
  listApprovals: (workspaceId: string, status?: string) =>
    apiClient
      .get(`/api/v1/agents/approvals/queue`, {
        headers: { 'X-Workspace-Id': workspaceId },
        params: status ? { status } : undefined,
      })
            .then((res) => normalizeList(res.data.data as ApprovalRequest[])),

  /** Approve or reject a pending approval */
  resolveApproval: (
    workspaceId: string,
    agentId: string,
    approvalId: string,
    decision: 'APPROVE' | 'REJECT',
    reason?: string,
  ) =>
    apiClient
      .post(
        `/api/v1/agents/${agentId}/approve`,
        { approvalId, decision, reason },
        wsHeaders(workspaceId),
      )
      .then((res) => res.data.data as { approval: ApprovalRequest; run: AgentRun | null }),
};
