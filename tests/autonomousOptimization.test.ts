import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { AutonomousOptimizationService } from '../src/services/autonomousOptimizationService.js';
import { WorkflowOptimizationModel } from '../src/models/WorkflowOptimizationModel.js';
import type { OptimizationRecommendation } from '../src/models/WorkflowOptimizationModel.js';
import { WorkflowVersionModel } from '../src/models/WorkflowVersionModel.js';
import { WorkflowModel } from '../src/models/WorkflowModel.js';
import { WorkflowExecutionModel } from '../src/models/WorkflowExecutionModel.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';
import { WorkspaceModel } from '../src/models/WorkspaceModel.js';
import { AIUsageModel } from '../src/models/AIUsageModel.js';
import type { ExecutionHistoryEvent, StepStatus, WorkflowDefinition } from '../src/types/workflow.js';

const service = AutonomousOptimizationService.getInstance();

const DEFINITION: WorkflowDefinition = {
  nodes: [
    { id: 'wh', type: 'webhook', config: {} },
    { id: 'cond', type: 'condition', config: { field: 'amount', operator: 'greaterThan', value: 100 } },
    { id: 'log_hit', type: 'log', config: { message: 'hit' } },
    { id: 'log_miss', type: 'log', config: { message: 'miss' } },
  ],
  edges: [
    { source: 'wh', target: 'cond' },
    { source: 'cond', target: 'log_hit' },
    { source: 'wh', target: 'log_hit' },
    { source: 'wh', target: 'log_miss' },
  ],
};

