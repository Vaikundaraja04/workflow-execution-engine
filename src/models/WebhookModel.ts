import mongoose, { Schema, Document, Types } from 'mongoose';

export const WEBHOOK_EVENTS = [
  'WORKFLOW_EXECUTION_STARTED',
  'WORKFLOW_EXECUTION_COMPLETED',
  'WORKFLOW_EXECUTION_FAILED',
  'WORKFLOW_EXECUTION_REPLAYED',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export type WebhookStatus = 'ACTIVE' | 'PAUSED' | 'DISABLED';

export interface IWebhook extends Document<Types.ObjectId> {
  workspaceId: Types.ObjectId;
  name: string;
  url: string;
  events: WebhookEvent[];
  encryptedSecret: string;
  status: WebhookStatus;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const WebhookSchema = new Schema<IWebhook>({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  url: { type: String, required: true, maxlength: 2048 },
  events: { type: [String], enum: WEBHOOK_EVENTS, required: true },
  encryptedSecret: { type: String, required: true },
  status: { type: String, enum: ['ACTIVE', 'PAUSED', 'DISABLED'], default: 'ACTIVE' },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

WebhookSchema.index({ workspaceId: 1, createdAt: -1 });
WebhookSchema.index({ workspaceId: 1, status: 1 });

export const WebhookModel = mongoose.model<IWebhook>('Webhook', WebhookSchema);
