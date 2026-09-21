import mongoose, { Schema } from 'mongoose';

export const METRIC_RESOLUTIONS = ['1m', '5m', '1h'] as const;
export type MetricResolution = (typeof METRIC_RESOLUTIONS)[number];

export const OBSERVABILITY_DEFAULT_RETENTION_DAYS = 7;

export function observabilityRetentionDays(): number {
  const raw = Number(process.env.OBSERVABILITY_RETENTION_DAYS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : OBSERVABILITY_DEFAULT_RETENTION_DAYS;
}

export interface IOperationalMetric {
  bucketMinute: Date;
  timestamp: Date;
  cpuPercent: number | null;
  memoryRssMb: number;
  memoryUsedPercent: number | null;
  redisStatus: 'up' | 'down' | 'skipped';
  redisLatencyMs: number;
  queueAvailable: boolean;
  queueWaiting: number;
  queueActive: number;
  queueDelayed: number;
  queueFailed: number;
  queueCompleted: number;
  queueDepth: number;
  workerAvailable: boolean;
  workerHeartbeatAgeMs: number | null;
  workerCapacity: number;
  workerUtilizationPercent: number | null;
  websocketConnections: number | null;
  apiRequests: number;
  apiP95Ms: number;
  apiErrorRatePercent: number;
  executionsLastHour: number;
  executionErrorRatePercent: number;
  executionThroughputPerHour: number;
  createdAt: Date;
}

const OperationalMetricSchema = new Schema<IOperationalMetric>({
  bucketMinute: { type: Date, required: true },
  timestamp: { type: Date, required: true },
  cpuPercent: { type: Number, default: null },
  memoryRssMb: { type: Number, required: true },
  memoryUsedPercent: { type: Number, default: null },
  redisStatus: { type: String, enum: ['up', 'down', 'skipped'], required: true },
  redisLatencyMs: { type: Number, required: true, default: 0 },
  queueAvailable: { type: Boolean, required: true, default: false },
  queueWaiting: { type: Number, required: true, default: 0 },
  queueActive: { type: Number, required: true, default: 0 },
  queueDelayed: { type: Number, required: true, default: 0 },
  queueFailed: { type: Number, required: true, default: 0 },
  queueCompleted: { type: Number, required: true, default: 0 },
  queueDepth: { type: Number, required: true, default: 0 },
  workerAvailable: { type: Boolean, required: true, default: false },
  workerHeartbeatAgeMs: { type: Number, default: null },
  workerCapacity: { type: Number, required: true, default: 0 },
  workerUtilizationPercent: { type: Number, default: null },
  websocketConnections: { type: Number, default: null },
  apiRequests: { type: Number, required: true, default: 0 },
  apiP95Ms: { type: Number, required: true, default: 0 },
  apiErrorRatePercent: { type: Number, required: true, default: 0 },
  executionsLastHour: { type: Number, required: true, default: 0 },
  executionErrorRatePercent: { type: Number, required: true, default: 0 },
  executionThroughputPerHour: { type: Number, required: true, default: 0 },
}, { timestamps: { createdAt: true, updatedAt: false }, minimize: false });

OperationalMetricSchema.index({ bucketMinute: 1 }, { unique: true });
OperationalMetricSchema.index({ timestamp: -1 });
OperationalMetricSchema.index({ createdAt: 1 }, { expireAfterSeconds: observabilityRetentionDays() * 86_400 });

export const OperationalMetricModel = mongoose.model<IOperationalMetric>(
  'OperationalMetric',
  OperationalMetricSchema,
);
