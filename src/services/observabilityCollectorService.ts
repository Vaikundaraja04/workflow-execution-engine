import os from 'node:os';
import { Redis } from 'ioredis';
import { WorkflowExecutionModel } from '../models/WorkflowExecutionModel.js';
import { OperationalMetricModel, METRIC_RESOLUTIONS } from '../models/OperationalMetricModel.js';
import type { MetricResolution } from '../models/OperationalMetricModel.js';
import { checkRedis, WORKER_HEARTBEAT_KEY } from '../observability/health.js';
import { apiLatencyRecorder } from '../observability/apiLatencyRecorder.js';
import { getIO } from '../realtime/socketServer.js';
import { logger } from '../observability/logger.js';
import type { ExecutionQueue } from '../queues/executionQueue.js';

export interface QueueSnapshot {
  available: boolean;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
  depth: number;
}

export interface OperationalSnapshot {
  timestamp: string;
  cpuPercent: number | null;
  memory: { rssMb: number; usedMb: number; totalMb: number; systemUsedPercent: number | null };
  redis: { status: 'up' | 'down' | 'skipped'; latencyMs: number };
  queue: QueueSnapshot;
  worker: {
    available: boolean;
    heartbeatAgeMs: number | null;
    capacity: number;
    utilizationPercent: number | null;
  };
  websocket: { available: boolean; connections: number | null };
  api: { requests: number; p95Ms: number; errorRatePercent: number };
  executions: {
    lastHour: number;
    failedLastHour: number;
    throughputPerHour: number;
    errorRatePercent: number;
  };
}

export interface MetricsHistoryPoint {
  timestamp: string;
  cpuPercent: number | null;
  memoryUsedPercent: number | null;
  queueDepth: number;
  workerUtilizationPercent: number | null;
  executionsLastHour: number;
  executionErrorRatePercent: number;
  apiP95Ms: number;
  websocketConnections: number | null;
}

export interface ObservabilityCollectorConfig {
  redisUrl?: string;
  executionQueue?: ExecutionQueue;
  workerCapacity?: number;
  workerHeartbeatProvider?: () => Promise<{ available: boolean; ageMs: number | null }>;
  websocketConnectionsProvider?: () => number | null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export const DEFAULT_METRICS_WINDOW_HOURS = 24;
export const MAX_METRICS_WINDOW_HOURS = 720;
export const MIN_METRICS_WINDOW_HOURS = 1;
const RESOLUTION_MS: Record<MetricResolution, number> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '1h': 60 * 60_000,
};
const RAW_POINT_LIMIT = 2_000;

function defaultWorkerCapacity(): number {
  const concurrency = Number(process.env.WORKER_CONCURRENCY);
  const instances = Number(process.env.WORKER_INSTANCES);
  const effectiveConcurrency = Number.isFinite(concurrency) && concurrency > 0 ? concurrency : 5;
  const effectiveInstances = Number.isFinite(instances) && instances > 0 ? instances : 1;
  return effectiveConcurrency * effectiveInstances;
}

async function readHeartbeat(redisUrl: string): Promise<{ available: boolean; ageMs: number | null }> {
  const client = new Redis(redisUrl, {
    lazyConnect: true,
    connectTimeout: 1_000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });
  client.on('error', () => undefined);
  try {
    await client.connect();
    const value = await client.get(WORKER_HEARTBEAT_KEY);
    if (!value) return { available: false, ageMs: null };
    const parsed = Date.parse(value);
    return {
      available: true,
      ageMs: Number.isFinite(parsed) ? Math.max(0, Date.now() - parsed) : null,
    };
  } catch {
    return { available: false, ageMs: null };
  } finally {
    client.disconnect();
  }
}

export class ObservabilityCollectorService {
  private static instance: ObservabilityCollectorService;
  public static getInstance(): ObservabilityCollectorService {
    if (!ObservabilityCollectorService.instance) {
      ObservabilityCollectorService.instance = new ObservabilityCollectorService();
    }
    return ObservabilityCollectorService.instance;
  }

  private config: ObservabilityCollectorConfig = {};
  private lastCpuUsage = process.cpuUsage();
  private lastCpuSampleAt = Date.now();

  configure(config: ObservabilityCollectorConfig): void {
    this.config = { ...this.config, ...config };
  }

  reset(): void {
    this.config = {};
    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuSampleAt = Date.now();
  }

  private sampleCpuPercent(): number | null {
    const now = Date.now();
    const usage = process.cpuUsage(this.lastCpuUsage);
    const elapsedMs = now - this.lastCpuSampleAt;
    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuSampleAt = now;
    if (elapsedMs <= 0) return null;
    const cpuMs = (usage.user + usage.system) / 1_000;
    return round1(clampPercent((cpuMs / elapsedMs) * 100));
  }

