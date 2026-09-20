import type {
  AIGovernanceBudgetDTO,
  AIGovernancePolicyAction,
  AIModelRouterConfigDTO,
  AIRoutingStrategy,
  PredictiveAnomalyDTO,
  SelfHealingActionType,
  SelfHealingIncidentDTO,
  SelfHealingPolicyDTO,
  SelfHealingTriggerCondition,
  UpdateAIGovernanceBudgetPayload,
  UpdateAIModelRouterConfigPayload,
} from '@/types/aiOperations';
import type { SelfHealingIncident } from '@/features/autonomous-ops/SelfHealingIncidentsTable';
import type { SelfHealingPolicy } from '@/features/autonomous-ops/PolicyManager';
import type { PredictiveAnomalyItem } from '@/features/autonomous-ops/PredictiveRadar';
import type { AIGovernanceBudget } from '@/features/autonomous-ops/AIGovernanceBudgetCard';

/**
 * Module 12F — mappers between the Phase 12 API DTOs and the console view models.
 * Mapping is intentionally deterministic and total: any backend value resolves
 * to a display value without throwing.
 */

export type SelfHealingPolicyForm = Omit<
  SelfHealingPolicy,
  'id' | 'lastTriggered' | 'triggerCount' | 'successRate'
>;

export function resolveRecordId(record: { _id?: string; id?: string }): string {
  return record._id || record.id || '';
}

/** Mongo ObjectIds are the only policy ids that can be persisted through the API. */
export function isPersistedId(id: string): boolean {
  return /^[a-f\d]{24}$/i.test(id);
}

function workflowLabel(workflowId: string, workflowNames?: ReadonlyMap<string, string>): string {
  return workflowNames?.get(workflowId) ?? `Workflow ${workflowId.slice(0, 8)}`;
}

// ---------------------------------------------------------------------------
// Module 12A — Self-healing incidents & policies
// ---------------------------------------------------------------------------

const INCIDENT_STATUS_TO_VIEW: Record<
  SelfHealingIncidentDTO['status'],
  SelfHealingIncident['status']
> = {
  PROPOSED: 'detected',
  PENDING_APPROVAL: 'detected',
  EXECUTED: 'healing',
  RESOLVED: 'resolved',
  FAILED: 'failed',
  REJECTED: 'failed',
};

function incidentSeverity(dto: SelfHealingIncidentDTO): SelfHealingIncident['severity'] {
  if (dto.status === 'FAILED') return 'critical';
  if (dto.status === 'PENDING_APPROVAL' || dto.requiresApproval) return 'high';
  if (dto.status === 'REJECTED') return 'low';
  return 'medium';
}

export function toSelfHealingIncidentView(
  dto: SelfHealingIncidentDTO,
  workflowNames?: ReadonlyMap<string, string>
): SelfHealingIncident {
  const viewStatus = INCIDENT_STATUS_TO_VIEW[dto.status] ?? 'detected';

  return {
    id: resolveRecordId(dto),
    workflowId: dto.workflowId,
    workflowName: workflowLabel(dto.workflowId, workflowNames),
    executionId: dto.executionId,
    errorType: dto.errorDetails?.code || dto.triggerCondition,
    errorMessage: dto.errorDetails?.message || 'Execution failure detected',
    severity: incidentSeverity(dto),
    status: viewStatus,
    detectedAt: dto.createdAt,
    resolvedAt: viewStatus === 'resolved' ? dto.updatedAt : undefined,
    healingAction: dto.suggestedRemediation,
    policyApplied: dto.policyId,
    isManualApprovalRequired: dto.requiresApproval,
  };
}

const ACTION_TYPE_TO_VIEW: Record<
  SelfHealingActionType,
  SelfHealingPolicy['actions'][number]['type']
> = {
  AUTO_RETRY_WITH_ADAPTED_PARAMS: 'auto_heal',
  FALLBACK_ROUTE: 'rollback',
  CIRCUIT_BREAKER_TRIP: 'notify',
  PARAMETER_MUTATION_HEAL: 'scale_resources',
};

const VIEW_ACTION_TO_BACKEND: Record<
  SelfHealingPolicy['actions'][number]['type'],
  SelfHealingActionType
> = {
  auto_heal: 'AUTO_RETRY_WITH_ADAPTED_PARAMS',
  rollback: 'FALLBACK_ROUTE',
  notify: 'CIRCUIT_BREAKER_TRIP',
  scale_resources: 'PARAMETER_MUTATION_HEAL',
  webhook: 'FALLBACK_ROUTE',
};

const TRIGGER_CONDITION_TO_EVENT: Record<SelfHealingTriggerCondition, string> = {
  ERROR_CODE_MATCH: 'workflow_failure',
  TIMEOUT_PATTERN: 'workflow_failure',
  RATE_LIMIT_EXCEEDED: 'error_rate_surge',
  DATA_VALIDATION_ANOMALY: 'sla_breach',
};

