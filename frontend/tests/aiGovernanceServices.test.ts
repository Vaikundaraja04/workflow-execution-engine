import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiClient } from '@/services/apiClient';
import { aiGovernancePolicyApi } from '@/services/aiGovernanceApi';
import type {
  AIOperationApprovalDTO,
  GovernanceAuditSummaryDTO,
  GovernanceDecisionDTO,
  GovernancePolicyDTO,
} from '@/types/aiGovernancePolicy';

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
  delete: MockFn;
};

const workspaceHeaders = { headers: { 'X-Workspace-Id': 'workspace-1' } };

const policyFixture: GovernancePolicyDTO = {
  _id: '507f1f77bcf86cd799439041',
  policyType: 'MODEL_ACCESS',
  allowedModels: [],
  blockedModels: ['gpt-4*'],
  allowedRoles: ['OWNER'],
  status: 'ACTIVE',
};

const decisionFixture: GovernanceDecisionDTO = {
  decision: 'DENY',
  operationId: 'aiop_1',
  reasons: ['Model gpt-4o is blocked by governance policy'],
  reasonCodes: ['MODEL_BLOCKED'],
  redactions: [],
  matchedPatterns: [],
  requiredApproval: false,
  throttled: false,
  evaluatedAt: '2026-01-01T00:00:00.000Z',
};
const summaryFixture: GovernanceAuditSummaryDTO = {
  timeframe: '7d',
  decisions: { allowed: 3, denied: 1, approvalRequired: 2, approved: 1, rejected: 0 },
  usage: {
    tokens: 1200,
    requests: 4,
    costUSD: 0.42,
    byFeature: [{ feature: 'workflow_generation', tokens: 1200, costUSD: 0.42 }],
    topModels: [{ model: 'mock-model', tokens: 1200, costUSD: 0.42 }],
  },
  approvals: { pending: 1 },
};

