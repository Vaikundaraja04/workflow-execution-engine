import type { Node, Edge } from '@xyflow/react';
import type { WorkflowDefinition, WorkflowNode, WorkflowEdge } from '@/types/workflow';

export type NodeCategory = 'trigger' | 'action' | 'logic' | 'marketplace';

export type BuilderNodeType =
  // Triggers
  | 'webhook_trigger'
  | 'manual_trigger'
  | 'schedule_trigger'
  | 'webhook'
  // Actions
  | 'http_request'
  | 'email'
  | 'database_query'
  | 'notification'
  | 'log'
  // Logic
  | 'condition'
  | 'delay'
  | 'branch'
  // Marketplace
  | 'installed_template';

export interface BaseNodeConfig {
  [key: string]: unknown;
}

export interface WebhookTriggerConfig extends BaseNodeConfig {
  method?: 'GET' | 'POST' | 'PUT';
  path?: string;
  authRequired?: boolean;
}

export interface ManualTriggerConfig extends BaseNodeConfig {
  inputSchema?: string;
  description?: string;
}

export interface ScheduleTriggerConfig extends BaseNodeConfig {
  cronExpression?: string;
  intervalMinutes?: number;
  timezone?: string;
}

export interface HttpRequestConfig extends BaseNodeConfig {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string> | string;
  body?: string;
  timeoutMs?: number;
  retryCount?: number;
}

export interface EmailConfig extends BaseNodeConfig {
  recipient: string;
  subject: string;
  message: string;
  templateId?: string;
}

export interface DatabaseQueryConfig extends BaseNodeConfig {
  database?: string;
  query: string;
  parameters?: string;
}

export interface NotificationConfig extends BaseNodeConfig {
  channel: 'slack' | 'email' | 'in_app' | 'webhook';
  recipient?: string;
  message: string;
  level?: 'info' | 'warning' | 'error';
}

export interface ConditionConfig extends BaseNodeConfig {
  field: string;
  operator: 'equals' | 'notEquals' | 'greaterThan' | 'lessThan';
  value: unknown;
}

export interface DelayConfig extends BaseNodeConfig {
  durationSeconds: number;
  mode?: 'fixed' | 'dynamic';
}

export interface BranchConfig extends BaseNodeConfig {
  expression?: string;
  cases?: Array<{ condition: string; targetHandle: string }>;
}

export interface LogConfig extends BaseNodeConfig {
  message: string;
  level?: 'debug' | 'info' | 'warn' | 'error';
}

export interface BuilderNodeData extends Record<string, unknown> {
  label: string;
  nodeType: BuilderNodeType;
  category: NodeCategory;
  config: Record<string, unknown>;
  description?: string;
  icon?: string;
  isConfigured?: boolean;
  validationError?: string;
}

export type BuilderNode = Node<BuilderNodeData>;
export type BuilderEdge = Edge;

export interface GraphValidationError {
  type: string;
  message: string;
  nodeId?: string;
  edge?: { source: string; target: string };
  severity: 'error' | 'warning';
}

export interface NodePaletteItem {
  type: BuilderNodeType;
  category: NodeCategory;
  label: string;
  description: string;
  icon: string;
  defaultConfig: Record<string, unknown>;
  badge?: string;
}

export interface WorkflowBuilderExportPackage {
  schemaVersion: '1.0.0';
  workflowName: string;
  exportedAt: string;
  definition: WorkflowDefinition;
  visualLayout?: {
    nodes: Array<{ id: string; position: { x: number; y: number } }>;
  };
}
