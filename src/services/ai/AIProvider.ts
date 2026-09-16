export interface AIGenerationOptions {
  temperature?: number;
  maxTokens?: number;
  model?: string;
}

export interface GeneratedWorkflowNode {
  id: string;
  type: 'webhook' | 'condition' | 'log';
  config: Record<string, unknown>;
}

export interface GeneratedWorkflowConnection {
  source: string;
  target: string;
  condition?: 'true' | 'false';
  from?: string;
  to?: string;
}

export interface GeneratedWorkflow {
  workflowName: string;
  description: string;
  nodes: GeneratedWorkflowNode[];
  connections: GeneratedWorkflowConnection[];
  variables?: Record<string, unknown>;
  definition?: {
    nodes: GeneratedWorkflowNode[];
    edges: Array<{ source: string; target: string; condition?: 'true' | 'false' }>;
  };
}

export interface ExecutionAnalysisInput {
  executionId: string;
  status: string;
  error?: string | null;
  errors?: Array<{ nodeId?: string; code?: string; message: string }>;
  stepStatuses?: Record<string, string>;
  executionHistory?: Array<{ nodeId: string; fromStatus: string; toStatus: string; timestamp: string }>;
  duration?: number;
  retryAttempts?: number;
  workflowDefinition?: unknown;
}

export interface ExecutionAnalysisResult {
  summary: string;
  rootCause: string;
  affectedNode: string | null;
  suggestedFix: string;
  confidence: number;
}

export interface WorkflowOptimizationInput {
  workflowId: string;
  workflowName: string;
  definition: {
    nodes: Array<{ id: string; type: string; config?: Record<string, unknown> }>;
    edges: Array<{ source: string; target: string; condition?: string }>;
  };
  metrics?: {
    averageDuration?: number;
    failureRate?: number;
    slowNodes?: Array<{ nodeId: string; avgDuration: number }>;
    frequentFailures?: Array<{ nodeId: string; failureCount: number }>;
    retryCounts?: number;
  };
}

export interface OptimizationIssue {
  type: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  affectedNodeId?: string;
}

export interface OptimizationRecommendation {
  title: string;
  description: string;
  impact: string;
  action?: string;
}

export interface OptimizationResult {
  issues: OptimizationIssue[];
  recommendations: OptimizationRecommendation[];
  estimatedImprovement: string | number;
}

export interface AIProvider {
  generateText(prompt: string, options?: AIGenerationOptions): Promise<string>;
  generateWorkflow(prompt: string, options?: AIGenerationOptions): Promise<GeneratedWorkflow>;
  analyzeExecution(executionData: ExecutionAnalysisInput): Promise<ExecutionAnalysisResult>;
  suggestOptimization(workflowData: WorkflowOptimizationInput): Promise<OptimizationResult>;
}