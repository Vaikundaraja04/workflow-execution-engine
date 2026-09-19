import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { AIOperationsAssistantService } from '../src/services/aiOperationsAssistantService.js';
import { WorkflowExecutionModel } from '../src/models/WorkflowExecutionModel.js';
import { WorkflowModel } from '../src/models/WorkflowModel.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';
import type {
  AIOperationsFailureExplanation,
  AIOperationsSystemSummary,
  AIOperationsOptimizationSuggestion,
} from '../src/types/operations.types.js';

let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
}, 30000);

describe('AIOperationsAssistantService', () => {
  const workspaceId = new Types.ObjectId().toString();
  const userId = new Types.ObjectId().toString();
  const workflowId = new Types.ObjectId().toString();

  beforeEach(async () => {
    await WorkflowExecutionModel.deleteMany({ workspaceId });
    await WorkflowModel.deleteMany({ workspaceId });
    await AuditLogModel.deleteMany({ workspaceId });
  });

  describe('explainWorkflowFailure', () => {
    it('should return failure explanation for a failed execution', async () => {
      // Create a workflow
      const workflow = await WorkflowModel.create({
        _id: new Types.ObjectId(workflowId),
        workspaceId: new Types.ObjectId(workspaceId),
        ownerId: new Types.ObjectId(userId),
        name: 'Test Workflow',
        draftDefinition: { nodes: [], edges: [] },
      });

      // Create a failed execution
      const execution = await WorkflowExecutionModel.create({
        _id: new Types.ObjectId(),
        workspaceId: new Types.ObjectId(workspaceId),
        workflowId: workflow._id,
        ownerId: new Types.ObjectId(userId),
        workflowVersionId: new Types.ObjectId(),
        versionNumber: 1,
        jobId: 'job-failed-1',
        idempotencyKey: 'idem-1',
        inputHash: 'hash-1',
        input: {},
        status: 'FAILED',
        error: { message: 'Step failed: Invalid input' },
        startedAt: new Date(Date.now() - 10000),
        finishedAt: new Date(Date.now() - 5000),
        stepStatuses: { step1: 'COMPLETED', step2: 'FAILED' },
        retryCount: 1,
        attemptsMade: 1,
      });

      const explanation: AIOperationsFailureExplanation = await AIOperationsAssistantService.explainWorkflowFailure(
        execution._id.toString(),
        workspaceId,
        userId
      );

      expect(explanation).toBeDefined();
      expect(explanation.executionId).toBe(execution._id.toString());
      expect(explanation.workflowName).toBe('Test Workflow');
      expect(typeof explanation.failureSummary).toBe('string');
      expect(typeof explanation.rootCause).toBe('string');
      expect(Array.isArray(explanation.suggestedFixes)).toBe(true);
      expect(explanation.suggestedFixes.length).toBeGreaterThan(0);
      expect(typeof explanation.confidenceScore).toBe('number');
      expect(explanation.confidenceScore).toBeGreaterThanOrEqual(0);
      expect(explanation.confidenceScore).toBeLessThanOrEqual(100);

      // Check failingNode structure if present
      if (explanation.failingNode) {
        expect(explanation.failingNode).toHaveProperty('nodeId');
        expect(explanation.failingNode).toHaveProperty('nodeType');
        expect(explanation.failingNode).toHaveProperty('error');
      }
    });

    it('should throw error for non-existent execution', async () => {
      await expect(
        AIOperationsAssistantService.explainWorkflowFailure(
          new Types.ObjectId().toString(),
          workspaceId
        )
      ).rejects.toThrow('EXECUTION_NOT_FOUND');
    });

    it('should audit AI operations request when userId provided', async () => {
      // Create a workflow
      const workflow = await WorkflowModel.create({
        _id: new Types.ObjectId(workflowId),
        workspaceId: new Types.ObjectId(workspaceId),
        ownerId: new Types.ObjectId(userId),
        name: 'Test Workflow',
        draftDefinition: { nodes: [], edges: [] },
      });

      // Create a failed execution
      const execution = await WorkflowExecutionModel.create({
        _id: new Types.ObjectId(),
        workspaceId: new Types.ObjectId(workspaceId),
        workflowId: workflow._id,
        ownerId: new Types.ObjectId(userId),
        workflowVersionId: new Types.ObjectId(),
        versionNumber: 1,
        jobId: 'job-failed-2',
        idempotencyKey: 'idem-2',
        inputHash: 'hash-2',
        input: {},
        status: 'FAILED',
        error: { message: 'Step failed' },
        startedAt: new Date(Date.now() - 10000),
        finishedAt: new Date(Date.now() - 5000),
        attemptsMade: 1,
      });

      await AIOperationsAssistantService.explainWorkflowFailure(
        execution._id.toString(),
        workspaceId,
        userId
      );

      const auditLogs = await AuditLogModel.find({
        workspaceId: new Types.ObjectId(workspaceId),
        action: 'AI_OPERATIONS_ASSISTANT_REQUESTED',
        resource: 'WorkflowExecution',
      }).exec();

      expect(auditLogs.length).toBe(1);
      const firstLog = auditLogs[0];
      expect(firstLog).toBeDefined();
      if (firstLog) {
        expect(firstLog.userId?.toString()).toBe(userId);
        expect(firstLog.resourceId).toBe(execution._id.toString());
        expect((firstLog.metadata as any)?.query).toBe('explain_failure');
      }
    });
  });

  describe('summarizeSystemHealth', () => {
    it('should return system health summary', async () => {
      const summary: AIOperationsSystemSummary = await AIOperationsAssistantService.summarizeSystemHealth(
        workspaceId,
        userId
      );

      expect(summary).toBeDefined();
      expect(summary.workspaceId).toBe(workspaceId);
      expect(typeof summary.summary).toBe('string');
      expect(['A', 'B', 'C', 'D', 'F']).toContain(summary.healthGrade);
      expect(Array.isArray(summary.keyObservations)).toBe(true);
      expect(Array.isArray(summary.immediateActions)).toBe(true);
      expect(typeof summary.scalingAdvice).toBe('string');
    });

    it('should audit AI operations request when userId provided', async () => {
      await AIOperationsAssistantService.summarizeSystemHealth(workspaceId, userId);

      const auditLogs = await AuditLogModel.find({
        workspaceId: new Types.ObjectId(workspaceId),
        action: 'AI_OPERATIONS_ASSISTANT_REQUESTED',
        resource: 'SystemHealth',
      }).exec();

      expect(auditLogs.length).toBe(1);
      const firstLog = auditLogs[0];
      expect(firstLog).toBeDefined();
      if (firstLog) {
        expect(firstLog.userId?.toString()).toBe(userId);
        expect(firstLog.resourceId).toBe(workspaceId);
        expect((firstLog.metadata as any)?.query).toBe('system_summary');
      }
    });
  });

  describe('suggestOptimizations', () => {
    it('should return optimization suggestions', async () => {
      // Create a workflow
      await WorkflowModel.create({
        _id: new Types.ObjectId(workflowId),
        workspaceId: new Types.ObjectId(workspaceId),
        ownerId: new Types.ObjectId(userId),
        name: 'Test Workflow',
        draftDefinition: { nodes: [], edges: [] },
      });

      const suggestions: AIOperationsOptimizationSuggestion[] = await AIOperationsAssistantService.suggestOptimizations(
        workspaceId
      );

      expect(Array.isArray(suggestions)).toBe(true);

      if (suggestions.length > 0) {
        const suggestion = suggestions[0];
        expect(suggestion).toBeDefined();
        if (suggestion) {
          expect(suggestion).toHaveProperty('workflowId');
          expect(suggestion).toHaveProperty('workflowName');
          expect(typeof suggestion.estimatedLatencyReductionPercent).toBe('number');
          expect(typeof suggestion.estimatedCostReductionPercent).toBe('number');
          expect(Array.isArray(suggestion.suggestions)).toBe(true);

          if (suggestion.suggestions.length > 0) {
            const opt = suggestion.suggestions[0];
            expect(opt).toBeDefined();
            if (opt) {
              expect(opt).toHaveProperty('type');
              expect(['PARALLELIZATION', 'CACHING', 'RETRY_POLICY', 'TIMEOUT_TUNING']).toContain(opt.type);
              expect(opt).toHaveProperty('description');
              expect(opt).toHaveProperty('impact');
              expect(['HIGH', 'MEDIUM', 'LOW']).toContain(opt.impact);
            }
          }
        }
      }
    });

    it('returns empty array when no workflows exist', async () => {
      const suggestions: AIOperationsOptimizationSuggestion[] = await AIOperationsAssistantService.suggestOptimizations(
        workspaceId
      );

      expect(Array.isArray(suggestions)).toBe(true);
      expect(suggestions.length).toBe(0);
    });
  });

  describe('detectSystemAnomalies', () => {
    it('should return system anomalies', async () => {
      const result = await AIOperationsAssistantService.detectSystemAnomalies(workspaceId);

      expect(result).toHaveProperty('anomalies');
      expect(Array.isArray(result.anomalies)).toBe(true);

      if (result.anomalies.length > 0) {
        const anomaly = result.anomalies[0];
        expect(anomaly).toBeDefined();
        if (anomaly) {
          expect(anomaly).toHaveProperty('id');
          expect(anomaly).toHaveProperty('type');
          expect(anomaly).toHaveProperty('severity');
          expect(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).toContain(anomaly.severity);
          expect(anomaly).toHaveProperty('description');
          expect(anomaly).toHaveProperty('detectedAt');
          expect(anomaly).toHaveProperty('recommendation');

          // Validate detectedAt is a valid ISO string
          expect(new Date(anomaly.detectedAt)).toBeInstanceOf(Date);
        }
      }
    });
  });

  describe('recommendScalingActions', () => {
    it('should return scaling recommendations', async () => {
      const result = await AIOperationsAssistantService.recommendScalingActions(workspaceId);

      expect(result).toHaveProperty('currentConcurrency');
      expect(result).toHaveProperty('recommendedWorkers');
      expect(result).toHaveProperty('estimatedThroughputGainPercent');
      expect(result).toHaveProperty('reasoning');
      expect(result).toHaveProperty('recommendations');

      expect(typeof result.currentConcurrency).toBe('number');
      expect(typeof result.recommendedWorkers).toBe('number');
      expect(typeof result.estimatedThroughputGainPercent).toBe('number');
      expect(typeof result.reasoning).toBe('string');
      expect(Array.isArray(result.recommendations)).toBe(true);

      expect(result.currentConcurrency).toBeGreaterThan(0);
      expect(result.recommendedWorkers).toBeGreaterThan(0);
      expect(result.estimatedThroughputGainPercent).toBeGreaterThanOrEqual(0);
    });
  });
});