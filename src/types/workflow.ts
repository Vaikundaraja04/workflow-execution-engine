export type NodeType = 'webhook' | 'condition' | 'log';

export type StepStatus = 'PENDING' | 'READY' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED';

export type ValidationErrorType =
  | 'DUPLICATE_NODE'
  | 'MISSING_SOURCE'
  | 'MISSING_TARGET'
  | 'SELF_CONNECTION'
  | 'CYCLE'
  | 'WEBHOOK_COUNT'
  | 'UNREACHABLE';

export interface ValidationError {
  type: ValidationErrorType;
  message: string;
  nodeId?: string;
  edge?: { source: string; target: string };
}

export interface ConditionConfig {
  field: string;
  operator: 'equals' | 'notEquals' | 'greaterThan' | 'lessThan';
  value: unknown;
}

export interface LogConfig {
  message: string;
}

export interface WebhookConfig {}

export type NodeConfig = ConditionConfig | LogConfig | WebhookConfig;

export interface WorkflowNode {
  id: string;
  type: NodeType;
  config: Record<string, unknown>;
}

export interface WorkflowEdge {
  source: string;
  target: string;
  condition?: 'true' | 'false';
}

export interface WorkflowDefinition {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface ExecutionHistoryEvent {
  nodeId: string;
  fromStatus: StepStatus;
  toStatus: StepStatus;
  timestamp: string;
}

export interface ExecutionError {
  nodeId?: string;
  code: string;
  message: string;
}

export interface ExecutionResult {
  status: 'SUCCEEDED' | 'FAILED';
  stepStatuses: Record<string, StepStatus>;
  outputs: Record<string, unknown>;
  executionHistory: ExecutionHistoryEvent[];
  errors?: ExecutionError[];
}
