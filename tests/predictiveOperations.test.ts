import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { PredictiveOperationsService } from '../src/services/predictiveOperationsService.js';
import { AutonomousOptimizerService } from '../src/services/autonomousOptimizerService.js';
import { PredictiveAnomalyModel } from '../src/models/PredictiveAnomalyModel.js';
import { WorkspaceModel } from '../src/models/WorkspaceModel.js';
import { WorkflowModel } from '../src/models/WorkflowModel.js';
import { WorkflowExecutionModel } from '../src/models/WorkflowExecutionModel.js';
import { hashExecutionInput } from '../src/services/executionService.js';
import { createExecutionJobId } from '../src/queues/executionQueue.js';

describe('Module 12D — Predictive Operations & Autonomous Optimization', () => {
  let replSet: MongoMemoryReplSet;
  const predictiveService = PredictiveOperationsService.getInstance();
  const optimizerService = AutonomousOptimizerService.getInstance();
  let workspaceId: Types.ObjectId;
  let userId: Types.ObjectId;
  let workflowId: Types.ObjectId;
  let executionId: Types.ObjectId;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    if (replSet) await replSet.stop();
  }, 30000);

  beforeEach(async () => {
    await PredictiveAnomalyModel.deleteMany({});
    await WorkspaceModel.deleteMany({});
    await WorkflowModel.deleteMany({});
    await WorkflowExecutionModel.deleteMany({});

    userId = new Types.ObjectId();
    const ws = await WorkspaceModel.create({
      name: 'Predictive Ops Test Workspace',
      slug: 'predictive-ops-ws',
      ownerId: userId,
    });
    workspaceId = ws._id;

    const wf = await WorkflowModel.create({
      name: 'Customer Ingestion Pipeline',
      ownerId: userId,
      workspaceId,
      status: 'PUBLISHED',
      latestVersionNumber: 1,
      draftDefinition: {
        nodes: [
          { id: 'node_1', type: 'webhook', config: {} },
          { id: 'node_2', type: 'condition', config: {} },
          { id: 'node_3', type: 'log', config: {} },
        ],
        edges: [
          { source: 'node_1', target: 'node_2' },
          { source: 'node_2', target: 'node_3' },
        ],
      },
    });
    workflowId = (wf as any)._id;

    const input = { orderId: 'ord_123' };
    const execId = new Types.ObjectId();
    const exec = await WorkflowExecutionModel.create({
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
      status: 'RUNNING',
      attemptsMade: 1,
      maxRetries: 3,
      retryCount: 0,
      statusHistory: [{ status: 'RUNNING', timestamp: new Date() }],
    });
    executionId = (exec as any)._id;
  });

  describe('Predictive Operations Service', () => {
    it('should create and retrieve predictive anomaly alerts with proper confidence score and risk actions', async () => {
      const predictedFailureTime = new Date(Date.now() + 3600000); // 1 hour ahead
      const anomaly = await predictiveService.createAnomaly({
        workspaceId,
        workflowId,
        executionId,
        anomalyType: 'sla_breach_risk',
        severity: 'high',
        confidenceScore: 92,
        metrics: {
          currentDurationMs: 45000,
          slaTargetMs: 60000,
          predictedTotalDurationMs: 75000,
          p99HistoricalMs: 50000,
        },
        predictedFailureTime,
        recommendedActions: [
          'Preemptively scale execution worker pool',
          'Switch downstream endpoint to low-latency fallback',
        ],
      });

      expect(anomaly).toBeDefined();
      expect(anomaly.anomalyType).toBe('sla_breach_risk');
      expect(anomaly.severity).toBe('high');
      expect(anomaly.confidenceScore).toBe(92);
      expect(anomaly.isAcknowledged).toBe(false);
      expect(anomaly.recommendedActions.length).toBe(2);

      const retrieved = await predictiveService.getAnomalies(workspaceId, {
        anomalyType: 'sla_breach_risk',
        severity: 'high',
      });

      expect(retrieved.length).toBe(1);
      expect(retrieved[0]?._id.toString()).toBe(anomaly._id.toString());
      expect(retrieved[0]?.confidenceScore).toBe(92);
    });

    it('should filter anomalies by workflowId, severity, and acknowledgement status', async () => {
      const now = new Date();
      await predictiveService.createAnomaly({
        workspaceId,
        workflowId,
        executionId,
        anomalyType: 'queue_depth',
        severity: 'medium',
        confidenceScore: 80,
        metrics: { queueSize: 1500, processingRate: 20 },
        predictedFailureTime: new Date(now.getTime() + 1800000),
        recommendedActions: ['Scale queue consumers'],
      });

      await predictiveService.createAnomaly({
        workspaceId,
        workflowId,
        executionId,
        anomalyType: 'memory_pressure',
        severity: 'critical',
        confidenceScore: 95,
        metrics: { memoryUsageMB: 1800, thresholdMB: 2048 },
        predictedFailureTime: new Date(now.getTime() + 600000),
        recommendedActions: ['Trigger garbage collection', 'Reduce batch chunk size'],
      });

      const all = await predictiveService.getAnomalies(workspaceId);
      expect(all.length).toBe(2);

      const criticalOnly = await predictiveService.getAnomalies(workspaceId, { severity: 'critical' });
      expect(criticalOnly.length).toBe(1);
      expect(criticalOnly[0]?.anomalyType).toBe('memory_pressure');

      const queueOnly = await predictiveService.getAnomalies(workspaceId, { anomalyType: 'queue_depth' });
      expect(queueOnly.length).toBe(1);
      expect(queueOnly[0]?.anomalyType).toBe('queue_depth');
    });

    it('should acknowledge and delete anomalies', async () => {
      const anomaly = await predictiveService.createAnomaly({
        workspaceId,
        workflowId,
        executionId,
        anomalyType: 'error_rate',
        severity: 'high',
        confidenceScore: 88,
        metrics: { errorRateSurge: '35%' },
        predictedFailureTime: new Date(Date.now() + 1200000),
        recommendedActions: ['Enable circuit breaker'],
      });

      expect(anomaly.isAcknowledged).toBe(false);

      const acknowledged = await predictiveService.acknowledgeAnomaly(
        anomaly._id.toString(),
        userId.toString()
      );

      expect(acknowledged).toBeDefined();
      expect(acknowledged?.isAcknowledged).toBe(true);
      expect(acknowledged?.acknowledgedBy?.toString()).toBe(userId.toString());
      expect(acknowledged?.acknowledgedAt).toBeDefined();

      const deleted = await predictiveService.deleteAnomaly(anomaly._id.toString());
      expect(deleted).toBe(true);

      const afterDelete = await predictiveService.getAnomalies(workspaceId);
      expect(afterDelete.length).toBe(0);
    });
  });

  describe('Autonomous Workflow Optimizer Service', () => {
    it('should analyze workflow definitions and return structured optimization recommendations', async () => {
      const result = await optimizerService.analyzeWorkflow(workflowId.toString());

      expect(result).toBeDefined();
      expect(result.workflowId.toString()).toBe(workflowId.toString());
      expect(result.optimizations).toBeInstanceOf(Array);
      expect(result.optimizations.length).toBeGreaterThan(0);

      const deadPathOpt = result.optimizations.find(o => o.type === 'dead_path_elimination');
      expect(deadPathOpt).toBeDefined();
      expect(deadPathOpt?.confidence).toBeGreaterThanOrEqual(70);
      expect(deadPathOpt?.suggestedChanges).toBeDefined();

      const parallelOpt = result.optimizations.find(o => o.type === 'parallel_step_conversion');
      expect(parallelOpt).toBeDefined();
      expect(parallelOpt?.impact).toBe('high');
    });

    it('should apply optimizations to a workflow', async () => {
      const analysis = await optimizerService.analyzeWorkflow(workflowId.toString());
      const updatedWfId = await optimizerService.applyOptimizations(
        workflowId.toString(),
        analysis.optimizations
      );

      expect(updatedWfId).toBeDefined();
      expect(updatedWfId.toString()).toBe(workflowId.toString());
    });
  });
});
