export type AIGenerationState = 'IDLE' | 'GENERATING' | 'SUCCESS' | 'FAILED';

export type AIFeature =
  | 'workflow_generation'
  | 'failure_analysis'
  | 'optimization'
  | 'template_generation';

export type AIProviderName = 'openai' | 'anthropic' | 'gemini' | 'openrouter' | 'mock';

export interface AIValidationError {
  type: string;
  message: string;
  nodeId?: string;
  edge?: { source: string; target: string };
}

export interface AIValidationResult {
  isValid: boolean;
  errors: AIValidationError[];
}

export interface AIWorkflowNode {
  id: string;
  type: string;
  config: Record<string, unknown>;
}

export interface AIWorkflowConnection {
  source: string;
  target: string;
  condition?: 'true' | 'false';
  from?: string;
  to?: string;
}

export interface AIWorkflowDefinition {
  nodes: AIWorkflowNode[];
  edges: Array<{ source: string; target: string; condition?: 'true' | 'false' }>;
}
export interface AIDraftWorkflow {
  workflowName: string;
  description: string;
  nodes: AIWorkflowNode[];
  connections: AIWorkflowConnection[];
  variables: Record<string, unknown>;
  definition: AIWorkflowDefinition;
  status: 'DRAFT';
  isPublished: boolean;
}

export interface AIGenerateWorkflowResult {
  draftWorkflow: AIDraftWorkflow;
  validation: AIValidationResult;
  suggestedTemplateName: string;
}

export interface AITemplateMetadata {
  suggestedCategory: string;
  suggestedTags: string[];
  suggestedVisibility: 'PRIVATE' | 'WORKSPACE' | 'PUBLIC' | 'MARKETPLACE';
}

export interface AIGenerateTemplateResult {
  draftWorkflow: AIDraftWorkflow;
  validation: AIValidationResult;
  templateMetadata: AITemplateMetadata;
}

export interface AIExecutionAnalysis {
  summary: string;
  rootCause: string;
  affectedNode: string | null;
  suggestedFix: string;
  confidence: number;
}

export interface AIOptimizationIssue {
  type: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  affectedNodeId?: string;
}

export interface AIOptimizationRecommendation {
  title: string;
  description: string;
  impact: string;
  action?: string;
}

export interface AIOptimizationResult {
  issues: AIOptimizationIssue[];
  recommendations: AIOptimizationRecommendation[];
  estimatedImprovement: string | number;
}
export interface AIUsageRecord {
  _id?: string;
  workspaceId: string;
  userId: string;
  feature: AIFeature;
  tokensUsed: number;
  requests: number;
  costEstimate: number;
  model?: string;
  createdAt?: string;
}

export interface AIUsageFeatureSummary {
  feature: AIFeature;
  requests: number;
  tokens: number;
  cost: number;
}

export interface AIUsageSummary {
  totalRequests: number;
  totalTokens: number;
  estimatedCost: number;
  featureUsage: AIUsageFeatureSummary[];
  records: AIUsageRecord[];
  latestActivity: string | null;
}

export interface AIConfiguration {
  _id?: string;
  workspaceId?: string;
  provider: AIProviderName;
  enabled?: boolean;
  hasApiKey?: boolean;
  model: string;
  temperature?: number;
  maxTokens?: number;
  features?: {
    workflowGeneration: boolean;
    failureAnalysis: boolean;
    optimization: boolean;
  };
  createdAt?: string;
  updatedAt?: string;
}

export interface AIUpdateConfigurationPayload {
  enabled?: boolean;
  provider?: AIProviderName;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  features?: {
    workflowGeneration: boolean;
    failureAnalysis: boolean;
    optimization: boolean;
  };
  apiKey?: string;
}
export type GeneratedNodeCategory = 'trigger' | 'action' | 'logic' | 'unknown';

export interface GeneratedPreviewNode {
  id: string;
  type: string;
  label: string;
  category: GeneratedNodeCategory;
  config: Record<string, unknown>;
}

export interface GeneratedPreviewEdge {
  id: string;
  source: string;
  target: string;
  condition?: 'true' | 'false';
}

export interface AIChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  prompt?: string;
  nodeCount?: number;
  connectionCount?: number;
  isValid?: boolean;
  error?: string;
}

export interface AIWorkflowOption {
  id: string;
  name: string;
}

export interface AIWorkflowPerformance {
  totalRuns: number;
  successRate: number;
  avgLatencyMs: number;
  statusCounts: Record<string, number>;
}
