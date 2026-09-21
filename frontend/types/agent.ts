export type AgentStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
export type AgentOrchestrationMode =
  | 'autonomous'
  | 'sequential'
  | 'parallel'
  | 'consensus'
  | 'supervisor_worker';
export type AgentRunStatus = 'PENDING' | 'RUNNING' | 'WAITING_APPROVAL' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
export type ApprovalRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED';
export type ApprovalResourceType = 'AGENT_TOOL' | 'AGENT_RUN' | 'WORKFLOW' | 'POLICY';
export type AgentMemoryScope = 'RUN' | 'WORKFLOW' | 'WORKSPACE';
export type ToolPolicy = 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL';

export interface AgentModelConfig {
  provider?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  maxTurns?: number;
}

export interface StructuredToolInvocation {
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface Agent {
  id: string;
  _id?: string;
  workspaceId: string;
  name: string;
  description?: string;
  systemPrompt: string;
  modelConfig: AgentModelConfig;
  orchestrationMode: AgentOrchestrationMode;
  toolsAllowed: string[];
  requiredPermissions: string[];
  memoryEnabled: boolean;
  status: AgentStatus;
  version: number;
  createdBy: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRunTraceEvent {
  turn: number;
  timestamp: string;
  action: 'thought' | 'tool_call' | 'tool_result' | 'delegation' | 'final_output' | 'approval_requested' | 'approval_resolved';
  content: string;
  toolName?: string;
  toolResult?: unknown;
}

export interface AgentRunToolCall {
  toolName: string;
  args: Record<string, unknown>;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REQUIRES_APPROVAL' | 'DENIED';
  result?: unknown;
  error?: string;
  approvalId?: string;
  executedAt?: string;
}

export interface AgentRun {
  id: string;
  _id?: string;
  agentId: string;
  executionId?: string;
  workspaceId: string;
  status: AgentRunStatus;
  trace: AgentRunTraceEvent[];
  toolCalls: AgentRunToolCall[];
  tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number };
  output?: string;
  requestedBy: string;
  startedAt: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentMemory {
  id: string;
  _id?: string;
  agentId: string;
  workspaceId: string;
  scope: AgentMemoryScope;
  scopeId?: string;
  key: string;
  value: unknown;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalRequest {
  id: string;
  _id?: string;
  workspaceId: string;
  requestedBy: string;
  resourceType: ApprovalResourceType;
  resourceId: string;
  action: string;
  status: ApprovalRequestStatus;
  approvedBy?: string;
  rejectedBy?: string;
  reason?: string;
  payload?: Record<string, unknown>;
  expiresAt?: string;
  decidedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ToolPolicyEntry {
  toolName: string;
  policy: ToolPolicy;
  source: 'DEFAULT' | 'OVERRIDE';
  updatedBy?: string;
}

export interface CreateAgentInput {
  name: string;
  description?: string;
  systemPrompt: string;
  modelConfig?: AgentModelConfig;
  orchestrationMode?: AgentOrchestrationMode;
  toolsAllowed?: string[];
  requiredPermissions?: string[];
  memoryEnabled?: boolean;
  status?: AgentStatus;
}

export type UpdateAgentInput = Partial<CreateAgentInput>;

export interface AgentTestResponse {
  run?: AgentRun;
  approval?: ApprovalRequest;
  approvalRequired: boolean;
  toolResult?: { success: boolean; data?: unknown; error?: string; metadata?: Record<string, unknown> };
}

export const AGENT_STATUSES: AgentStatus[] = ['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'];
export const AGENT_ORCHESTRATION_MODES: AgentOrchestrationMode[] = [
  'autonomous',
  'sequential',
  'parallel',
  'consensus',
  'supervisor_worker',
];
export const BUILT_IN_TOOLS = [
  'http_request',
  'database_query',
  'workflow_trigger',
  'calculate',
  'summarize',
  'json_transform',
];
export const DANGEROUS_TOOLS = ['http_request', 'database_query', 'workflow_trigger'] as const;
