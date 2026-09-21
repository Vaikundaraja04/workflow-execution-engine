import mongoose, { Schema, Types } from 'mongoose';

export const USAGE_METRICS = [
  'EXECUTIONS',
  'AI_TOKENS',
  'AGENT_RUNS',
  'STORAGE_BYTES',
  'API_REQUESTS',
] as const;
export type UsageMetric = (typeof USAGE_METRICS)[number];

export const METER_GRANULARITIES = ['DAY', 'MONTH'] as const;
export type MeterGranularity = (typeof METER_GRANULARITIES)[number];

export const METER_ALERT_STATES = ['OK', 'WARNING', 'EXCEEDED'] as const;
export type MeterAlertState = (typeof METER_ALERT_STATES)[number];

export interface IUsageMeter {
  workspaceId: Types.ObjectId;
  metric: UsageMetric;
  granularity: MeterGranularity;
  periodKey: string;
  value: number;
  limit?: number | null;
  percent: number;
  alertState: MeterAlertState;
  createdAt: Date;
  updatedAt: Date;
}

const UsageMeterSchema = new Schema<IUsageMeter>({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  metric: { type: String, enum: [...USAGE_METRICS], required: true },
  granularity: { type: String, enum: [...METER_GRANULARITIES], required: true },
  periodKey: { type: String, required: true, maxlength: 10 },
  value: { type: Number, required: true, min: 0, default: 0 },
  limit: { type: Number, default: null, min: 0 },
  percent: { type: Number, required: true, min: 0, default: 0 },
  alertState: { type: String, enum: [...METER_ALERT_STATES], required: true, default: 'OK' },
}, { timestamps: true });

UsageMeterSchema.index(
  { workspaceId: 1, metric: 1, granularity: 1, periodKey: 1 },
  { unique: true },
);
UsageMeterSchema.index({ metric: 1, granularity: 1, periodKey: 1, value: -1 });
UsageMeterSchema.index({ workspaceId: 1, granularity: 1, periodKey: -1 });

export const UsageMeterModel = mongoose.model<IUsageMeter>('UsageMeter', UsageMeterSchema);
