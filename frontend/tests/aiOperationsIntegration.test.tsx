import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import AutonomousOperationsPage from '@/app/(app)/operations/autonomous/page';
import AIGovernancePlatformPage from '@/app/(app)/platform/ai-governance/page';
import { selfHealingApi } from '@/services/selfHealingApi';
import { predictiveOpsApi } from '@/services/predictiveOpsApi';
import { aiGovernanceApi } from '@/services/aiGovernanceApi';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type {
  AIGovernanceBudgetDTO,
  AIModelRouterConfigDTO,
  PredictiveAnomalyDTO,
  SelfHealingIncidentDTO,
  SelfHealingPolicyDTO,
} from '@/types/aiOperations';

vi.mock('@/services/selfHealingApi', () => ({
  selfHealingApi: {
    listIncidents: vi.fn(),
    listPolicies: vi.fn(),
    createPolicy: vi.fn(),
    updatePolicy: vi.fn(),
    deletePolicy: vi.fn(),
    getIncident: vi.fn(),
    approveIncident: vi.fn(),
    rejectIncident: vi.fn(),
    evaluateExecutionFailure: vi.fn(),
  },
}));

vi.mock('@/services/predictiveOpsApi', () => ({
  predictiveOpsApi: {
    listAnomalies: vi.fn(),
    acknowledgeAnomaly: vi.fn(),
    deleteAnomaly: vi.fn(),
    getWorkflowOptimizations: vi.fn(),
    applyWorkflowOptimizations: vi.fn(),
  },
}));

vi.mock('@/services/aiGovernanceApi', () => ({
  aiGovernanceApi: {
    getBudget: vi.fn(),
    updateBudget: vi.fn(),
    resetBudgetUsage: vi.fn(),
    getRouterConfig: vi.fn(),
    updateRouterConfig: vi.fn(),
    routePrompt: vi.fn(),
    sanitizePrompt: vi.fn(),
  },
}));

type MockFn = ReturnType<typeof vi.fn>;

const listIncidents = selfHealingApi.listIncidents as unknown as MockFn;
const listPolicies = selfHealingApi.listPolicies as unknown as MockFn;
const listAnomalies = predictiveOpsApi.listAnomalies as unknown as MockFn;
const getBudget = aiGovernanceApi.getBudget as unknown as MockFn;
const getRouterConfig = aiGovernanceApi.getRouterConfig as unknown as MockFn;

