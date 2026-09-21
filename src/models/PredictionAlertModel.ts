import mongoose, { Schema, Document, Types } from 'mongoose';

export type PredictionAlertStatus = 'active' | 'acknowledged' | 'resolved' | 'dismissed';

export interface IPredictionAlert extends Document<Types.ObjectId> {
  workspaceId: Types.ObjectId;
  type: 'failure' | 'performance' | 'capacity' | 'cost';
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number; // 0-100
  prediction: Record<string, any>; // Type-specific prediction data
  recommendation: string;
  status: PredictionAlertStatus;
  predictedAt: Date; // When prediction was made
  horizon: '1h' | '6h' | '24h' | '7d' | '30d';
  modelVersion: string;
  featuresUsed: string[];
  resolvedAt?: Date;
  resolvedBy?: Types.ObjectId;
  acknowledgedAt?: Date;
  acknowledgedBy?: Types.ObjectId;
  acknowledgedNote?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PredictionAlertSchema = new Schema<IPredictionAlert>({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  type: {
    type: String,
    enum: ['failure', 'performance', 'capacity', 'cost'],
    required: true,
  },
  severity: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    required: true,
  },
  confidence: { type: Number, required: true, min: 0, max: 100 },
  prediction: { type: Schema.Types.Mixed, required: true },
  recommendation: { type: String, required: true },
  status: {
    type: String,
    enum: ['active', 'acknowledged', 'resolved', 'dismissed'],
    default: 'active',
  },
  predictedAt: { type: Date, required: true, default: Date.now },
  horizon: {
    type: String,
    enum: ['1h', '6h', '24h', '7d', '30d'],
    default: '24h',
  },
  modelVersion: { type: String, default: 'v1.0.0' },
  featuresUsed: [{ type: String, default: [] }],
  resolvedAt: { type: Date },
  resolvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  acknowledgedAt: { type: Date },
  acknowledgedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  acknowledgedNote: { type: String },
}, { timestamps: true });

PredictionAlertSchema.index({ workspaceId: 1, status: 1, predictedAt: -1 });
PredictionAlertSchema.index({ workspaceId: 1, type: 1, status: 1 });
PredictionAlertSchema.index({ predictedAt: 1 });
PredictionAlertSchema.index({ workspaceId: 1, type: 1, severity: 1, status: 1 });

export const PredictionAlertModel = mongoose.model<IPredictionAlert>('PredictionAlert', PredictionAlertSchema);