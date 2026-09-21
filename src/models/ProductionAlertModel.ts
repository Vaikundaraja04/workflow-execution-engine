import mongoose, { Schema, Types } from 'mongoose';

export const PRODUCTION_ALERT_TYPES = [
  'READINESS_DROP',
  'SECURITY_REGRESSION',
  'QUEUE_OVERLOAD',
  'WORKER_FAILURE',
  'AI_COST_SPIKE',
] as const;
export type ProductionAlertType = (typeof PRODUCTION_ALERT_TYPES)[number];

export const PRODUCTION_ALERT_STATUSES = ['OPEN', 'ACKNOWLEDGED'] as const;
export type ProductionAlertStatus = (typeof PRODUCTION_ALERT_STATUSES)[number];

export const PRODUCTION_ALERT_SEVERITIES = ['WARNING', 'CRITICAL'] as const;
export type ProductionAlertSeverity = (typeof PRODUCTION_ALERT_SEVERITIES)[number];

export interface IProductionAlert {
  type: ProductionAlertType;
  severity: ProductionAlertSeverity;
  status: ProductionAlertStatus;
  workspaceId?: Types.ObjectId;
  title: string;
  details: string;
  value: number | null;
  threshold: number | null;
  scanId?: Types.ObjectId;
  acknowledgedAt?: Date;
  acknowledgedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ProductionAlertSchema = new Schema<IProductionAlert>({
  type: { type: String, enum: [...PRODUCTION_ALERT_TYPES], required: true },
  severity: { type: String, enum: [...PRODUCTION_ALERT_SEVERITIES], required: true },
  status: { type: String, enum: [...PRODUCTION_ALERT_STATUSES], default: 'OPEN' },
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace' },
  title: { type: String, required: true, maxlength: 200 },
  details: { type: String, required: true, maxlength: 2000 },
  value: { type: Number, default: null },
  threshold: { type: Number, default: null },
  scanId: { type: Schema.Types.ObjectId, ref: 'ReadinessScan' },
  acknowledgedAt: { type: Date },
  acknowledgedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

ProductionAlertSchema.index({ status: 1, type: 1, workspaceId: 1 });
ProductionAlertSchema.index({ createdAt: -1 });
ProductionAlertSchema.index({ workspaceId: 1, createdAt: -1 });

export const ProductionAlertModel = mongoose.model<IProductionAlert>('ProductionAlert', ProductionAlertSchema);
