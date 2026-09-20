import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { SelfHealingService } from '../src/services/selfHealingService.js';
import { SelfHealingPolicyModel } from '../src/models/SelfHealingPolicyModel.js';
import { SelfHealingIncidentModel } from '../src/models/SelfHealingIncidentModel.js';
import { WorkspaceModel } from '../src/models/WorkspaceModel.js';
import { WorkflowModel } from '../src/models/WorkflowModel.js';
import { WorkflowExecutionModel } from '../src/models/WorkflowExecutionModel.js';
import { hashExecutionInput } from '../src/services/executionService.js';
import { createExecutionJobId } from '../src/queues/executionQueue.js';

describe('Module 12A — Autonomous Self-Healing & Closed-Loop Remediation Engine', () => {
  let replSet: MongoMemoryReplSet;
  const selfHealingService = SelfHealingService.getInstance();
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
    await SelfHealingPolicyModel.deleteMany({});
    await SelfHealingIncidentModel.deleteMany({});
    await WorkspaceModel.deleteMany({});
    await WorkflowModel.deleteMany({});
    await WorkflowExecutionModel.deleteMany({});

    userId = new Types.ObjectId();
    const ws = await WorkspaceModel.create({
      name: 'Self-Healing Test Workspace',
      slug: 'self-healing-ws',
      ownerId: userId,
    });
    workspaceId = ws._id;

    const wf = await WorkflowModel.create({
      name: 'Order Processing Pipeline',
      ownerId: userId,
      workspaceId,
      status: 'PUBLISHED',
      latestVersionNumber: 1,
      draftDefinition: {
        nodes: [
          { id: 'start', type: 'webhook', config: {} },
          { id: 'payment', type: 'condition', config: {} },
        ],
        edges: [{ source: 'start', target: 'payment' }],
      },
    });
    workflowId = wf._id;
  });

  function createTestExecution(data: Partial<any> = {}) {
    const execId = new Types.ObjectId();
    const input = data.input || { test: 'value' };
    return WorkflowExecutionModel.create({
      _id: execId,
      workflowId,
      workflowVersionId: new Types.ObjectId(),
      workspaceId,
      ownerId: userId,
      versionNumber: 1,
      jobId: createExecutionJobId(execId.toString()),
      idempotencyKey: `idem-${execId.toString()}`,
      inputHash: hashExecutionInput(input),
      input,
      status: 'FAILED',
      attemptsMade: 1,
      maxRetries: 3,
      retryCount: 1,
      statusHistory: [{ status: 'FAILED', timestamp: new Date() }],
      ...data,
    });
  }

  it('should create, list, update, and delete self-healing policies', async () => {
    const policy = await selfHealingService.createPolicy(workspaceId.toString(), {
      name: 'Rate Limit Adaptive Backoff',
      description: 'Auto-retries with exponential delay on HTTP 429',
      triggerCondition: 'RATE_LIMIT_EXCEEDED',
      triggerValue: 'RATE_LIMIT_EXCEEDED',
      actionType: 'AUTO_RETRY_WITH_ADAPTED_PARAMS',
      actionConfig: { retryDelayMs: 5000, maxAttempts: 5 },
      isEnabled: true,
      priority: 1,
    });

    expect(policy).toBeDefined();
    expect(policy.name).toBe('Rate Limit Adaptive Backoff');
    expect(policy.priority).toBe(1);

    const list = await selfHealingService.listPolicies(workspaceId.toString());
    expect(list.length).toBe(1);
    expect(list[0]?.name).toBe('Rate Limit Adaptive Backoff');

    const updated = await selfHealingService.updatePolicy(
      policy._id.toString(),
      workspaceId.toString(),
      { isEnabled: false }
    );
    expect(updated?.isEnabled).toBe(false);

    const deleted = await selfHealingService.deletePolicy(
      policy._id.toString(),
      workspaceId.toString()
    );
    expect(deleted).toBe(true);

    const listAfter = await selfHealingService.listPolicies(workspaceId.toString());
    expect(listAfter.length).toBe(0);
  });

  it('should autonomously evaluate execution failure and execute auto-remediation without approval for low-risk policy', async () => {
    await selfHealingService.createPolicy(workspaceId.toString(), {
      name: 'Timeout Auto-Retry',
      triggerCondition: 'TIMEOUT_PATTERN',
      triggerValue: 'EXECUTION_TIMEOUT',
      actionType: 'AUTO_RETRY_WITH_ADAPTED_PARAMS',
      actionConfig: { retryDelayMs: 3000 },
      isEnabled: true,
      priority: 1,
    });

    const failedExecution = await createTestExecution({
      error: {
        code: 'EXECUTION_TIMEOUT',
        message: 'Step execution timed out after 5000ms',
      },
    });

    const incident = await selfHealingService.evaluateExecutionFailure(
      failedExecution._id.toString(),
      workspaceId.toString()
    );

    expect(incident).toBeDefined();
    expect(incident?.status).toBe('EXECUTED');
    expect(incident?.requiresApproval).toBe(false);
    expect(incident?.actionType).toBe('AUTO_RETRY_WITH_ADAPTED_PARAMS');
    expect(incident?.result).toBeDefined();
    expect(incident?.result?.action).toBe('ADAPTIVE_RETRY_SCHEDULED');
  });

  it('should gate high-risk actions (CIRCUIT_BREAKER_TRIP / PARAMETER_MUTATION) behind approval flow', async () => {
    await selfHealingService.createPolicy(workspaceId.toString(), {
      name: 'Circuit Breaker on Downstream API Failure',
      triggerCondition: 'ERROR_CODE_MATCH',
      triggerValue: 'DOWNSTREAM_UNAVAILABLE',
      actionType: 'CIRCUIT_BREAKER_TRIP',
      actionConfig: { durationMs: 120000 },
      isEnabled: true,
      priority: 1,
    });

    const failedExecution = await createTestExecution({
      attemptsMade: 3,
      retryCount: 3,
      input: { service: 'payment-gateway' },
      error: {
        code: 'DOWNSTREAM_UNAVAILABLE',
        message: 'Payment gateway returned 503 Service Unavailable',
      },
    });

    const incident = await selfHealingService.evaluateExecutionFailure(
      failedExecution._id.toString(),
      workspaceId.toString()
    );

    expect(incident).toBeDefined();
    expect(incident?.status).toBe('PENDING_APPROVAL');
    expect(incident?.requiresApproval).toBe(true);
    expect(incident?.approvalToken).toBeDefined();

    // Test approve incident
    const approvedIncident = await selfHealingService.approveIncident(
      incident!._id.toString(),
      userId.toString(),
      incident!.approvalToken
    );

    expect(approvedIncident.status).toBe('RESOLVED');
    expect(approvedIncident.approvedBy?.toString()).toBe(userId.toString());
    expect(approvedIncident.result?.action).toBe('CIRCUIT_BREAKER_TRIPPED');
  });

  it('should allow rejecting a pending approval incident with reason', async () => {
    const failedExecution = await createTestExecution({
      input: { payload: 'invalid' },
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Data schema validation failed',
      },
    });

    const incident = await selfHealingService.evaluateExecutionFailure(
      failedExecution._id.toString(),
      workspaceId.toString(),
      { forceApproval: true }
    );

    expect(incident?.status).toBe('PENDING_APPROVAL');

    const rejectedIncident = await selfHealingService.rejectIncident(
      incident!._id.toString(),
      userId.toString(),
      'Requires manual investigation of source payload'
    );

    expect(rejectedIncident.status).toBe('REJECTED');
    expect(rejectedIncident.rejectionReason).toBe('Requires manual investigation of source payload');
    expect(rejectedIncident.rejectedBy?.toString()).toBe(userId.toString());
  });
});
