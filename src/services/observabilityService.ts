import type { SystemObservabilityHealth, SystemMetricsData } from '../types/operations.types.js';
import { WorkflowExecutionModel } from '../models/WorkflowExecutionModel.js';
import { Queue } from 'bullmq';
import mongoose from 'mongoose';

/**
 * Service for calculating real-time system metrics and health status
 */
export class ObservabilityService {
  /**
   * Get overall system health status
   */
  public static async getSystemHealth(): Promise<SystemObservabilityHealth> {
    const [dbHealth, redisHealth, queueHealth, workerHealth, wsHealth] = await Promise.all([
      this.checkDatabaseHealth(),
      this.checkRedisHealth(),
      this.checkQueueHealth(),
      this.checkWorkerHealth(),
      this.checkWebSocketHealth(),
    ]);

    // Determine overall status - if any service is UNHEALTHY, overall is UNHEALTHY
    const services = [dbHealth, redisHealth, queueHealth, workerHealth, wsHealth];
    const anyUnhealthy = services.some(s => s.status === 'UNHEALTHY');
    const anyDegraded = services.some(s => s.status === 'DEGRADED');

    let status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' = 'HEALTHY';
    if (anyUnhealthy) status = 'UNHEALTHY';
    else if (anyDegraded) status = 'DEGRADED';

    return {
      status,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      services: {
        api: { status: 'HEALTHY', latencyMs: 0 }, // API health is assumed healthy if we're responding
        database: dbHealth,
        redis: redisHealth,
        queue: queueHealth,
        workers: workerHealth,
        websocket: wsHealth,
      },
    };
  }

  /**
   * Get detailed system metrics for dashboard
   */
  public static async getSystemMetrics(): Promise<SystemMetricsData> {
    const [execStats, queueStats, cpuMem] = await Promise.all([
      this.getExecutionStats(),
      this.getQueueStats(),
      this.getSystemResources(),
    ]);

    // Calculate error rate from recent executions
    const totalExecutions = execStats.total;
    const failedExecutions = execStats.failed;
    const errorRate = totalExecutions > 0 ? (failedExecutions / totalExecutions) * 100 : 0;
    const memoryUsagePercent = cpuMem.memoryTotal > 0
      ? Math.round((cpuMem.memoryUsed / cpuMem.memoryTotal) * 1000) / 10
      : 0;

    return {
      timestamp: new Date().toISOString(),
      cpuUsagePercent: cpuMem.cpuUsage,
      memoryUsagePercent,
      memoryUsedMb: Math.round(cpuMem.memoryUsed / 1024 / 1024),
      totalMemoryMb: Math.round(cpuMem.memoryTotal / 1024 / 1024),
      apiThroughputRpm: execStats.throughputRpm,
      apiErrorRatePercent: Math.round(errorRate * 100) / 100,
      p95ApiLatencyMs: execStats.p95LatencyMs,
      queueDepth: queueStats.waiting,
      queueThroughputRpm: queueStats.throughputRpm,
      workerUtilizationPercent: queueStats.utilizationPercent,
    };
  }

  // Private helper methods

  private static async checkDatabaseHealth(): Promise<{ status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY'; latencyMs: number; connections: number }> {
    const start = Date.now();
    try {
      if (!mongoose.connection.db) {
        return { status: 'UNHEALTHY', latencyMs: 0, connections: 0 };
      }
      // Ping database
      await mongoose.connection.db.admin().ping();
      const latency = Date.now() - start;

      // Get connection stats
      const stats = await mongoose.connection.db.command({ serverStatus: 1 });
      const connections = stats.connections?.current ?? 0;

      let status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' = 'HEALTHY';
      if (latency > 100) status = 'DEGRADED';
      if (latency > 1000) status = 'UNHEALTHY';

      return { status, latencyMs: Math.round(latency), connections };
    } catch (error) {
      return { status: 'UNHEALTHY', latencyMs: 0, connections: 0 };
    }
  }

  private static async checkRedisHealth(): Promise<{ status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY'; latencyMs: number; memoryUsedBytes: number }> {
    // TODO: Implement actual Redis health check
    // For now return mock data
    return {
      status: 'HEALTHY',
      latencyMs: 1,
      memoryUsedBytes: 1024 * 1024 * 50, // 50 MB
    };
  }

  private static async checkQueueHealth(): Promise<{ status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY'; waitingJobs: number; activeJobs: number; failedJobs: number }> {
    // TODO: Implement actual BullMQ queue health check
    // For now return mock data
    return {
      status: 'HEALTHY',
      waitingJobs: 5,
      activeJobs: 12,
      failedJobs: 0,
    };
  }

  private static async checkWorkerHealth(): Promise<{ status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY'; activeWorkers: number; concurrency: number }> {
    // TODO: Implement actual worker health check
    // For now return mock data
    return {
      status: 'HEALTHY',
      activeWorkers: 4,
      concurrency: 10,
    };
  }

  private static async checkWebSocketHealth(): Promise<{ status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY'; activeConnections: number }> {
    // TODO: Implement actual WebSocket health check
    // For now return mock data
    return {
      status: 'HEALTHY',
      activeConnections: 23,
    };
  }

  private static async getExecutionStats(): Promise<{ total: number; failed: number; throughputRpm: number; p95LatencyMs: number }> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const [executions, latencies] = await Promise.all([
      WorkflowExecutionModel.countDocuments({
        createdAt: { $gte: oneHourAgo },
      }),
      WorkflowExecutionModel.aggregate([
        {
          $match: {
            createdAt: { $gte: oneHourAgo },
            startedAt: { $exists: true },
            finishedAt: { $exists: true },
          },
        },
        {
          $project: {
            duration: { $subtract: ['$finishedAt', '$startedAt'] },
          },
        },
        { $match: { duration: { $gte: 0 } } },
        { $sort: { duration: 1 } },
      ]),
    ]);

    // Count failed executions in last hour
    const failed = await WorkflowExecutionModel.countDocuments({
      createdAt: { $gte: oneHourAgo },
      status: 'FAILED',
    });

    // Calculate throughput (executions per minute)
    const throughputRpm = Math.round(executions / 60);

    // Calculate p95 latency
    const p95LatencyMs = latencies.length > 0
      ? latencies[Math.floor(latencies.length * 0.95)].duration
      : 0;

    return {
      total: executions,
      failed,
      throughputRpm,
      p95LatencyMs: Math.round(p95LatencyMs),
    };
  }

  private static async getQueueStats(): Promise<{ waiting: number; active: number; completed: number; failed: number; delayed: number; throughputRpm: number; utilizationPercent: number }> {
    // TODO: Implement actual BullMQ stats
    // For now return mock data
    return {
      waiting: 8,
      active: 15,
      completed: 142,
      failed: 2,
      delayed: 0,
      throughputRpm: 25,
      utilizationPercent: 75,
    };
  }

  private static async getSystemResources(): Promise<{ cpuUsage: number; memoryUsed: number; memoryTotal: number }> {
    // TODO: Implement actual system resource monitoring
    // For now return mock data
    return {
      cpuUsage: 45.2,
      memoryUsed: 1024 * 1024 * 512, // 512 MB
      memoryTotal: 1024 * 1024 * 2048, // 2 GB
    };
  }
}

export default ObservabilityService;