// Phase 12 — AI-Native Automation & Autonomous Operations API contracts.
// These DTOs mirror the Phase 12A–12D backend payloads and are intentionally
// kept separate from the console view models defined in the feature components.

// ---------------------------------------------------------------------------
// Module 12A — Autonomous Self-Healing & Closed-Loop Remediation
// ---------------------------------------------------------------------------

export type SelfHealingActionType =
  | 'AUTO_RETRY_WITH_ADAPTED_PARAMS'
  | 'FALLBACK_ROUTE'
  | 'CIRCUIT_BREAKER_TRIP'
  | 'PARAMETER_MUTATION_HEAL';

export type SelfHealingTriggerCondition =
  | 'ERROR_CODE_MATCH'
  | 'TIMEOUT_PATTERN'
  | 'RATE_LIMIT_EXCEEDED'
  | 'DATA_VALIDATION_ANOMALY';

export type SelfHealingIncidentStatus =
  | 'PROPOSED'
  | 'PENDING_APPROVAL'
  | 'EXECUTED'
  | 'REJECTED'
  | 'FAILED'
  | 'RESOLVED';

export interface SelfHealingPolicyDTO {
  _id: string;
  id?: string;
  workspaceId?: string;
  name: string;
  description?: string;
  triggerCondition: SelfHealingTriggerCondition;
  triggerValue: string;
  actionType: SelfHealingActionType;
  actionConfig: Record<string, unknown>;
  isEnabled: boolean;
  priority: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateSelfHealingPolicyPayload {
  name: string;
  description?: string;
  triggerCondition: SelfHealingTriggerCondition;
  triggerValue: string;
  actionType: SelfHealingActionType;
  actionConfig?: Record<string, unknown>;
  isEnabled?: boolean;
  priority?: number;
}

export type UpdateSelfHealingPolicyPayload = Partial<CreateSelfHealingPolicyPayload>;

export interface SelfHealingIncidentDTO {
  _id: string;
  id?: string;
  workspaceId?: string;
  workflowId: string;
  executionId: string;
  policyId?: string;
  triggerCondition: string;
  errorDetails: {
    message: string;
    code?: string;
    stack?: string;
    nodeId?: string;
  };
  rootCause?: string;
  confidenceScore?: number;
  suggestedRemediation?: string;
  actionType: SelfHealingActionType;
  actionConfig?: Record<string, unknown>;
  status: SelfHealingIncidentStatus;
  requiresApproval: boolean;
  approvedAt?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface SelfHealingIncidentFilters {
  status?: SelfHealingIncidentStatus;
  executionId?: string;
}

// ---------------------------------------------------------------------------
// Module 12C — Intelligent Multi-Model Router & Enterprise AI Governance
// ---------------------------------------------------------------------------

export type AIProviderName = 'openai' | 'anthropic' | 'mock';

export interface AIModelConfigEntry {
  provider: AIProviderName;
  modelName: string;
  maxTokens: number;
  temperature: number;
  costPer1KTokens: number;
  latencyMs: number;
}

export interface AIComplexityRule {
  preferredProvider: AIProviderName;
  fallbackProvider: AIProviderName;
  maxCostPer1KTokens: number;
}

export interface AIModelRouterConfigDTO {
  _id?: string;
  workspaceId?: string;
  providerPriority: AIProviderName[];
  modelConfigs: Record<string, AIModelConfigEntry>;
  complexityRules: {
    simple: AIComplexityRule;
    medium: AIComplexityRule;
    complex: AIComplexityRule;
  };
  enableFallback: boolean;
  enableCostOptimization: boolean;
  enableLatencyOptimization: boolean;
  updatedAt?: string;
}

export type UpdateAIModelRouterConfigPayload = Partial<{
  providerPriority: AIProviderName[];
  modelConfigs: Record<string, AIModelConfigEntry>;
  complexityRules: AIModelRouterConfigDTO['complexityRules'];
  enableFallback: boolean;
  enableCostOptimization: boolean;
  enableLatencyOptimization: boolean;
}>;

export interface AIGovernanceBudgetDTO {
  _id?: string;
  workspaceId?: string;
  monthlyTokenLimit: number;
  monthlyCostLimitUSD: number;
  currentTokenUsage: number;
  currentCostUSD: number;
  alertThreshold: number;
  throttleThreshold: number;
  blockThreshold: number;
  alertEnabled: boolean;
  throttleEnabled: boolean;
  blockEnabled: boolean;
  lastResetDate?: string;
}

export type UpdateAIGovernanceBudgetPayload = Partial<{
  monthlyTokenLimit: number;
  monthlyCostLimitUSD: number;
  alertThreshold: number;
  throttleThreshold: number;
  blockThreshold: number;
  alertEnabled: boolean;
  throttleEnabled: boolean;
  blockEnabled: boolean;
}>;

export interface AIModelRouteResultDTO {
  providerName: AIProviderName;
  model: string;
  enableFallback: boolean;
  enableCostOptimization: boolean;
}

export interface AIPromptSanitizeResultDTO {
  hasInjection: boolean;
  sanitized: string;
  redactedPII: string;
}

export type AIGovernancePolicyAction = 'alert' | 'throttle' | 'block';

export type AIRoutingStrategy = 'balanced' | 'cost_optimized' | 'latency_optimized' | 'quality_optimized';

// ---------------------------------------------------------------------------
// Module 12D — Predictive Operations & Autonomous Optimization
// ---------------------------------------------------------------------------

export type AnomalyType =
  | 'queue_depth'
  | 'error_rate'
  | 'memory_pressure'
  | 'execution_drift'
  | 'sla_breach_risk';

export type AnomalySeverity = 'low' | 'medium' | 'high' | 'critical';

export interface PredictiveAnomalyDTO {
  _id: string;
  id?: string;
  workspaceId?: string;
  workflowId: string;
  executionId: string;
  anomalyType: AnomalyType;
  severity: AnomalySeverity;
  confidenceScore: number;
  metrics: Record<string, unknown>;
  predictedFailureTime: string;
  recommendedActions: string[];
  isAcknowledged: boolean;
  acknowledgedAt?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface PredictiveAnomalyFilters {
  workflowId?: string;
  anomalyType?: AnomalyType;
  severity?: AnomalySeverity;
  isAcknowledged?: boolean;
  startTime?: string;
  endTime?: string;
}

export type OptimizationType =
  | 'dead_path_elimination'
  | 'parallel_step_conversion'
  | 'adaptive_retry_tuning'
  | 'caching_recommendation';

export interface WorkflowOptimization {
  type: OptimizationType;
  description: string;
  impact: 'low' | 'medium' | 'high';
  confidence: number;
  suggestedChanges: Record<string, unknown>;
}

export interface WorkflowOptimizationResultDTO {
  workflowId: string;
  optimizations: WorkflowOptimization[];
}

