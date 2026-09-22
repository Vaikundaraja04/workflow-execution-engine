import mongoose, { Schema, Types } from 'mongoose';
import { EMAIL_TEMPLATE_KEYS } from './EmailTemplateModel.js';
import type { EmailTemplateKey } from './EmailTemplateModel.js';

/**
 * Phase 15.6 - Notification delivery log.
 *
 * One row per send attempt so operators can see what went out, through which
 * provider, and retry failures. No message bodies are stored - only the template
 * key and coarse metadata, so customer content never lands in the log.
 */

export const NOTIFICATION_STATUSES = ['QUEUED', 'SENT', 'FAILED'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export interface INotificationLog {
  workspaceId?: Types.ObjectId | null;
  userId?: Types.ObjectId | null;
  channel: 'email';
  recipient: string;
  template: EmailTemplateKey;
  subject: string;
  provider: string;
  status: NotificationStatus;
  attempts: number;
  providerMessageId?: string | null;
  error?: string | null;
  queuedAt: Date;
  sentAt: Date | null;
  metadata?: Record<string, unknown> | undefined;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationLogSchema = new Schema<INotificationLog>({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', default: null },
  userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  channel: { type: String, enum: ['email'], required: true, default: 'email' },
  recipient: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
  template: { type: String, enum: [...EMAIL_TEMPLATE_KEYS], required: true },
  subject: { type: String, required: true, maxlength: 200 },
  provider: { type: String, required: true, maxlength: 32 },
  status: { type: String, enum: [...NOTIFICATION_STATUSES], required: true, default: 'QUEUED' },
  attempts: { type: Number, required: true, default: 0, min: 0 },
  providerMessageId: { type: String, maxlength: 191, default: null },
  error: { type: String, maxlength: 500, default: null },
  queuedAt: { type: Date, required: true, default: Date.now },
  sentAt: { type: Date, default: null },
  metadata: { type: Schema.Types.Mixed, default: undefined },
}, { timestamps: true, minimize: false });

NotificationLogSchema.index({ recipient: 1, createdAt: -1 });
NotificationLogSchema.index({ status: 1, queuedAt: 1 });
NotificationLogSchema.index({ workspaceId: 1, template: 1, createdAt: -1 });

export const NotificationLogModel = mongoose.model<INotificationLog>('NotificationLog', NotificationLogSchema);

export function isNotificationStatus(value: unknown): value is NotificationStatus {
  return typeof value === 'string' && (NOTIFICATION_STATUSES as readonly string[]).includes(value);
}