  private sampleMemory(): OperationalSnapshot['memory'] {
    const rssMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
    const totalMb = Math.round(os.totalmem() / 1024 / 1024);
    const usedMb = Math.round((os.totalmem() - os.freemem()) / 1024 / 1024);
    return {
      rssMb,
      usedMb,
      totalMb,
      systemUsedPercent: totalMb > 0 ? round1(clampPercent((usedMb / totalMb) * 100)) : null,
    };
  }

  private async sampleRedis(): Promise<OperationalSnapshot['redis']> {
    if (!this.config.redisUrl) return { status: 'skipped', latencyMs: 0 };
    const result = await checkRedis(this.config.redisUrl);
    return {
      status: result.status === 'up' ? 'up' : 'down',
      latencyMs: result.latencyMs,
    };
  }

  private async sampleQueue(): Promise<QueueSnapshot> {
    const unavailable: QueueSnapshot = {
      available: false,
      waiting: 0,
      active: 0,
      delayed: 0,
      failed: 0,
      completed: 0,
      depth: 0,
    };
    const queue = this.config.executionQueue;
    if (!queue?.getMetrics) return unavailable;
    try {
      const metrics = await queue.getMetrics();
      return {
        available: true,
        waiting: metrics.counts.waiting,
        active: metrics.counts.active,
        delayed: metrics.counts.delayed,
        failed: metrics.counts.failed,
        completed: metrics.counts.completed,
        depth: metrics.counts.waiting + metrics.counts.delayed,
      };
    } catch (error) {
      logger.warn('observability_queue_sample_failed', {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      return unavailable;
    }
  }

  private async sampleWorker(): Promise<{ available: boolean; ageMs: number | null }> {
    if (this.config.workerHeartbeatProvider) {
      return this.config.workerHeartbeatProvider();
    }
    if (!this.config.redisUrl) return { available: false, ageMs: null };
    return readHeartbeat(this.config.redisUrl);
  }

  private sampleWebsocket(): { available: boolean; connections: number | null } {
    if (this.config.websocketConnectionsProvider) {
      const connections = this.config.websocketConnectionsProvider();
      return { available: connections !== null, connections };
    }
    const io = getIO();
    if (!io) return { available: false, connections: null };
    return { available: true, connections: io.engine.clientsCount };
  }

  private async sampleExecutions(): Promise<OperationalSnapshot['executions']> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const [lastHour, failedLastHour] = await Promise.all([
      WorkflowExecutionModel.countDocuments({ createdAt: { $gte: oneHourAgo } }),
      WorkflowExecutionModel.countDocuments({ createdAt: { $gte: oneHourAgo }, status: 'FAILED' }),
    ]);
    return {
      lastHour,
      failedLastHour,
      throughputPerHour: lastHour,
      errorRatePercent: lastHour > 0 ? round1((failedLastHour / lastHour) * 100) : 0,
    };
  }

  async collectSnapshot(): Promise<OperationalSnapshot> {
    const [redis, queue, worker, executions] = await Promise.all([
      this.sampleRedis(),
      this.sampleQueue(),
      this.sampleWorker(),
      this.sampleExecutions(),
    ]);
    const capacity = this.config.workerCapacity ?? defaultWorkerCapacity();
    const utilizationPercent = capacity > 0 && queue.available
      ? round1(clampPercent((queue.active / capacity) * 100))
      : null;

    return {
      timestamp: new Date().toISOString(),
      cpuPercent: this.sampleCpuPercent(),
      memory: this.sampleMemory(),
      redis,
      queue,
      worker: {
        available: worker.available,
        heartbeatAgeMs: worker.ageMs,
        capacity,
        utilizationPercent,
      },
      websocket: this.sampleWebsocket(),
      api: apiLatencyRecorder.snapshot(),
      executions,
    };
  }

  async recordSnapshot(snapshot?: OperationalSnapshot): Promise<void> {
    const current = snapshot ?? (await this.collectSnapshot());
    const bucketMinute = new Date(Math.floor(Date.now() / 60_000) * 60_000);
    await OperationalMetricModel.findOneAndUpdate(
      { bucketMinute },
      {
        $set: {
          timestamp: new Date(current.timestamp),
          cpuPercent: current.cpuPercent,
          memoryRssMb: current.memory.rssMb,
          memoryUsedPercent: current.memory.systemUsedPercent,
          redisStatus: current.redis.status,
          redisLatencyMs: current.redis.latencyMs,
          queueAvailable: current.queue.available,
          queueWaiting: current.queue.waiting,
          queueActive: current.queue.active,
          queueDelayed: current.queue.delayed,
          queueFailed: current.queue.failed,
          queueCompleted: current.queue.completed,
          queueDepth: current.queue.depth,
          workerAvailable: current.worker.available,
          workerHeartbeatAgeMs: current.worker.heartbeatAgeMs,
          workerCapacity: current.worker.capacity,
          workerUtilizationPercent: current.worker.utilizationPercent,
          websocketConnections: current.websocket.connections,
          apiRequests: current.api.requests,
          apiP95Ms: current.api.p95Ms,
          apiErrorRatePercent: current.api.errorRatePercent,
          executionsLastHour: current.executions.lastHour,
          executionErrorRatePercent: current.executions.errorRatePercent,
          executionThroughputPerHour: current.executions.throughputPerHour,
        },
      },
      { upsert: true },
    );
  }

  async getMetricsHistory(options: { resolution?: string; hours?: number } = {}): Promise<{
    resolution: MetricResolution;
    hours: number;
    points: MetricsHistoryPoint[];
  }> {
    const resolution = (METRIC_RESOLUTIONS as readonly string[]).includes(options.resolution ?? '')
      ? (options.resolution as MetricResolution)
      : '1m';
    const requestedHours = Number(options.hours);
    const hours = Number.isFinite(requestedHours) && requestedHours > 0
      ? Math.min(MAX_METRICS_WINDOW_HOURS, Math.max(MIN_METRICS_WINDOW_HOURS, Math.round(requestedHours)))
      : DEFAULT_METRICS_WINDOW_HOURS;
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    if (resolution === '1m') {
      const raw = await OperationalMetricModel.find({ timestamp: { $gte: since } })
        .sort({ timestamp: 1 })
        .limit(RAW_POINT_LIMIT)
        .lean();
      return {
        resolution,
        hours,
        points: raw.map((point) => ({
          timestamp: point.timestamp.toISOString(),
          cpuPercent: point.cpuPercent,
          memoryUsedPercent: point.memoryUsedPercent,
          queueDepth: point.queueDepth,
          workerUtilizationPercent: point.workerUtilizationPercent,
          executionsLastHour: point.executionsLastHour,
          executionErrorRatePercent: point.executionErrorRatePercent,
          apiP95Ms: point.apiP95Ms,
          websocketConnections: point.websocketConnections,
        })),
      };
    }

    const intervalMs = RESOLUTION_MS[resolution];
    const rows = await OperationalMetricModel.aggregate<{
      _id: number;
      timestamp: Date;
      cpuPercent: number | null;
      memoryUsedPercent: number | null;
      queueDepth: number | null;
      workerUtilizationPercent: number | null;
      executionsLastHour: number | null;
      executionErrorRatePercent: number | null;
      apiP95Ms: number | null;
      websocketConnections: number | null;
    }>([
      { $match: { timestamp: { $gte: since } } },
      {
        $group: {
          _id: {
            $toLong: {
              $divide: [{ $subtract: ['$timestamp', new Date(0)] }, intervalMs],
            },
          },
          timestamp: { $min: '$timestamp' },
          cpuPercent: { $avg: '$cpuPercent' },
          memoryUsedPercent: { $avg: '$memoryUsedPercent' },
          queueDepth: { $avg: '$queueDepth' },
          workerUtilizationPercent: { $avg: '$workerUtilizationPercent' },
          executionsLastHour: { $max: '$executionsLastHour' },
          executionErrorRatePercent: { $avg: '$executionErrorRatePercent' },
          apiP95Ms: { $avg: '$apiP95Ms' },
          websocketConnections: { $avg: '$websocketConnections' },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    return {
      resolution,
      hours,
      points: rows.map((row) => ({
        timestamp: row.timestamp.toISOString(),
        cpuPercent: row.cpuPercent === null ? null : round1(row.cpuPercent),
        memoryUsedPercent: row.memoryUsedPercent === null ? null : round1(row.memoryUsedPercent),
        queueDepth: round1(row.queueDepth ?? 0),
        workerUtilizationPercent:
          row.workerUtilizationPercent === null ? null : round1(row.workerUtilizationPercent),
        executionsLastHour: Math.round(row.executionsLastHour ?? 0),
        executionErrorRatePercent: round1(row.executionErrorRatePercent ?? 0),
        apiP95Ms: round1(row.apiP95Ms ?? 0),
        websocketConnections:
          row.websocketConnections === null ? null : round1(row.websocketConnections),
      })),
    };
  }
}

export const observabilityCollectorService = ObservabilityCollectorService.getInstance();
export default observabilityCollectorService;
