import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiClient } from '@/services/apiClient';
import { selfHealingApi } from '@/services/selfHealingApi';
import { predictiveOpsApi } from '@/services/predictiveOpsApi';
import { aiGovernanceApi } from '@/services/aiGovernanceApi';
import {
  isPersistedId,
  routingStrategyFromConfig,
  toAIGovernanceBudgetView,
  toBudgetPolicyPayload,
  toPredictiveAnomalyView,
  toRouterConfigPayload,
  toSelfHealingIncidentView,
  toSelfHealingPolicyPayload,
  toSelfHealingPolicyView,
} from '@/services/aiOperationsMappers';
import type {
  AIGovernanceBudgetDTO,
  AIModelRouterConfigDTO,
  PredictiveAnomalyDTO,
  SelfHealingIncidentDTO,
  SelfHealingPolicyDTO,
} from '@/types/aiOperations';
import type { AIGovernanceBudget } from '@/features/autonomous-ops/AIGovernanceBudgetCard';

vi.mock('@/services/apiClient', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

type MockFn = ReturnType<typeof vi.fn>;

const client = apiClient as unknown as {
  get: MockFn;
  post: MockFn;
  put: MockFn;
  patch: MockFn;
  delete: MockFn;
};

const policyDto: SelfHealingPolicyDTO = {
  _id: '507f1f77bcf86cd799439011',
  name: 'Transient timeout retry',
  description: 'Retry gateway timeouts with jitter',
  triggerCondition: 'TIMEOUT_PATTERN',
  triggerValue: 'TIMEOUT_504',
  actionType: 'AUTO_RETRY_WITH_ADAPTED_PARAMS',
  actionConfig: { maxAttempts: 5 },
  isEnabled: true,
  priority: 10,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const incidentDto: SelfHealingIncidentDTO = {
  _id: '507f1f77bcf86cd799439012',
  workflowId: '507f1f77bcf86cd799439013',
  executionId: '507f1f77bcf86cd799439014',
  triggerCondition: 'ERROR_CODE_MATCH',
  errorDetails: { message: 'Payment gateway timed out', code: 'GATEWAY_TIMEOUT' },
  actionType: 'CIRCUIT_BREAKER_TRIP',
  status: 'PENDING_APPROVAL',
  requiresApproval: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const anomalyDto: PredictiveAnomalyDTO = {
  _id: '507f1f77bcf86cd799439015',
  workflowId: '507f1f77bcf86cd799439013',
  executionId: '507f1f77bcf86cd799439014',
  anomalyType: 'execution_drift',
  severity: 'high',
  confidenceScore: 84,
  metrics: { driftMs: 4200 },
  predictedFailureTime: '2026-01-01T01:00:00.000Z',
  recommendedActions: ['Scale worker pool from 2 to 4 instances'],
  isAcknowledged: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const budgetDto: AIGovernanceBudgetDTO = {
  monthlyTokenLimit: 5000000,
  monthlyCostLimitUSD: 1000,
  currentTokenUsage: 1250000,
  currentCostUSD: 250,
  alertThreshold: 80,
  throttleThreshold: 90,
  blockThreshold: 100,
  alertEnabled: true,
  throttleEnabled: true,
  blockEnabled: false,
};

const routerConfigDto: AIModelRouterConfigDTO = {
  providerPriority: ['anthropic', 'openai', 'mock'],
  modelConfigs: {
    'claude-sonnet': {
      provider: 'anthropic',
      modelName: 'claude-sonnet',
      maxTokens: 8192,
      temperature: 0.2,
      costPer1KTokens: 0.003,
      latencyMs: 380,
    },
  },
  complexityRules: {
    simple: { preferredProvider: 'anthropic', fallbackProvider: 'openai', maxCostPer1KTokens: 0.5 },
    medium: { preferredProvider: 'anthropic', fallbackProvider: 'openai', maxCostPer1KTokens: 1 },
    complex: { preferredProvider: 'openai', fallbackProvider: 'anthropic', maxCostPer1KTokens: 2 },
  },
  enableFallback: true,
  enableCostOptimization: true,
  enableLatencyOptimization: false,
};

describe('Phase 12 API services', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('unwraps self-healing policy envelopes and forwards the workspace header', async () => {
    client.get.mockResolvedValue({ data: { data: [policyDto] } });

    const policies = await selfHealingApi.listPolicies('workspace-1');

    expect(client.get).toHaveBeenCalledWith('/api/v1/self-healing/policies', {
      headers: { 'X-Workspace-Id': 'workspace-1' },
    });
    expect(policies).toEqual([policyDto]);
  });

  it('serialises incident filters into query parameters', async () => {
    client.get.mockResolvedValue({ data: { data: [incidentDto] } });

    const incidents = await selfHealingApi.listIncidents({
      status: 'PENDING_APPROVAL',
      executionId: '507f1f77bcf86cd799439014',
    });

    expect(client.get).toHaveBeenCalledWith('/api/v1/self-healing/incidents', {
      params: { status: 'PENDING_APPROVAL', executionId: '507f1f77bcf86cd799439014' },
    });
    expect(incidents).toEqual([incidentDto]);
  });

  it('posts approval tokens for gated remediation', async () => {
    client.post.mockResolvedValue({ data: { data: { ...incidentDto, status: 'EXECUTED' } } });

    const incident = await selfHealingApi.approveIncident(incidentDto._id, 'token-123');

    expect(client.post).toHaveBeenCalledWith(
      `/api/v1/self-healing/incidents/${incidentDto._id}/approve`,
      { token: 'token-123' },
      undefined
    );
    expect(incident.status).toBe('EXECUTED');
  });

  it('lists anomalies with booleans encoded as strings', async () => {
    client.get.mockResolvedValue({ data: { data: [anomalyDto] } });

    const anomalies = await predictiveOpsApi.listAnomalies({ isAcknowledged: false, severity: 'high' });

    expect(client.get).toHaveBeenCalledWith('/api/v1/predictive-operations/anomalies', {
      params: { severity: 'high', isAcknowledged: 'false' },
    });
    expect(anomalies).toEqual([anomalyDto]);
  });

  it('submits workflow optimizations for autonomous application', async () => {
    client.post.mockResolvedValue({ data: { data: { workflowId: '507f1f77bcf86cd799439013' } } });

    const optimization = {
      type: 'caching_recommendation' as const,
      description: 'Cache repeated lookups',
      impact: 'medium' as const,
      confidence: 70,
      suggestedChanges: { nodeId: 'node-1' },
    };

    const result = await predictiveOpsApi.applyWorkflowOptimizations(
      '507f1f77bcf86cd799439013',
      [optimization]
    );

    expect(client.post).toHaveBeenCalledWith(
      '/api/v1/predictive-operations/workflows/507f1f77bcf86cd799439013/optimizations/apply',
      { optimizations: [optimization] },
      undefined
    );
    expect(result.workflowId).toBe('507f1f77bcf86cd799439013');
  });

  it('reads and updates AI governance budgets through the envelope', async () => {
    client.get.mockResolvedValue({ data: { data: budgetDto } });
    client.put.mockResolvedValue({ data: { data: { ...budgetDto, monthlyCostLimitUSD: 1500 } } });

    const budget = await aiGovernanceApi.getBudget();
    expect(budget.monthlyCostLimitUSD).toBe(1000);

    const updated = await aiGovernanceApi.updateBudget({ monthlyCostLimitUSD: 1500 });
    expect(client.put).toHaveBeenCalledWith(
      '/api/v1/ai/governance/budget',
      { monthlyCostLimitUSD: 1500 },
      undefined
    );
    expect(updated.monthlyCostLimitUSD).toBe(1500);
  });

  it('updates the model router config and routes prompts', async () => {
    client.put.mockResolvedValue({ data: { data: routerConfigDto } });
    client.post.mockResolvedValue({
      data: {
        data: {
          providerName: 'anthropic',
          model: 'claude-sonnet',
          enableFallback: true,
          enableCostOptimization: true,
        },
      },
    });

    const config = await aiGovernanceApi.updateRouterConfig({
      providerPriority: ['anthropic', 'openai', 'mock'],
    });
    expect(config.providerPriority[0]).toBe('anthropic');

    const route = await aiGovernanceApi.routePrompt('Summarise this run', 'workflow_generation');
    expect(client.post).toHaveBeenCalledWith(
      '/api/v1/ai/governance/router/route',
      { prompt: 'Summarise this run', feature: 'workflow_generation' },
      undefined
    );
    expect(route.providerName).toBe('anthropic');
  });
});

describe('Phase 12 mappers', () => {
  it('detects persisted Mongo identifiers only', () => {
    expect(isPersistedId('507f1f77bcf86cd799439011')).toBe(true);
    expect(isPersistedId('pol-172776')).toBe(false);
  });

  it('maps incident status and approval requirements onto the console model', () => {
    const view = toSelfHealingIncidentView(
      incidentDto,
      new Map([[incidentDto.workflowId, 'Order Pipeline']])
    );

    expect(view.workflowName).toBe('Order Pipeline');
    expect(view.status).toBe('detected');
    expect(view.severity).toBe('high');
    expect(view.errorType).toBe('GATEWAY_TIMEOUT');
    expect(view.errorMessage).toBe('Payment gateway timed out');
    expect(view.isManualApprovalRequired).toBe(true);

    expect(
      toSelfHealingIncidentView({ ...incidentDto, status: 'RESOLVED', requiresApproval: false }).status
    ).toBe('resolved');
    expect(toSelfHealingIncidentView({ ...incidentDto, status: 'FAILED' }).severity).toBe('critical');
  });

  it('round-trips policies between console form and backend payload', () => {
    const view = toSelfHealingPolicyView(policyDto);

    expect(view.id).toBe(policyDto._id);
    expect(view.actions[0]?.type).toBe('auto_heal');
    expect(view.conditions.errorType).toEqual(['TIMEOUT_504']);

    const payload = toSelfHealingPolicyPayload({
      name: view.name,
      description: view.description,
      triggerEvent: view.triggerEvent,
      conditions: view.conditions,
      actions: view.actions,
      isEnabled: view.isEnabled,
      priority: view.priority,
    });

    expect(payload.actionType).toBe('AUTO_RETRY_WITH_ADAPTED_PARAMS');
    expect(payload.triggerCondition).toBe('ERROR_CODE_MATCH');
    expect(payload.triggerValue).toBe('TIMEOUT_504');
  });

  it('maps anomalies onto the predictive radar model', () => {
    const view = toPredictiveAnomalyView(anomalyDto);

    expect(view.status).toBe('active');
    expect(view.recommendedAction).toBe('Scale worker pool from 2 to 4 instances');
    expect(view.confidenceScore).toBe(84);

    expect(toPredictiveAnomalyView({ ...anomalyDto, isAcknowledged: true }).status).toBe(
      'acknowledged'
    );
  });

  it('merges backend budget figures while preserving telemetry the API omits', () => {
    const fallback: AIGovernanceBudget = {
      monthlyCapUSD: 2500,
      currentSpendUSD: 1420.75,
      tokenUsage: { totalTokens: 0, promptTokens: 0, completionTokens: 0, estimatedCostUSD: 0 },
      rateLimits: {
        tokensPerMinute: 200000,
        requestsPerMinute: 1200,
        currentTPM: 48500,
        currentRPM: 320,
      },
      policyEnforcement: 'throttle',
      piiRedactionStats: { totalRedactions: 10, creditCards: 1, ssns: 1, emails: 5, apiKeys: 3 },
      securityGuardrails: {
        promptInjectionsBlocked: 2,
        harmfulOutputsFiltered: 1,
        jailbreaksPrevented: 1,
      },
    };

    const view = toAIGovernanceBudgetView(budgetDto, fallback);

    expect(view.monthlyCapUSD).toBe(1000);
    expect(view.currentSpendUSD).toBe(250);
    expect(view.tokenUsage.totalTokens).toBe(1250000);
    expect(view.tokenUsage.promptTokens).toBe(875000);
    expect(view.tokenUsage.completionTokens).toBe(375000);
    expect(view.policyEnforcement).toBe('throttle');
    expect(view.rateLimits.currentTPM).toBe(48500);
  });

  it('translates governance actions and routing strategies into payloads', () => {
    expect(toBudgetPolicyPayload('block')).toEqual({
      alertEnabled: true,
      throttleEnabled: true,
      blockEnabled: true,
    });
    expect(toBudgetPolicyPayload('alert')).toEqual({
      alertEnabled: true,
      throttleEnabled: false,
      blockEnabled: false,
    });

    expect(toRouterConfigPayload('cost_optimized')).toEqual({
      enableCostOptimization: true,
      enableLatencyOptimization: false,
    });
    expect(toRouterConfigPayload('latency_optimized')).toEqual({
      enableCostOptimization: false,
      enableLatencyOptimization: true,
    });
    expect(toRouterConfigPayload('balanced')).toEqual({
      enableCostOptimization: true,
      enableLatencyOptimization: true,
    });
    expect(toRouterConfigPayload('quality_optimized')).toEqual({
      enableCostOptimization: false,
      enableLatencyOptimization: false,
    });

    expect(routingStrategyFromConfig(routerConfigDto)).toBe('cost_optimized');
  });
});


