import mongoose, { Schema, Document, Types } from 'mongoose';

export const WEBHOOK_DELIVERY_STATUSES = [
  'PENDING',
  'DELIVERED',
  'FAILED',
  'RETRYING',
] as const;

export type WebhookDeliveryStatus = (typeof WEBHOOK_DELIVERY_STATUSES)[number];

export interface IWebhookDelivery extends Document<Types.ObjectId> {
  webhookId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  event: string;
  payload: string; // JSON string of the payload
  status: WebhookDeliveryStatus;
  attempts: number;
  maxAttempts: number;
  nextRetryAt?: Date;
  responseCode?: number;
  responseBody?: string;
  durationMs?: number;
  createdAt: Date;
  deliveredAt?: Date;
}

const WebhookDeliverySchema = new Schema<IWebhookDelivery>({
  webhookId: { type: Schema.Types.ObjectId, ref: 'Webhook', required: true },
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  event: { type: String, required: true },
  payload: { type: String, required: true },
  status: { type: String, enum: WEBHOOK_DELIVERY_STATUSES, required: true, default: 'PENDING' },
  attempts: { type: Number, required: true, min: 0, default: 0 },
  maxAttempts: { type: Number, required: true, min: 1, default: 5 },
  nextRetryAt: { type: Date },
  responseCode: { type: Number },
  responseBody: { type: String },
  durationMs: { type: Number },
}, { timestamps: true });

WebhookDeliverySchema.index({ webhookId: 1, createdAt: -1 });
WebhookDeliverySchema.index({ workspaceId: 1, createdAt: -1 });
WebhookDeliverySchema.index({ status: 1, nextRetryAt: 1 });

export const WebhookDeliveryModel = mongoose.model<IWebhookDelivery>('WebhookDelivery', WebhookDeliverySchema);