const approvalFixture: AIOperationApprovalDTO = {
  _id: '507f1f77bcf86cd799439042',
  resourceType: 'AI_OPERATION',
  resourceId: 'aiop_1',
  action: 'AI_WORKFLOW_CREATE',
  status: 'PENDING',
  requestedBy: '507f1f77bcf86cd799439043',
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('Phase 12.6 AI governance policy API service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists policies with the optional type filter and workspace header', async () => {
    client.get.mockResolvedValue({ data: { data: [policyFixture] } });

    const policies = await aiGovernancePolicyApi.listPolicies('MODEL_ACCESS', 'workspace-1');

    expect(client.get).toHaveBeenCalledWith('/api/v1/ai/governance/policies', {
      headers: { 'X-Workspace-Id': 'workspace-1' },
      params: { type: 'MODEL_ACCESS' },
    });
    expect(policies).toEqual([policyFixture]);
  });

  it('lists every policy type when no filter is supplied', async () => {
    client.get.mockResolvedValue({ data: { data: [] } });

    await aiGovernancePolicyApi.listPolicies();

    expect(client.get).toHaveBeenCalledWith('/api/v1/ai/governance/policies', { params: {} });
  });  it('creates and updates policies through the shared envelope', async () => {
    client.post.mockResolvedValue({ data: { data: policyFixture } });

    const created = await aiGovernancePolicyApi.createPolicy(
      { type: 'MODEL_ACCESS', blockedModels: ['gpt-4*'] },
      'workspace-1'
    );

    expect(client.post).toHaveBeenCalledWith(
      '/api/v1/ai/governance/policies',
      { type: 'MODEL_ACCESS', blockedModels: ['gpt-4*'] },
      workspaceHeaders
    );
    expect(created.policyType).toBe('MODEL_ACCESS');

    client.put.mockResolvedValue({ data: { data: { ...policyFixture, status: 'DISABLED' } } });

    const updated = await aiGovernancePolicyApi.updatePolicy(
      policyFixture._id as string,
      { status: 'DISABLED' },
      'workspace-1'
    );

    expect(client.put).toHaveBeenCalledWith(
      `/api/v1/ai/governance/policies/${policyFixture._id}`,
      { status: 'DISABLED' },
      workspaceHeaders
    );
    expect((updated as { status: string }).status).toBe('DISABLED');
  });

  it('deletes policies and unwraps the deleted flag', async () => {
    client.delete.mockResolvedValue({ data: { data: { deleted: true } } });

    const result = await aiGovernancePolicyApi.deletePolicy('policy-1', 'workspace-1');

    expect(client.delete).toHaveBeenCalledWith('/api/v1/ai/governance/policies/policy-1', workspaceHeaders);
    expect(result.deleted).toBe(true);
  });

  it('posts dry-run evaluations with the workspace header', async () => {
    client.post.mockResolvedValue({ data: { data: decisionFixture } });

    const decision = await aiGovernancePolicyApi.evaluate(
      { feature: 'AI_WORKFLOW_CREATE', prompt: 'drop database' },
      'workspace-1'
    );

    expect(client.post).toHaveBeenCalledWith(
      '/api/v1/ai/governance/evaluate',
      { feature: 'AI_WORKFLOW_CREATE', prompt: 'drop database' },
      workspaceHeaders
    );
    expect(decision.decision).toBe('DENY');
    expect(decision.reasonCodes).toContain('MODEL_BLOCKED');
  });  it('requests audit events with limit and action parameters', async () => {
    client.get.mockResolvedValue({ data: { data: [] } });

    await aiGovernancePolicyApi.getAuditEvents('workspace-1', 10, 'AI_GOVERNANCE_DENIED');

    expect(client.get).toHaveBeenCalledWith('/api/v1/ai/governance/audit/events', {
      headers: { 'X-Workspace-Id': 'workspace-1' },
      params: { limit: 10, action: 'AI_GOVERNANCE_DENIED' },
    });
  });

  it('loads audit summaries for the requested timeframe', async () => {
    client.get.mockResolvedValue({ data: { data: summaryFixture } });

    const summary = await aiGovernancePolicyApi.getAuditSummary('workspace-1', '7d');

    expect(client.get).toHaveBeenCalledWith('/api/v1/ai/governance/audit/summary', {
      headers: { 'X-Workspace-Id': 'workspace-1' },
      params: { timeframe: '7d' },
    });
    expect(summary.decisions.denied).toBe(1);
    expect(summary.usage.byFeature[0]?.feature).toBe('workflow_generation');
  });

  it('lists pending approvals and posts approval decisions', async () => {
    client.get.mockResolvedValue({ data: { data: [approvalFixture] } });

    const queue = await aiGovernancePolicyApi.listApprovals('workspace-1', 'PENDING');

    expect(client.get).toHaveBeenCalledWith('/api/v1/ai/governance/approvals', {
      headers: { 'X-Workspace-Id': 'workspace-1' },
      params: { status: 'PENDING' },
    });
    expect(queue).toHaveLength(1);

    client.post.mockResolvedValue({ data: { data: { ...approvalFixture, status: 'APPROVED' } } });

    const approved = await aiGovernancePolicyApi.approveApproval('approval-1', 'workspace-1', 'ok');

    expect(client.post).toHaveBeenCalledWith(
      '/api/v1/ai/governance/approvals/approval-1/approve',
      { reason: 'ok' },
      workspaceHeaders
    );
    expect(approved.status).toBe('APPROVED');
  });

  it('posts rejection decisions', async () => {
    client.post.mockResolvedValue({ data: { data: { ...approvalFixture, status: 'REJECTED' } } });

    const rejected = await aiGovernancePolicyApi.rejectApproval('approval-1', 'workspace-1', 'too risky');

    expect(client.post).toHaveBeenCalledWith(
      '/api/v1/ai/governance/approvals/approval-1/reject',
      { reason: 'too risky' },
      workspaceHeaders
    );
    expect(rejected.status).toBe('REJECTED');
  });
});