const incidentDto: SelfHealingIncidentDTO = {
  _id: '507f1f77bcf86cd799439012',
  workflowId: '507f1f77bcf86cd799439013',
  executionId: '507f1f77bcf86cd799439014',
  triggerCondition: 'ERROR_CODE_MATCH',
  errorDetails: { message: 'Payment gateway timed out after 15000ms', code: 'GATEWAY_TIMEOUT' },
  suggestedRemediation: 'Exponential backoff retry',
  actionType: 'AUTO_RETRY_WITH_ADAPTED_PARAMS',
  status: 'EXECUTED',
  requiresApproval: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const policyDto: SelfHealingPolicyDTO = {
  _id: '507f1f77bcf86cd799439011',
  name: 'Autonomous Routing Failover Policy',
  description: 'Fail over to the secondary payment node',
  triggerCondition: 'ERROR_CODE_MATCH',
  triggerValue: 'GATEWAY_TIMEOUT',
  actionType: 'FALLBACK_ROUTE',
  actionConfig: { fallbackNode: 'node-payment-secondary' },
  isEnabled: true,
  priority: 20,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const anomalyDto: PredictiveAnomalyDTO = {
  _id: '507f1f77bcf86cd799439015',
  workflowId: '507f1f77bcf86cd799439013',
  executionId: '507f1f77bcf86cd799439014',
  anomalyType: 'sla_breach_risk',
  severity: 'critical',
  confidenceScore: 91,
  metrics: { driftMs: 8200 },
  predictedFailureTime: '2026-01-01T01:00:00.000Z',
  recommendedActions: ['Scale worker pool from 2 to 4 instances to prevent SLA breach'],
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

describe('Autonomous Operations Console (Module 12F)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({ currentRole: 'OWNER' });
  });

  it('renders live incident, policy and anomaly telemetry from the Phase 12 APIs', async () => {
    listIncidents.mockResolvedValue([incidentDto]);
    listPolicies.mockResolvedValue([policyDto]);
    listAnomalies.mockResolvedValue([anomalyDto]);

    render(<AutonomousOperationsPage />);

    await waitFor(() => expect(screen.getByText('Live API Telemetry')).toBeInTheDocument());

    expect(screen.getByText('GATEWAY_TIMEOUT')).toBeInTheDocument();
    expect(screen.getByText('Autonomous Routing Failover Policy')).toBeInTheDocument();
    expect(
      screen.getByText('Scale worker pool from 2 to 4 instances to prevent SLA breach')
    ).toBeInTheDocument();
  });

  it('falls back to demo telemetry when the Phase 12 APIs are unavailable', async () => {
    listIncidents.mockRejectedValue(new Error('offline'));
    listPolicies.mockRejectedValue(new Error('offline'));
    listAnomalies.mockRejectedValue(new Error('offline'));

    render(<AutonomousOperationsPage />);

    await waitFor(() => expect(screen.getByText('Demo Data')).toBeInTheDocument());

    expect(screen.getByText('Payment gateway timed out after 15000ms')).toBeInTheDocument();
    expect(screen.getByText('Transient HTTP Timeout Auto-Retry')).toBeInTheDocument();
    expect(
      screen.getByText('Scale worker pool from 2 to 4 instances to prevent SLA breach')
    ).toBeInTheDocument();
    expect(screen.queryByText('Live API Telemetry')).not.toBeInTheDocument();
  });

  it('marks the console read-only for roles without self-healing manage permission', async () => {
    useWorkspaceStore.setState({ currentRole: 'VIEWER' });
    listIncidents.mockResolvedValue([]);
    listPolicies.mockResolvedValue([]);
    listAnomalies.mockResolvedValue([]);

    render(<AutonomousOperationsPage />);

    await waitFor(() => expect(screen.getByText('Demo Data')).toBeInTheDocument());
    expect(screen.getByText('Read-only')).toBeInTheDocument();
  });
});

describe('AI Governance Platform (Module 12F)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({ currentRole: 'OWNER' });
  });

  it('renders budget and provider telemetry from the AI governance APIs', async () => {
    getBudget.mockResolvedValue(budgetDto);
    getRouterConfig.mockResolvedValue(routerConfigDto);

    render(<AIGovernancePlatformPage />);

    await waitFor(() => expect(screen.getByText('Live API Telemetry')).toBeInTheDocument());

    expect(screen.getByText('$250.00 / $1000.00 USD')).toBeInTheDocument();
    expect(screen.getByText('Anthropic Claude 3.5 Sonnet & Haiku')).toBeInTheDocument();
    expect(screen.getByText('Mock Provider (Local Sandbox)')).toBeInTheDocument();
    // Failover chain follows the live config's providerPriority: anthropic → openai → mock.
    expect(screen.getByText('Anthropic ➔ OpenAI ➔ Mock')).toBeInTheDocument();
  });

  it('falls back to the seeded governance snapshot when the APIs are unavailable', async () => {
    getBudget.mockRejectedValue(new Error('offline'));
    getRouterConfig.mockRejectedValue(new Error('offline'));

    render(<AIGovernancePlatformPage />);

    await waitFor(() => expect(screen.getByText('Demo Data')).toBeInTheDocument());

    expect(screen.getByText('$1420.75 / $2500.00 USD')).toBeInTheDocument();
    // Demo rows and failover chain derive from the seeded router config, not hardcoded strings.
    expect(screen.getByText('OpenAI GPT-4o & GPT-4o-mini')).toBeInTheDocument();
    expect(screen.getByText('Anthropic Claude 3.5 Sonnet & Haiku')).toBeInTheDocument();
    expect(screen.getByText('OpenAI ➔ Anthropic ➔ Mock')).toBeInTheDocument();
    expect(screen.queryByText('Live API Telemetry')).not.toBeInTheDocument();
  });
});

