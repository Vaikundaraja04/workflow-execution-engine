import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiClient } from '@/services/apiClient';
import { optimizationApi } from '@/services/optimizationApi';
import type { IWorkflowOptimizationPlan } from '@/types/optimization';
import type { VersionComparison } from '@/types/workflow';

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
};

const planFixture = {
  _id: '507f1f77bcf86cd799439021',
  workspaceId: '507f1f77bcf86cd799439022',
  workflowId: '507f1f77bcf86cd799439023',
  createdBy: '507f1f77bcf86cd799439024',
  type: 'RELIABILITY_OPTIMIZATION',
  status: 'PENDING',
  recommendations: [],
  confidence: 80,
  riskLevel: 'MEDIUM',
  expectedImpact: { summary: 'x' },
  approvalRequired: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as unknown as IWorkflowOptimizationPlan;

const diffFixture: VersionComparison = {
  from: { versionId: '507f1f77bcf86cd799439031', versionNumber: 1 },
  to: { versionId: '507f1f77bcf86cd799439032', versionNumber: 2 },
  identical: false,
  nodes: { added: [], removed: [], changed: [] },
  edges: { added: ['cond->log_miss (false)'], removed: ['wh->log_hit'] },
};

const workspaceHeaders = { headers: { 'X-Workspace-Id': 'workspace-1' } };
describe('Phase 12.5 optimization API service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requests analysis with the workspace header', async () => {
    client.get.mockResolvedValue({ data: { data: { workflowId: planFixture.workflowId } } });

    const result = await optimizationApi.analyzeWorkflow('wf-1', 'workspace-1');

    expect(client.get).toHaveBeenCalledWith('/api/v1/optimization/workflows/wf-1/analyze', workspaceHeaders);
    expect(result.workflowId).toBe(planFixture.workflowId);
  });

  it('generates plans and unwraps the envelope', async () => {
    client.post.mockResolvedValue({ data: { data: planFixture } });

    const plan = await optimizationApi.generatePlan('wf-1', 'workspace-1');

    expect(client.post).toHaveBeenCalledWith(
      '/api/v1/optimization/workflows/wf-1/generate-plan',
      {},
      workspaceHeaders
    );
    expect(plan._id).toBe(planFixture._id);
  });

  it('serialises plan filters into query parameters', async () => {
    client.get.mockResolvedValue({ data: { data: [planFixture] } });

    const plans = await optimizationApi.listPlans('workspace-1', { status: 'PENDING', workflowId: 'wf-1' });

    expect(client.get).toHaveBeenCalledWith('/api/v1/optimization/plans', {
      headers: { 'X-Workspace-Id': 'workspace-1' },
      params: { status: 'PENDING', workflowId: 'wf-1' },
    });
    expect(plans).toEqual([planFixture]);
  });
  it('posts approval decisions with notes and reasons', async () => {
    client.post.mockResolvedValue({ data: { data: { ...planFixture, status: 'APPROVED' } } });

    const approved = await optimizationApi.approvePlan('plan-1', 'workspace-1', 'looks good');
    expect(client.post).toHaveBeenCalledWith(
      '/api/v1/optimization/plans/plan-1/approve',
      { note: 'looks good' },
      workspaceHeaders
    );
    expect(approved.status).toBe('APPROVED');

    client.post.mockResolvedValue({ data: { data: { ...planFixture, status: 'REJECTED' } } });
    const rejected = await optimizationApi.rejectPlan('plan-1', 'workspace-1', 'too risky');
    expect(client.post).toHaveBeenCalledWith(
      '/api/v1/optimization/plans/plan-1/reject',
      { reason: 'too risky' },
      workspaceHeaders
    );
    expect(rejected.status).toBe('REJECTED');
  });

  it('applies plans and returns the DRAFT version with the diff', async () => {
    client.post.mockResolvedValue({
      data: {
        data: {
          plan: { ...planFixture, status: 'APPLIED' },
          version: { id: '507f1f77bcf86cd799439032', versionNumber: 2, status: 'DRAFT' },
          beforeAfter: diffFixture,
        },
      },
    });

    const result = await optimizationApi.applyPlan('plan-1', 'workspace-1');

    expect(client.post).toHaveBeenCalledWith(
      '/api/v1/optimization/plans/plan-1/apply',
      {},
      workspaceHeaders
    );
    expect(result.plan.status).toBe('APPLIED');
    expect(result.version?.status).toBe('DRAFT');
    expect(result.beforeAfter?.edges.removed).toContain('wh->log_hit');
    expect(result.beforeAfter?.edges.added).toContain('cond->log_miss (false)');
  });
});