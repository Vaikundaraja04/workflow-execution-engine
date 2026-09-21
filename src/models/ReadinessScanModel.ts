import mongoose, { Schema, Types } from 'mongoose';

export interface IReadinessScanDimensions {
  security: { score: number; failures: number; warnings: number };
  database: { score: number; verdict: string; recommendations: number };
  deployment: { score: number; verdict: string };
  queueWorker: { score: number; checks: number; passing: number };
}

export interface IReadinessScanMetrics {
  redisStatus: 'up' | 'down' | 'skipped';
  queueDepth: number;
  workerAvailable: boolean;
  workerUtilizationPercent: number | null;
  apiP95Ms: number;
  executionsLastHour: number;
  executionErrorRatePercent: number;
}

export interface IReadinessScan {
  workspaceId?: Types.ObjectId;
  score: number;
  previousScore: number | null;
  delta: number | null;
  verdict: 'READY' | 'NEEDS_ATTENTION' | 'NOT_READY';
  dimensions: IReadinessScanDimensions;
  metrics: IReadinessScanMetrics;
  regressions: string[];
  createdAt: Date;
}

const ReadinessScanSchema = new Schema<IReadinessScan>({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace' },
  score: { type: Number, required: true, min: 0, max: 100 },
  previousScore: { type: Number, default: null },
  delta: { type: Number, default: null },
  verdict: { type: String, enum: ['READY', 'NEEDS_ATTENTION', 'NOT_READY'], required: true },
  dimensions: { type: Schema.Types.Mixed, required: true },
  metrics: { type: Schema.Types.Mixed, required: true },
  regressions: { type: [String], default: [] },
}, { timestamps: { createdAt: true, updatedAt: false }, minimize: false });

ReadinessScanSchema.index({ createdAt: -1 });
ReadinessScanSchema.index({ workspaceId: 1, createdAt: -1 });

export const ReadinessScanModel = mongoose.model<IReadinessScan>('ReadinessScan', ReadinessScanSchema);
