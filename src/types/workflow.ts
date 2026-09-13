export type NodeType = 'webhook' | 'condition' | 'log';

export type StepStatus = 'PENDING' | 'READY' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED';

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

export interface ExecutionResult {
  status: 'SUCCEEDED' | 'FAILED';
  stepStatuses: Record<string, StepStatus>;
  outputs: Record<string, unknown>;
  executionHistory: ExecutionHistoryEvent[];
}