describe('Module 12.5 - Autonomous Workflow Optimization Platform', () => {
  let replSet: MongoMemoryReplSet;
  let workspaceId: Types.ObjectId;
  let userId: Types.ObjectId;
  let workflowId: Types.ObjectId;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    if (replSet) await replSet.stop();
  }, 30000);
  beforeEach(async () => {
    await Promise.all([
      WorkflowOptimizationModel.deleteMany({}),
      WorkflowVersionModel.deleteMany({}),
      WorkflowModel.deleteMany({}),
      WorkflowExecutionModel.deleteMany({}),
      AuditLogModel.deleteMany({}),
      WorkspaceModel.deleteMany({}),
      AIUsageModel.deleteMany({}),
    ]);
    userId = new Types.ObjectId();
    const ws = await WorkspaceModel.create({ name: 'Optimization WS', slug: 'optimization-ws', ownerId: userId });
    workspaceId = ws._id;
    const wf = await WorkflowModel.create({
      name: 'Order Routing',
      ownerId: userId,
      workspaceId,
      status: 'PUBLISHED',
      latestVersionNumber: 0,
      draftDefinition: DEFINITION,
    });
    workflowId = wf._id;
    await seedExecutions();
  });
  async function seedExecutions() {
    for (let i = 0; i < 12; i++) {
      const failed = i < 4;
      const timedOut = i < 2;
      const retried = i >= 6;
      const startedAt = new Date(Date.now() - (12 - i) * 3600000);
      const finishedAt = new Date(startedAt.getTime() + 5000 + i * 100);
      const stepStatuses: Record<string, StepStatus> = {
        wh: 'SUCCEEDED',
        cond: 'SUCCEEDED',
        log_hit: failed ? 'FAILED' : 'SUCCEEDED',
        log_miss: 'SUCCEEDED',
      };
      const executionHistory: ExecutionHistoryEvent[] = [
        {
          nodeId: 'log_hit',
          fromStatus: 'READY',
          toStatus: 'RUNNING',
          timestamp: new Date(startedAt.getTime() + 1000).toISOString(),
        },
        {
          nodeId: 'log_hit',
          fromStatus: 'RUNNING',
          toStatus: failed ? 'FAILED' : 'SUCCEEDED',
          timestamp: new Date(startedAt.getTime() + 4000).toISOString(),
        },
      ];      await WorkflowExecutionModel.create({
        _id: new Types.ObjectId(),
        workflowId,
        workflowVersionId: new Types.ObjectId(),
        workspaceId,
        ownerId: userId,
        versionNumber: 1,
        jobId: `job-${i}`,
        idempotencyKey: `idem-${i}`,
        inputHash: `hash-${i}`,
        input: { orderId: `ord_${i}` },
        status: failed ? 'FAILED' : 'SUCCEEDED',
        attemptsMade: 1,
        maxRetries: 3,
        retryCount: retried ? 1 : 0,
        statusHistory: [{ status: failed ? 'FAILED' : 'SUCCEEDED', timestamp: new Date() }],
        startedAt,
        finishedAt,
        ...(timedOut ? { error: { code: 'TIMEOUT', message: 'Gateway timed out' } } : {}),
        result: {
          status: failed ? 'FAILED' : 'SUCCEEDED',
          stepStatuses,
          outputs: {},
          executionHistory,
        },
      });
    }
  }
  function buildRecommendation(overrides: Partial<OptimizationRecommendation> = {}): OptimizationRecommendation {
    return {
      id: 'rec_manual',
      type: 'RELIABILITY_OPTIMIZATION',
      title: 'Wire fallback',
      description: 'Route unmatched payloads to a terminal node.',
      expectedImprovement: {
        metric: 'unhandledPayloads',
        value: 100,
        unit: 'percent',
        description: 'Unmatched payloads are handled instead of skipped.',
      },
      confidence: 80,
      riskLevel: 'MEDIUM',
      requiresApproval: false,
      changes: [{ kind: 'ADD_EDGE', edge: { source: 'cond', target: 'log_miss', condition: 'false' } }],
      evidence: [],
      ...overrides,
    };
  }

  async function createManualPlan(options: {
    recommendations?: OptimizationRecommendation[];
    approvalRequired?: boolean;
    riskLevel?: OptimizationRecommendation['riskLevel'];
  } = {}) {
    return WorkflowOptimizationModel.create({
      workspaceId,
      workflowId,
      createdBy: userId,
      type: 'RELIABILITY_OPTIMIZATION',
      status: 'PENDING',
      recommendations: options.recommendations ?? [buildRecommendation()],
      confidence: 75,
      riskLevel: options.riskLevel ?? 'MEDIUM',
      expectedImpact: { summary: 'manual plan' },
      approvalRequired: options.approvalRequired ?? false,
    });
  }
  describe('Optimization analysis engine', () => {
    it('profiles workflow performance from execution history', async () => {
      const result = await service.analyzeWorkflow(workflowId.toString(), workspaceId.toString(), userId.toString());

      expect(result.workflowId).toBe(workflowId.toString());
      expect(result.workflowName).toBe('Order Routing');
      expect(result.performance.sampleSize).toBe(12);
      expect(result.performance.windowDays).toBe(30);
      expect(result.performance.durations.avgMs).toBeGreaterThan(0);
      expect(result.performance.durations.p95Ms).toBeGreaterThanOrEqual(result.performance.durations.avgMs);
      expect(result.performance.reliability.failureRate).toBeCloseTo(33.33, 1);
      expect(result.performance.reliability.timeoutExecutions).toBe(2);
      expect(result.performance.reliability.totalRetries).toBe(6);

      const slowNode = result.performance.nodes.find((node) => node.nodeId === 'log_hit');
      expect(slowNode).toBeDefined();
      expect(slowNode?.failures).toBe(4);
      expect(slowNode?.runs).toBe(12);
      expect(slowNode?.failureRate).toBeCloseTo(33.33, 1);
      expect(slowNode?.avgDurationMs).toBe(3000);
    });    it('detects architecture, reliability and performance bottlenecks', async () => {
      const result = await service.analyzeWorkflow(workflowId.toString(), workspaceId.toString(), userId.toString());
      const categories = result.bottlenecks.map((bottleneck) => bottleneck.category);

      const redundant = result.bottlenecks.find((bottleneck) => bottleneck.evidence.includes('edge=wh->log_hit'));
      expect(redundant).toBeDefined();
      expect(redundant?.category).toBe('ARCHITECTURE_OPTIMIZATION');

      const missingFallback = result.bottlenecks.find(
        (bottleneck) => bottleneck.nodeId === 'cond' && bottleneck.evidence.includes('missing false-condition edge'),
      );
      expect(missingFallback).toBeDefined();
      expect(missingFallback?.category).toBe('RELIABILITY_OPTIMIZATION');

      const failingNode = result.bottlenecks.find(
        (bottleneck) => bottleneck.nodeId === 'log_hit' && bottleneck.category === 'RELIABILITY_OPTIMIZATION',
      );
      expect(failingNode).toBeDefined();

      expect(categories).toContain('PERFORMANCE_OPTIMIZATION');
    });

    it('rejects analysis for a workflow outside the workspace', async () => {
      const otherWorkspaceId = new Types.ObjectId().toString();
      await expect(
        service.analyzeWorkflow(workflowId.toString(), otherWorkspaceId, userId.toString()),
      ).rejects.toThrow('WORKFLOW_NOT_FOUND');
      await expect(
        service.analyzeWorkflow('not-an-object-id', workspaceId.toString(), userId.toString()),
      ).rejects.toThrow('INVALID_WORKFLOW_ID');
    });
  });
  describe('Optimization plan generation', () => {
    it('generates a pending plan with actionable and advisory recommendations', async () => {
      const plan = await service.generateOptimizationPlan(workflowId.toString(), workspaceId.toString(), userId.toString());

      expect(plan.status).toBe('PENDING');
      expect(plan.workspaceId.toString()).toBe(workspaceId.toString());
      expect(plan.workflowId.toString()).toBe(workflowId.toString());
      expect(plan.recommendations.length).toBeGreaterThan(0);
      expect(plan.approvalRequired).toBe(false);
      expect(['LOW', 'MEDIUM', 'HIGH']).toContain(plan.riskLevel);
      expect(plan.expectedImpact.summary).toContain('recommendation');
      expect(typeof plan.aiExplanation).toBe('string');

      const actionable = plan.recommendations.filter((recommendation) => recommendation.changes.length > 0);
      expect(actionable.length).toBeGreaterThanOrEqual(2);
      const kinds = actionable.flatMap((recommendation) => recommendation.changes.map((change) => change.kind));
      expect(kinds).toContain('REMOVE_EDGE');
      expect(kinds).toContain('ADD_EDGE');
    });
  });
  describe('Approval workflow', () => {
    it('approves and rejects pending plans with state guards', async () => {
      const plan = await createManualPlan();
      const approved = await service.approvePlan(plan._id.toString(), userId.toString(), workspaceId.toString(), 'looks good');
      expect(approved.status).toBe('APPROVED');
      expect(approved.approvedBy?.toString()).toBe(userId.toString());
      await expect(
        service.approvePlan(plan._id.toString(), userId.toString(), workspaceId.toString()),
      ).rejects.toThrow('OPTIMIZATION_PLAN_NOT_PENDING');

      const rejectedPlan = await createManualPlan();
      const rejected = await service.rejectPlan(rejectedPlan._id.toString(), userId.toString(), workspaceId.toString(), 'too risky');
      expect(rejected.status).toBe('REJECTED');
      expect(rejected.rejectionReason).toBe('too risky');
      await expect(
        service.applyPlan(rejectedPlan._id.toString(), userId.toString(), workspaceId.toString()),
      ).rejects.toThrow('OPTIMIZATION_PLAN_NOT_APPLICABLE');
    });

    it('blocks apply until a gated plan is approved', async () => {
      const plan = await createManualPlan({ approvalRequired: true, riskLevel: 'HIGH' });
      await expect(
        service.applyPlan(plan._id.toString(), userId.toString(), workspaceId.toString()),
      ).rejects.toThrow('OPTIMIZATION_PLAN_APPROVAL_REQUIRED');

      await service.approvePlan(plan._id.toString(), userId.toString(), workspaceId.toString());
      const result = await service.applyPlan(plan._id.toString(), userId.toString(), workspaceId.toString());
      expect(result.applied).toBe(true);
      expect(result.plan.status).toBe('APPLIED');
      await expect(
        service.applyPlan(plan._id.toString(), userId.toString(), workspaceId.toString()),
      ).rejects.toThrow('OPTIMIZATION_PLAN_ALREADY_APPLIED');
    });
  });
  describe('Safe workflow version creation', () => {
    it('applies a plan into a DRAFT workflow version without publishing', async () => {
      const plan = await service.generateOptimizationPlan(workflowId.toString(), workspaceId.toString(), userId.toString());
      const result = await service.applyPlan(plan._id.toString(), userId.toString(), workspaceId.toString());

      expect(result.applied).toBe(true);
      expect(result.version?.status).toBe('DRAFT');
      expect(result.version?.versionNumber).toBe(1);
      expect(result.validationErrors).toEqual([]);
      expect(result.beforeAfter?.identical).toBe(false);
      expect(result.beforeAfter?.edges.removed).toContain('wh->log_hit');
      expect(result.beforeAfter?.edges.added).toContain('cond->log_miss (false)');

      const workflow = await WorkflowModel.findById(workflowId);
      expect(workflow?.status).toBe('DRAFT');
      expect(workflow?.latestVersionNumber).toBe(1);
      const edges = (workflow?.draftDefinition?.edges ?? []) as Array<{ source: string; target: string; condition?: string }>;
      expect(edges.some((edge) => edge.source === 'cond' && edge.target === 'log_miss' && edge.condition === 'false')).toBe(true);
      expect(edges.some((edge) => edge.source === 'wh' && edge.target === 'log_hit')).toBe(false);

      const versions = await WorkflowVersionModel.find({ workflowId });
      expect(versions.length).toBe(1);
      expect(versions[0]?.status).toBe('DRAFT');
      expect(versions[0]?.versionNumber).toBe(1);

      const applied = await WorkflowOptimizationModel.findById(plan._id);
      expect(applied?.status).toBe('APPLIED');
      expect(applied?.appliedVersionNumber).toBe(1);
      expect(applied?.appliedVersionId?.toString()).toBe(result.version?.id);
    });    it('marks the plan failed when the candidate definition is invalid', async () => {
      const plan = await createManualPlan({
        recommendations: [
          buildRecommendation({
            changes: [{ kind: 'ADD_EDGE', edge: { source: 'ghost_node', target: 'log_miss' } }],
          }),
        ],
      });
      const result = await service.applyPlan(plan._id.toString(), userId.toString(), workspaceId.toString());

      expect(result.applied).toBe(false);
      expect(result.version).toBeNull();
      expect(result.validationErrors.length).toBeGreaterThan(0);

      const failed = await WorkflowOptimizationModel.findById(plan._id);
      expect(failed?.status).toBe('FAILED');
      expect(failed?.failureReason).toBeTruthy();
      expect(await WorkflowVersionModel.countDocuments({ workflowId })).toBe(0);
      const workflow = await WorkflowModel.findById(workflowId);
      expect(workflow?.latestVersionNumber).toBe(0);
    });

    it('refuses plans without applicable changes', async () => {
      const plan = await createManualPlan({ recommendations: [buildRecommendation({ changes: [] })] });
      await expect(
        service.applyPlan(plan._id.toString(), userId.toString(), workspaceId.toString()),
      ).rejects.toThrow('OPTIMIZATION_NO_APPLICABLE_CHANGES');
    });
  });
  describe('Workspace isolation and queries', () => {
    it('scopes plans to their workspace', async () => {
      const plan = await createManualPlan();
      const otherWorkspaceId = new Types.ObjectId().toString();

      expect(await service.getPlanById(plan._id.toString(), otherWorkspaceId)).toBeNull();
      await expect(
        service.approvePlan(plan._id.toString(), userId.toString(), otherWorkspaceId),
      ).rejects.toThrow('OPTIMIZATION_PLAN_NOT_FOUND');
      await expect(service.listPlans(workspaceId.toString())).resolves.toHaveLength(1);
      await expect(service.listPlans(otherWorkspaceId)).resolves.toHaveLength(0);
    });

    it('validates plan listing filters', async () => {
      await createManualPlan();
      await expect(service.listPlans(workspaceId.toString(), { status: 'PENDING' })).resolves.toHaveLength(1);
      await expect(
        service.listPlans(workspaceId.toString(), { status: 'BOGUS' }),
      ).rejects.toThrow('INVALID_OPTIMIZATION_STATUS');
      await expect(
        service.listPlans(workspaceId.toString(), { workflowId: 'not-an-id' }),
      ).rejects.toThrow('INVALID_WORKFLOW_ID');
    });
  });

  describe('Audit logging', () => {
    it('records lifecycle audit entries for the workspace', async () => {
      const plan = await service.generateOptimizationPlan(workflowId.toString(), workspaceId.toString(), userId.toString());
      await service.approvePlan(plan._id.toString(), userId.toString(), workspaceId.toString());
      await service.applyPlan(plan._id.toString(), userId.toString(), workspaceId.toString());

      const actions = await AuditLogModel.find({ workspaceId }).distinct('action');
      expect(actions).toContain('AI_OPTIMIZATION_ANALYSIS_COMPLETED');
      expect(actions).toContain('AI_OPTIMIZATION_PLAN_CREATED');
      expect(actions).toContain('AI_OPTIMIZATION_PLAN_APPROVED');
      expect(actions).toContain('AI_OPTIMIZATION_PLAN_APPLIED');
      expect(actions).not.toContain('AI_OPTIMIZATION_PLAN_FAILED');
    });
  });
});