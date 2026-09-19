import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { ObservabilityService } from '../src/services/observabilityService.js';
import { WorkflowExecutionModel } from '../src/models/WorkflowExecutionModel.js';
import type { SystemObservabilityHealth, SystemMetricsData } from '../src/types/operations.types.js';

let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
}, 30000);

describe('ObservabilityService', () => {
  const workspaceId = new Types.ObjectId().toString();

  beforeEach(async () => {
    await WorkflowExecutionModel.deleteMany({ workspaceId });
  });

  describe('getSystemHealth', () => {
    it('should return system health status', async () => {
      const health: SystemObservabilityHealth = await ObservabilityService.getSystemHealth();

      expect(health).toHaveProperty('status');
      expect(health).toHaveProperty('uptimeSeconds');
      expect(health).toHaveProperty('timestamp');
      expect(health).toHaveProperty('services');

      expect(['HEALTHY', 'DEGRADED', 'UNHEALTHY']).toContain(health.status);

      expect(health.services).toHaveProperty('api');
      expect(health.services).toHaveProperty('database');
      expect(health.services).toHaveProperty('redis');
      expect(health.services).toHaveProperty('queue');
      expect(health.services).toHaveProperty('workers');
      expect(health.services).toHaveProperty('websocket');

      expect(health.services.api).toHaveProperty('status');
      expect(health.services.api).toHaveProperty('latencyMs');

      expect(health.services.database).toHaveProperty('status');
      expect(health.services.database).toHaveProperty('latencyMs');
      expect(health.services.database).toHaveProperty('connections');

      expect(typeof health.uptimeSeconds).toBe('number');
      expect(health.uptimeSeconds).toBeGreaterThanOrEqual(0);

      expect(new Date(health.timestamp)).toBeInstanceOf(Date);
      expect(!isNaN(new Date(health.timestamp).getTime())).toBe(true);
    });
  });

  describe('getSystemMetrics', () => {
    it('should return system metrics data', async () => {
      const metrics: SystemMetricsData = await ObservabilityService.getSystemMetrics();

      expect(metrics).toHaveProperty('timestamp');
      expect(metrics).toHaveProperty('cpuUsagePercent');
      expect(metrics).toHaveProperty('memoryUsagePercent');
      expect(metrics).toHaveProperty('memoryUsedMb');
      expect(metrics).toHaveProperty('totalMemoryMb');
      expect(metrics).toHaveProperty('apiThroughputRpm');
      expect(metrics).toHaveProperty('apiErrorRatePercent');
      expect(metrics).toHaveProperty('p95ApiLatencyMs');
      expect(metrics).toHaveProperty('queueDepth');
      expect(metrics).toHaveProperty('queueThroughputRpm');
      expect(metrics).toHaveProperty('workerUtilizationPercent');

      expect(typeof metrics.timestamp).toBe('string');
      expect(new Date(metrics.timestamp)).toBeInstanceOf(Date);

      expect(typeof metrics.cpuUsagePercent).toBe('number');
      expect(metrics.cpuUsagePercent).toBeGreaterThanOrEqual(0);
      expect(metrics.cpuUsagePercent).toBeLessThanOrEqual(100);

      expect(typeof metrics.memoryUsagePercent).toBe('number');
      expect(metrics.memoryUsagePercent).toBeGreaterThanOrEqual(0);
      expect(metrics.memoryUsagePercent).toBeLessThanOrEqual(100);

      expect(typeof metrics.memoryUsedMb).toBe('number');
      expect(metrics.memoryUsedMb).toBeGreaterThanOrEqual(0);

      expect(typeof metrics.totalMemoryMb).toBe('number');
      expect(metrics.totalMemoryMb).toBeGreaterThan(0);

      expect(typeof metrics.apiThroughputRpm).toBe('number');
      expect(metrics.apiThroughputRpm).toBeGreaterThanOrEqual(0);

      expect(typeof metrics.apiErrorRatePercent).toBe('number');
      expect(metrics.apiErrorRatePercent).toBeGreaterThanOrEqual(0);

      expect(typeof metrics.p95ApiLatencyMs).toBe('number');
      expect(metrics.p95ApiLatencyMs).toBeGreaterThanOrEqual(0);

      expect(typeof metrics.queueDepth).toBe('number');
      expect(metrics.queueDepth).toBeGreaterThanOrEqual(0);

      expect(typeof metrics.queueThroughputRpm).toBe('number');
      expect(metrics.queueThroughputRpm).toBeGreaterThanOrEqual(0);

      expect(typeof metrics.workerUtilizationPercent).toBe('number');
      expect(metrics.workerUtilizationPercent).toBeGreaterThanOrEqual(0);
      expect(metrics.workerUtilizationPercent).toBeLessThanOrEqual(100);
    });
  });

  describe('getExecutionStats', () => {
    it('should return execution statistics', async () => {
      const stats = await (ObservabilityService as any).getExecutionStats();

      expect(stats).toHaveProperty('total');
      expect(stats).toHaveProperty('failed');
      expect(stats).toHaveProperty('throughputRpm');
      expect(stats).toHaveProperty('p95LatencyMs');

      expect(typeof stats.total).toBe('number');
      expect(typeof stats.failed).toBe('number');
      expect(typeof stats.throughputRpm).toBe('number');
      expect(typeof stats.p95LatencyMs).toBe('number');

      expect(stats.total).toBeGreaterThanOrEqual(0);
      expect(stats.failed).toBeGreaterThanOrEqual(0);
      expect(stats.failed).toBeLessThanOrEqual(stats.total);
      expect(stats.throughputRpm).toBeGreaterThanOrEqual(0);
      expect(stats.p95LatencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getQueueStats', () => {
    it('should return queue statistics', async () => {
      const stats = await (ObservabilityService as any).getQueueStats();

      expect(stats).toHaveProperty('waiting');
      expect(stats).toHaveProperty('active');
      expect(stats).toHaveProperty('completed');
      expect(stats).toHaveProperty('failed');
      expect(stats).toHaveProperty('delayed');
      expect(stats).toHaveProperty('throughputRpm');
      expect(stats).toHaveProperty('utilizationPercent');

      expect(typeof stats.waiting).toBe('number');
      expect(typeof stats.active).toBe('number');
      expect(typeof stats.completed).toBe('number');
      expect(typeof stats.failed).toBe('number');
      expect(typeof stats.delayed).toBe('number');
      expect(typeof stats.throughputRpm).toBe('number');
      expect(typeof stats.utilizationPercent).toBe('number');

      expect(stats.waiting).toBeGreaterThanOrEqual(0);
      expect(stats.active).toBeGreaterThanOrEqual(0);
      expect(stats.completed).toBeGreaterThanOrEqual(0);
      expect(stats.failed).toBeGreaterThanOrEqual(0);
      expect(stats.delayed).toBeGreaterThanOrEqual(0);
      expect(stats.throughputRpm).toBeGreaterThanOrEqual(0);
      expect(stats.utilizationPercent).toBeGreaterThanOrEqual(0);
      expect(stats.utilizationPercent).toBeLessThanOrEqual(100);
    });
  });

  describe('getSystemResources', () => {
    it('should return system resource information', async () => {
      const resources = await (ObservabilityService as any).getSystemResources();

      expect(resources).toHaveProperty('cpuUsage');
      expect(resources).toHaveProperty('memoryUsed');
      expect(resources).toHaveProperty('memoryTotal');

      expect(typeof resources.cpuUsage).toBe('number');
      expect(typeof resources.memoryUsed).toBe('number');
      expect(typeof resources.memoryTotal).toBe('number');

      expect(resources.cpuUsage).toBeGreaterThanOrEqual(0);
      expect(resources.cpuUsage).toBeLessThanOrEqual(100);
      expect(resources.memoryUsed).toBeGreaterThanOrEqual(0);
      expect(resources.memoryTotal).toBeGreaterThan(0);
      expect(resources.memoryUsed).toBeLessThanOrEqual(resources.memoryTotal);
    });
  });

  describe('checkDatabaseHealth', () => {
    it('should return database health status', async () => {
      const health = await (ObservabilityService as any).checkDatabaseHealth();

      expect(health).toHaveProperty('status');
      expect(health).toHaveProperty('latencyMs');
      expect(health).toHaveProperty('connections');

      expect(['HEALTHY', 'DEGRADED', 'UNHEALTHY']).toContain(health.status);
      expect(typeof health.latencyMs).toBe('number');
      expect(typeof health.connections).toBe('number');

      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
      expect(health.connections).toBeGreaterThanOrEqual(0);
    });
  });

  describe('checkRedisHealth', () => {
    it('should return redis health status', async () => {
      const health = await (ObservabilityService as any).checkRedisHealth();

      expect(health).toHaveProperty('status');
      expect(health).toHaveProperty('latencyMs');
      expect(health).toHaveProperty('memoryUsedBytes');

      expect(['HEALTHY', 'DEGRADED', 'UNHEALTHY']).toContain(health.status);
      expect(typeof health.latencyMs).toBe('number');
      expect(typeof health.memoryUsedBytes).toBe('number');

      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
      expect(health.memoryUsedBytes).toBeGreaterThanOrEqual(0);
    });
  });

  describe('checkQueueHealth', () => {
    it('should return queue health status', async () => {
      const health = await (ObservabilityService as any).checkQueueHealth();

      expect(health).toHaveProperty('status');
      expect(health).toHaveProperty('waitingJobs');
      expect(health).toHaveProperty('activeJobs');
      expect(health).toHaveProperty('failedJobs');

      expect(['HEALTHY', 'DEGRADED', 'UNHEALTHY']).toContain(health.status);
      expect(typeof health.waitingJobs).toBe('number');
      expect(typeof health.activeJobs).toBe('number');
      expect(typeof health.failedJobs).toBe('number');

      expect(health.waitingJobs).toBeGreaterThanOrEqual(0);
      expect(health.activeJobs).toBeGreaterThanOrEqual(0);
      expect(health.failedJobs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('checkWorkerHealth', () => {
    it('should return worker health status', async () => {
      const health = await (ObservabilityService as any).checkWorkerHealth();

      expect(health).toHaveProperty('status');
      expect(health).toHaveProperty('activeWorkers');
      expect(health).toHaveProperty('concurrency');

      expect(['HEALTHY', 'DEGRADED', 'UNHEALTHY']).toContain(health.status);
      expect(typeof health.activeWorkers).toBe('number');
      expect(typeof health.concurrency).toBe('number');

      expect(health.activeWorkers).toBeGreaterThanOrEqual(0);
      expect(health.concurrency).toBeGreaterThan(0);
      expect(health.activeWorkers).toBeLessThanOrEqual(health.concurrency);
    });
  });

  describe('checkWebSocketHealth', () => {
    it('should return websocket health status', async () => {
      const health = await (ObservabilityService as any).checkWebSocketHealth();

      expect(health).toHaveProperty('status');
      expect(health).toHaveProperty('activeConnections');

      expect(['HEALTHY', 'DEGRADED', 'UNHEALTHY']).toContain(health.status);
      expect(typeof health.activeConnections).toBe('number');

      expect(health.activeConnections).toBeGreaterThanOrEqual(0);
    });
  });
});
