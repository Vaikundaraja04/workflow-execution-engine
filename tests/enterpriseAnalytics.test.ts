import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { EnterpriseAnalyticsService } from '../src/services/enterpriseAnalyticsService.js';
import { WorkflowModel } from '../src/models/WorkflowModel.js';
import { WorkflowExecutionModel } from '../src/models/WorkflowExecutionModel.js';
import type {
  OverviewAnalyticsData,
  WorkflowAnalyticsData,
  ExecutionAnalyticsData,
  UserAnalyticsData,
  PerformanceAnalyticsData,
  CostAnalyticsData,
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

describe('EnterpriseAnalyticsService', () => {
  const workspaceId = new Types.ObjectId().toString();

  beforeEach(async () => {
    await WorkflowModel.deleteMany({ workspaceId });
    await WorkflowExecutionModel.deleteMany({ workspaceId });
  });

  describe('getOverviewAnalytics', () => {
    it('should return overview analytics data', async () => {
      const result: OverviewAnalyticsData = await EnterpriseAnalyticsService.getOverviewAnalytics(workspaceId, '30d');

      expect(result).toHaveProperty('workspaceId', workspaceId);
      expect(result).toHaveProperty('timeframe', '30d');
      expect(result).toHaveProperty('totalWorkflows');
      expect(result).toHaveProperty('activeWorkflows');
      expect(result).toHaveProperty('totalExecutions');
      expect(result).toHaveProperty('successfulExecutions');
      expect(result).toHaveProperty('failedExecutions');
      expect(result).toHaveProperty('successRate');
      expect(result).toHaveProperty('averageDurationMs');
      expect(result).toHaveProperty('p95DurationMs');
      expect(result).toHaveProperty('totalCostUsd');
      expect(result).toHaveProperty('activeUsersCount');
      expect(result).toHaveProperty('executionTrend');

      expect(typeof result.totalWorkflows).toBe('number');
      expect(typeof result.activeWorkflows).toBe('number');
      expect(typeof result.totalExecutions).toBe('number');
      expect(typeof result.successRate).toBe('number');
      expect(Array.isArray(result.executionTrend)).toBe(true);
    });
  });

  describe('getWorkflowAnalytics', () => {
    it('should return workflow analytics data', async () => {
      const result: WorkflowAnalyticsData = await EnterpriseAnalyticsService.getWorkflowAnalytics(workspaceId, '30d');

      expect(result).toHaveProperty('workspaceId', workspaceId);
      expect(result).toHaveProperty('timeframe', '30d');
      expect(result).toHaveProperty('workflows');
      expect(result).toHaveProperty('mostFailingNodes');

      expect(Array.isArray(result.workflows)).toBe(true);
      expect(Array.isArray(result.mostFailingNodes)).toBe(true);
    });
  });

  describe('getExecutionAnalytics', () => {
    it('should return execution analytics data', async () => {
      const result: ExecutionAnalyticsData = await EnterpriseAnalyticsService.getExecutionAnalytics(workspaceId, '30d');

      expect(result).toHaveProperty('workspaceId', workspaceId);
      expect(result).toHaveProperty('timeframe', '30d');
      expect(result).toHaveProperty('totalExecutions');
      expect(result).toHaveProperty('successRate');
      expect(result).toHaveProperty('hourlyThroughput');
      expect(result).toHaveProperty('statusBreakdown');
      expect(result).toHaveProperty('latencyPercentiles');
      expect(result).toHaveProperty('retryStats');

      expect(typeof result.totalExecutions).toBe('number');
      expect(typeof result.successRate).toBe('number');
      expect(Array.isArray(result.hourlyThroughput)).toBe(true);

      expect(result.statusBreakdown).toHaveProperty('succeeded');
      expect(result.statusBreakdown).toHaveProperty('failed');
      expect(result.statusBreakdown).toHaveProperty('running');
      expect(result.statusBreakdown).toHaveProperty('queued');
      expect(result.statusBreakdown).toHaveProperty('cancelled');

      expect(result.latencyPercentiles).toHaveProperty('p50');
      expect(result.latencyPercentiles).toHaveProperty('p90');
      expect(result.latencyPercentiles).toHaveProperty('p95');
      expect(result.latencyPercentiles).toHaveProperty('p99');
      expect(result.latencyPercentiles).toHaveProperty('avg');

      expect(result.retryStats).toHaveProperty('totalRetries');
      expect(result.retryStats).toHaveProperty('successfulAfterRetry');
      expect(result.retryStats).toHaveProperty('failedAfterRetry');
    });
  });

  describe('getUserAnalytics', () => {
    it('should return user analytics data', async () => {
      const result: UserAnalyticsData = await EnterpriseAnalyticsService.getUserAnalytics(workspaceId, '30d');

      expect(result).toHaveProperty('workspaceId', workspaceId);
      expect(result).toHaveProperty('timeframe', '30d');
      expect(result).toHaveProperty('users');
      expect(result).toHaveProperty('totalMembers');

      expect(Array.isArray(result.users)).toBe(true);
      expect(typeof result.totalMembers).toBe('number');
    });
  });

  describe('getPerformanceAnalytics', () => {
    it('should return performance analytics data', async () => {
      const result: PerformanceAnalyticsData = await EnterpriseAnalyticsService.getPerformanceAnalytics(workspaceId, '30d');

      expect(result).toHaveProperty('workspaceId', workspaceId);
      expect(result).toHaveProperty('timeframe', '30d');
      expect(result).toHaveProperty('avgResponseTimeMs');
      expect(result).toHaveProperty('p50DurationMs');
      expect(result).toHaveProperty('p95DurationMs');
      expect(result).toHaveProperty('p99DurationMs');
      expect(result).toHaveProperty('slowestWorkflows');
      expect(result).toHaveProperty('nodeExecutionTimes');

      expect(typeof result.avgResponseTimeMs).toBe('number');
      expect(typeof result.p50DurationMs).toBe('number');
      expect(typeof result.p95DurationMs).toBe('number');
      expect(typeof result.p99DurationMs).toBe('number');
      expect(Array.isArray(result.slowestWorkflows)).toBe(true);
      expect(Array.isArray(result.nodeExecutionTimes)).toBe(true);
    });
  });

  describe('getCostAnalytics', () => {
    it('should return cost analytics data', async () => {
      const result: CostAnalyticsData = await EnterpriseAnalyticsService.getCostAnalytics(workspaceId, '30d');

      expect(result).toHaveProperty('workspaceId', workspaceId);
      expect(result).toHaveProperty('timeframe', '30d');
      expect(result).toHaveProperty('totalCostUsd');
      expect(result).toHaveProperty('computeCostUsd');
      expect(result).toHaveProperty('aiTokenCostUsd');
      expect(result).toHaveProperty('storageCostUsd');
      expect(result).toHaveProperty('perWorkflowCost');

      expect(typeof result.totalCostUsd).toBe('number');
      expect(typeof result.computeCostUsd).toBe('number');
      expect(typeof result.aiTokenCostUsd).toBe('number');
      expect(typeof result.storageCostUsd).toBe('number');
      expect(Array.isArray(result.perWorkflowCost)).toBe(true);
    });
  });
});