function triggerConditionFromEvent(triggerEvent: string): SelfHealingTriggerCondition {
  switch (triggerEvent) {
    case 'error_rate_surge':
      return 'RATE_LIMIT_EXCEEDED';
    case 'sla_breach':
    case 'resource_exhaustion':
      return 'TIMEOUT_PATTERN';
    case 'queue_depth_critical':
      return 'RATE_LIMIT_EXCEEDED';
    default:
      return 'ERROR_CODE_MATCH';
  }
}

export function toSelfHealingPolicyView(dto: SelfHealingPolicyDTO): SelfHealingPolicy {
  const errorTypes = dto.triggerValue && dto.triggerValue !== 'ANY' ? [dto.triggerValue] : [];

  return {
    id: resolveRecordId(dto),
    name: dto.name,
    description: dto.description || `${dto.triggerCondition} → ${dto.actionType}`,
    triggerEvent: TRIGGER_CONDITION_TO_EVENT[dto.triggerCondition] ?? 'workflow_failure',
    conditions: {
      errorType: errorTypes,
      severity: [],
      workflowIds: [],
    },
    actions: [
      {
        type: ACTION_TYPE_TO_VIEW[dto.actionType] ?? 'notify',
        configuration: dto.actionConfig ?? {},
      },
    ],
    isEnabled: dto.isEnabled,
    priority: dto.priority,
    triggerCount: 0,
    successRate: 100,
  };
}

export function toSelfHealingPolicyPayload(form: SelfHealingPolicyForm) {
  const primaryAction = form.actions[0];

  return {
    name: form.name,
    description: form.description || undefined,
    triggerCondition: triggerConditionFromEvent(form.triggerEvent),
    triggerValue: form.conditions.errorType?.[0] || 'ANY',
    actionType: primaryAction ? VIEW_ACTION_TO_BACKEND[primaryAction.type] : 'CIRCUIT_BREAKER_TRIP',
    actionConfig: primaryAction?.configuration ?? {},
    isEnabled: form.isEnabled,
    priority: form.priority,
  };
}

// ---------------------------------------------------------------------------
// Module 12D — Predictive anomalies
// ---------------------------------------------------------------------------

export function toPredictiveAnomalyView(
  dto: PredictiveAnomalyDTO,
  workflowNames?: ReadonlyMap<string, string>
): PredictiveAnomalyItem {
  return {
    id: resolveRecordId(dto),
    workflowId: dto.workflowId,
    workflowName: workflowLabel(dto.workflowId, workflowNames),
    anomalyType: dto.anomalyType,
    confidenceScore: dto.confidenceScore,
    predictedFailureTime: dto.predictedFailureTime,
    recommendedAction: dto.recommendedActions?.[0] ?? 'Acknowledge and monitor the workflow',
    status: dto.isAcknowledged ? 'acknowledged' : 'active',
    detectedAt: dto.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Module 12C — AI governance budget & model router
// ---------------------------------------------------------------------------

/**
 * Maps a backend budget document onto the governance card view model.
 * The backend does not track per-minute rate telemetry, PII redaction counts,
 * or guardrail counters, so those fields are preserved from `fallback`
 * (seeded console data) while spend/budget/limit data comes from the API.
 */
export function toAIGovernanceBudgetView(
  dto: AIGovernanceBudgetDTO,
  fallback: AIGovernanceBudget
): AIGovernanceBudget {
  const totalTokens = dto.currentTokenUsage;
  const estimatedCostUSD = dto.currentCostUSD;
  const promptTokens = Math.round(totalTokens * 0.7);

  return {
    ...fallback,
    monthlyCapUSD: dto.monthlyCostLimitUSD,
    currentSpendUSD: dto.currentCostUSD,
    tokenUsage: {
      totalTokens,
      promptTokens,
      completionTokens: Math.max(0, totalTokens - promptTokens),
      estimatedCostUSD,
    },
    policyEnforcement: dto.blockEnabled ? 'block' : dto.throttleEnabled ? 'throttle' : 'alert',
  };
}

export function toBudgetPolicyPayload(
  action: AIGovernancePolicyAction
): UpdateAIGovernanceBudgetPayload {
  return {
    alertEnabled: true,
    throttleEnabled: action !== 'alert',
    blockEnabled: action === 'block',
  };
}

export function toRouterConfigPayload(
  strategy: AIRoutingStrategy
): UpdateAIModelRouterConfigPayload {
  switch (strategy) {
    case 'cost_optimized':
      return { enableCostOptimization: true, enableLatencyOptimization: false };
    case 'latency_optimized':
      return { enableCostOptimization: false, enableLatencyOptimization: true };
    case 'balanced':
      return { enableCostOptimization: true, enableLatencyOptimization: true };
    default:
      return { enableCostOptimization: false, enableLatencyOptimization: false };
  }
}

export function routingStrategyFromConfig(config: AIModelRouterConfigDTO): AIRoutingStrategy {
  if (config.enableCostOptimization && config.enableLatencyOptimization) return 'balanced';
  if (config.enableCostOptimization) return 'cost_optimized';
  if (config.enableLatencyOptimization) return 'latency_optimized';
  return 'quality_optimized';
}

