import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { SelfHealingService } from '../src/services/selfHealingService.js';
import { SelfHealingDecisionService } from '../src/services/selfHealingDecisionService.js';
import { SelfHealingPolicyModel } from '../src/models/SelfHealingPolicyModel.js';
import { SelfHealingIncidentModel } from '../src/models/SelfHealingIncidentModel.js';
import { WorkspaceModel } from '../src/models/WorkspaceModel.js';
import { WorkflowModel } from '../src/models/WorkflowModel.js';
import { WorkflowExecutionModel } from '../src/models/WorkflowExecutionModel.js';
import { hashExecutionInput } from '../src/services/executionService.js';
import { createExecutionJobId } from '../src/queues/executionQueue.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';

describe('Module 12C — Self-Healing Autonomous Execution Engine (Phase 12.3)', () => {
  let replSet: MongoMemoryReplSet;
  const decisionService = SelfHealingDecisionService.getInstance();
  const selfHealingService = SelfHealingService.getInstance();
  let workspaceId: Types.ObjectId;
  let userId: Types.ObjectId;
  let workflowId: Types.ObjectId;
  let secondWorkspaceId: Types.ObjectId;
  let secondUserId: Types.ObjectId;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    if (replSet) await replSet.stop();
  }, 30000);

  beforeEach(async () => {
    await SelfHealingPolicyModel.deleteMany({});
    await SelfHealingIncidentModel.deleteMany({});
    await WorkspaceModel.deleteMany({});
    await WorkflowModel.deleteMany({});
    await WorkflowExecutionModel.deleteMany({});
    await AuditLogModel.deleteMany({});

    userId = new Types.ObjectId();
    secondUserId = new Types.ObjectId();
    workspaceId = new Types.ObjectId();
    secondWorkspaceId = new Types.ObjectId();
    workflowId = new Types.ObjectId();

    await WorkspaceModel.create({
      _id: workspaceId,
      name: 'Test Workspace',
      slug: 'test-ws',
      ownerId: userId,
    });

    await WorkspaceModel.create({
      _id: secondWorkspaceId,
      name: 'Second Workspace',
      slug: 'second-ws',
      ownerId: secondUserId,
    });

    const wf = await WorkflowModel.create({
      _id: workflowId,
      name: 'Test Workflow',
      ownerId: userId,
      workspaceId,
      status: 'PUBLISHED',
      latestVersionNumber: 1,
      draftDefinition: {
        nodes: [
          { id: 'start', type: 'webhook', config: {} },
          { id: 'process', type: 'condition', config: {} },
        ],
        edges: [{ source: 'start', target: 'process' }],
      },
    });
  });

  const createFailedExecution = async (overrides: {
    error?: { code?: string; message?: string };
    retryCount?: number;
    attemptsMade?: number;
    maxRetries?: number;
  } = {}) => {
    return WorkflowExecutionModel.create({
      workflowId,
      ownerId: userId,
      workspaceId,
      workflowVersionId: new Types.ObjectId(),
      versionNumber: 1,
      jobId: `job-${new Types.ObjectId().toString()}`,
      idempotencyKey: `idem-${new Types.ObjectId().toString()}`,
      inputHash: `hash-${new Types.ObjectId().toString()}`,
      input: {},
      status: 'FAILED',
      error: {
        code: overrides.error?.code || 'UNKNOWN_ERROR',
        message: overrides.error?.message || 'Execution failed',
      },
      attemptsMade: overrides.attemptsMade ?? 1,
      retryCount: overrides.retryCount ?? 0,
      maxRetries: overrides.maxRetries ?? 3,
      statusHistory: [{ status: 'FAILED', timestamp: new Date() }],
      startedAt: new Date(Date.now() - 1000),
      finishedAt: new Date(),
    });
  };

  // ─── Failure Analysis & Recovery Plan Tests ────────────────────────────────

  it('should analyze failure and generate recovery plan for known error type', async () => {
    await selfHealingService.createPolicy(workspaceId.toString(), {
      name: 'Timeout Retry Policy',
      failureTypes: ['timeout'],
      triggerCondition: 'TIMEOUT_PATTERN',
      triggerValue: 'EXECUTION_TIMEOUT',
      actionType: 'RETRY_NODE',
      actionConfig: { delayMs: 3000, retryCount: 3 },
      isEnabled: true,
      priority: 1,
      maxAutomaticRetries: 3,
      requireApproval: false,
    });

    const failedExec = await createFailedExecution({
      error: { code: 'EXECUTION_TIMEOUT', message: 'Step execution timed out after 5000ms' },
      retryCount: 0,
      attemptsMade: 1,
    });

    const plan = await decisionService.getRecommendations(failedExec._id.toString(), workspaceId.toString());

    expect(plan).toBeDefined();
    expect(plan.actions.length).toBeGreaterThan(0);
    expect(plan.actions[0]!.action).toBe('RETRY_NODE');
    expect(plan.actions[0]!.confidence).toBeGreaterThanOrEqual(60);
    expect(plan.actions[0]!.riskLevel).toBe('LOW');
    expect(plan.requiresApproval).toBe(false);
    expect(plan.overallRisk).toBe('LOW');
  });

  it('should generate recovery plan for rate limit errors', async () => {
    await selfHealingService.createPolicy(workspaceId.toString(), {
      name: 'Rate Limit Throttling Policy',
      failureTypes: ['rate_limit'],
      triggerCondition: 'RATE_LIMIT_EXCEEDED',
      triggerValue: 'RATE_LIMIT_EXCEEDED',
      actionType: 'AUTO_RETRY_WITH_ADAPTED_PARAMS',
      actionConfig: { retryDelayMs: 10000, backoffFactor: 2 },
      isEnabled: true,
      priority: 1,
      maxAutomaticRetries: 5,
      requireApproval: false,
    });

    const failedExec = await createFailedExecution({
      error: { code: 'RATE_LIMIT_EXCEEDED', message: 'HTTP 429: Too Many Requests' },
      retryCount: 0,
      attemptsMade: 1,
    });

    const plan = await decisionService.getRecommendations(failedExec._id.toString(), workspaceId.toString());

    expect(plan).toBeDefined();
    expect(plan.actions.length).toBeGreaterThan(0);
    expect(['AUTO_RETRY_WITH_ADAPTED_PARAMS', 'RETRY_NODE']).toContain(plan.actions[0]!.action);
  });

  it('should generate default recovery plan when no policy matches', async () => {
    const failedExec = await createFailedExecution({
      error: { code: 'UNKNOWN_ERROR', message: 'Something unexpected happened' },
      retryCount: 0,
      attemptsMade: 1,
    });

    const plan = await decisionService.getRecommendations(failedExec._id.toString(), workspaceId.toString());

    expect(plan).toBeDefined();
    expect(plan.actions.length).toBeGreaterThan(0);
    expect(plan.actions[0]!.action).toBe('RETRY_NODE');
    expect(plan.actions[0]!.confidence).toBe(60);
    expect(plan.overallRisk).toBe('LOW');
  });

  it('should escalate to human when retries exhausted', async () => {
    const failedExec = await createFailedExecution({
      error: { code: 'UNKNOWN_ERROR', message: 'Persistent failure' },
      retryCount: 5,
      attemptsMade: 6,
      maxRetries: 3,
    });

    const plan = await decisionService.getRecommendations(failedExec._id.toString(), workspaceId.toString());

    expect(plan).toBeDefined();
    expect(plan.actions.length).toBeGreaterThan(0);
    const actions = plan.actions.map(a => a.action);
    expect(actions).toContain('RETRY_NODE');
    expect(actions).toContain('ESCALATE_TO_HUMAN');
    expect(plan.requiresApproval).toBe(true);
    expect(plan.overallRisk).toBe('HIGH');
  });

  it('should respect failureTypes filtering in policy matching', async () => {
    await selfHealingService.createPolicy(workspaceId.toString(), {
      name: 'Network Only Policy',
      failureTypes: ['network'],
      triggerCondition: 'ERROR_CODE_MATCH',
      triggerValue: '*',
      actionType: 'USE_FALLBACK_NODE',
      actionConfig: { fallbackNodeId: 'network_fallback' },
      isEnabled: true,
      priority: 1,
      maxAutomaticRetries: 2,
      requireApproval: false,
    });

    // Timeout error should NOT match network-only policy
    const timeoutExec = await createFailedExecution({
      error: { code: 'EXECUTION_TIMEOUT', message: 'Timed out' },
      retryCount: 0,
      attemptsMade: 1,
    });

    const timeoutPlan = await decisionService.getRecommendations(
      timeoutExec._id.toString(),
      workspaceId.toString(),
    );

    // Should fall back to default plan since no policy matches
    expect(timeoutPlan.actions[0]!.action).toBe('RETRY_NODE');
    expect(timeoutPlan.actions[0]!.confidence).toBe(60);
  });

  it('should use allowedActions to filter generated actions', async () => {
    await selfHealingService.createPolicy(workspaceId.toString(), {
      name: 'Limited Actions Policy',
      failureTypes: ['timeout'],
      triggerCondition: 'TIMEOUT_PATTERN',
      triggerValue: 'EXECUTION_TIMEOUT',
      actionType: 'USE_FALLBACK_NODE',
      allowedActions: ['USE_FALLBACK_NODE'],
      actionConfig: { fallbackNodeId: 'fallback1' },
      isEnabled: true,
      priority: 1,
      maxAutomaticRetries: 2,
      requireApproval: false,
    });

    const failedExec = await createFailedExecution({
      error: { code: 'EXECUTION_TIMEOUT', message: 'Timed out' },
      retryCount: 0,
      attemptsMade: 1,
    });

    const plan = await decisionService.getRecommendations(
      failedExec._id.toString(),
      workspaceId.toString(),
    );

    // Only allowed action should be included
    expect(plan.actions.length).toBe(1);
    expect(plan.actions[0]!.action).toBe('USE_FALLBACK_NODE');
  });

  // ─── Confidence & Risk Scoring Tests ─────────────────────────────────────────

  it('should calculate higher confidence for exact error code matches', async () => {
    await selfHealingService.createPolicy(workspaceId.toString(), {
      name: 'Exact Match Policy',
      triggerCondition: 'ERROR_CODE_MATCH',
      triggerValue: 'EXACT_ERROR_CODE',
      actionType: 'RETRY_NODE',
      actionConfig: {},
      priority: 10,
      maxAutomaticRetries: 3,
      requireApproval: false,
    });

    const failedExec = await createFailedExecution({
      error: { code: 'EXACT_ERROR_CODE', message: 'Exact match test' },
      retryCount: 0,
      attemptsMade: 1,
    });

    const plan = await decisionService.getRecommendations(
      failedExec._id.toString(),
      workspaceId.toString(),
    );

    // Exact match: base 70 + 15 (exact) + 0 (priority 10 not <= 5) = 85
    expect(plan.actions[0]!.confidence).toBeGreaterThanOrEqual(80);
  });


  it('should reduce confidence for wildcard trigger values', async () => {
    await selfHealingService.createPolicy(workspaceId.toString(), {
      name: 'Wildcard Policy',
      triggerCondition: 'ERROR_CODE_MATCH',
      triggerValue: '*',
      actionType: 'RETRY_NODE',
      actionConfig: {},
      priority: 10,
      maxAutomaticRetries: 3,
      requireApproval: false,
    });

    const failedExec = await createFailedExecution({
      error: { code: 'SOME_ERROR', message: 'Test' },
      retryCount: 0,
      attemptsMade: 1,
    });

    const plan = await decisionService.getRecommendations(
      failedExec._id.toString(),
      workspaceId.toString(),
    );

    expect(plan.actions[0]!.confidence).toBe(60);
  });

  it('should reduce confidence for repeated failures', async () => {
    await selfHealingService.createPolicy(workspaceId.toString(), {
      name: 'Repeated Failure Policy',
      triggerCondition: 'ERROR_CODE_MATCH',
      triggerValue: 'REPEATED_ERROR',
      actionType: 'RETRY_NODE',
      actionConfig: {},
      priority: 10,
      maxAutomaticRetries: 3,
      requireApproval: false,
    });

    const failedExec = await createFailedExecution({
      error: { code: 'REPEATED_ERROR', message: 'Failed again' },
      retryCount: 4,
      attemptsMade: 5,
    });

    const plan = await decisionService.getRecommendations(
      failedExec._id.toString(),
      workspaceId.toString(),
    );

    expect(plan.actions[0]!.confidence).toBeLessThan(70);
    expect(plan.actions[0]!.confidence).toBe(55);
  });

  it('should boost confidence for high-priority policies', async () => {
    await selfHealingService.createPolicy(workspaceId.toString(), {
      name: 'High Priority Policy',
      triggerCondition: 'ERROR_CODE_MATCH',
      triggerValue: 'HIGH_PRIORITY_ERROR',
      actionType: 'RETRY_NODE',
      actionConfig: {},
      priority: 3,
      maxAutomaticRetries: 3,
      requireApproval: false,
    });

    const failedExec = await createFailedExecution({
      error: { code: 'HIGH_PRIORITY_ERROR', message: 'High priority' },
      retryCount: 0,
      attemptsMade: 1,
    });

    const plan = await decisionService.getRecommendations(
      failedExec._id.toString(),
      workspaceId.toString(),
    );

    expect(plan.actions[0]!.confidence).toBe(95);
  });

  it('should classify actions correctly by risk level', async () => {
    expect((decisionService as any).calcRisk('ESCALATE_TO_HUMAN' as any, { previousRetries: 0 })).toBe('HIGH');
    expect((decisionService as any).calcRisk('CIRCUIT_BREAKER_TRIP' as any, { previousRetries: 0 })).toBe('HIGH');
    expect((decisionService as any).calcRisk('PARAMETER_MUTATION_HEAL' as any, { previousRetries: 0 })).toBe('HIGH');
    expect((decisionService as any).calcRisk('USE_FALLBACK_NODE' as any, { previousRetries: 0 })).toBe('MEDIUM');
    expect((decisionService as any).calcRisk('CHANGE_PARAMETER' as any, { previousRetries: 0 })).toBe('MEDIUM');
    expect((decisionService as any).calcRisk('FALLBACK_ROUTE' as any, { previousRetries: 0 })).toBe('MEDIUM');
    expect((decisionService as any).calcRisk('RETRY_NODE' as any, { previousRetries: 0 })).toBe('LOW');
    expect((decisionService as any).calcRisk('INCREASE_TIMEOUT' as any, { previousRetries: 0 })).toBe('LOW');
  });
  it('should reduce confidence for wildcard trigger values', async () => {
    await selfHealingService.createPolicy(workspaceId.toString(), {
      name: 'Wildcard Trigger Policy',
      triggerCondition: 'ERROR_CODE_MATCH',
      triggerValue: '*',
      actionType: 'RETRY_NODE',
      actionConfig: {},
      priority: 10,
      maxAutomaticRetries: 3,
      requireApproval: false,
    });

    const failedExec = await createFailedExecution({
      error: { code: 'SOME_ERROR', message: 'Test' },
      retryCount: 0,
      attemptsMade: 1,
    });

    const plan = await decisionService.getRecommendations(
      failedExec._id.toString(),
      workspaceId.toString(),
    );

    // Base 70 - 10 (wildcard) = 60
    expect(plan.actions[0]!.confidence).toBe(60);
  });

  it('should reduce confidence for repeated failures', async () => {
    await selfHealingService.createPolicy(workspaceId.toString(), {
      name: 'Repeated Failure Policy',
      triggerCondition: 'ERROR_CODE_MATCH',
      triggerValue: 'REPEATED_ERROR',
      actionType: 'RETRY_NODE',
      actionConfig: {},
      priority: 10,
      maxAutomaticRetries: 3,
      requireApproval: false,
    });

    const failedExec = await createFailedExecution({
      error: { code: 'REPEATED_ERROR', message: 'Failed again' },
      retryCount: 4,
      attemptsMade: 5,
    });

    const plan = await decisionService.getRecommendations(
      failedExec._id.toString(),
      workspaceId.toString(),
    );

    // Base 70 - 15 (retries > 2) = 55
    expect(plan.actions[0]!.confidence).toBeLessThan(70);
    expect(plan.actions[0]!.confidence).toBe(55);
  });

  it('should boost confidence for high-priority policies', async () => {
    await selfHealingService.createPolicy(workspaceId.toString(), {
      name: 'High Priority Policy',
      triggerCondition: 'ERROR_CODE_MATCH',
      triggerValue: 'HIGH_PRIORITY_ERROR',
      actionType: 'RETRY_NODE',
      actionConfig: {},
      priority: 3,
      maxAutomaticRetries: 3,
      requireApproval: false,
    });

    const failedExec = await createFailedExecution({
      error: { code: 'HIGH_PRIORITY_ERROR', message: 'High priority error' },
      retryCount: 0,
      attemptsMade: 1,
    });

    const plan = await decisionService.getRecommendations(
      failedExec._id.toString(),
      workspaceId.toString(),
    );

    // Base 70 + 15 (exact) + 10 (priority <= 5) = 95, capped at 95
    expect(plan.actions[0]!.confidence).toBe(95);
  });

  it('should classify actions correctly by risk level', async () => {
    // High risk
    expect(decisionService['calcRisk']('ESCALATE_TO_HUMAN' as any, { previousRetries: 0 })).toBe('HIGH');
    expect(decisionService['calcRisk']('CIRCUIT_BREAKER_TRIP' as any, { previousRetries: 0 })).toBe('HIGH');
    expect(decisionService['calcRisk']('PARAMETER_MUTATION_HEAL' as any, { previousRetries: 0 })).toBe('HIGH');
    // Medium risk
    expect(decisionService['calcRisk']('USE_FALLBACK_NODE' as any, { previousRetries: 0 })).toBe('MEDIUM');
    expect(decisionService['calcRisk']('CHANGE_PARAMETER' as any, { previousRetries: 0 })).toBe('MEDIUM');
    expect(decisionService['calcRisk']('FALLBACK_ROUTE' as any, { previousRetries: 0 })).toBe('MEDIUM');
    // Low risk
    expect(decisionService['calcRisk']('RETRY_NODE' as any, { previousRetries: 0 })).toBe('LOW');
    expect(decisionService['calcRisk']('INCREASE_TIMEOUT' as any, { previousRetries: 0 })).toBe('LOW');
    expect(decisionService['calcRisk']('AUTO_RETRY_WITH_ADAPTED_PARAMS' as any, { previousRetries: 0 })).toBe('LOW');
  });

});
