import mongoose, { Schema, Types } from 'mongoose';

/**
 * Phase 15.4 - Billing webhook idempotency ledger.
 *
 * Providers retry deliveries, so every received event is recorded once by
 * (provider, eventId) and a duplicate delivery is answered from this record
 * instead of being re-applied. Only normalized, non-sensitive fields are
 * stored - never the raw payload, signatures or card data.
 */

export const WEBHOOK_EVENT_TYPES = [
  'payment_success',
  'payment_failed',
  'subscription_created',
  'subscription_updated',
  'subscription_cancelled',
  'invoice_paid',
  'unhandled',
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export const WEBHOOK_EVENT_STATUSES = ['APPLIED', 'IGNORED', 'FAILED'] as const;
export type WebhookEventStatus = (typeof WEBHOOK_EVENT_STATUSES)[number];

export interface IWebhookEvent {
  provider: string;
  eventId: string;
  providerType: string;
  type: WebhookEventType;
  status: WebhookEventStatus;
  workspaceId?: Types.ObjectId | null;
  externalSubscriptionId?: string | null;
  externalCustomerId?: string | null;
  metadata?: Record<string, unknown> | undefined;
  attempts: number;
  appliedAt: Date | null;
  error?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const WebhookEventSchema = new Schema<IWebhookEvent>({
  provider: { type: String, required: true, maxlength: 32 },
  eventId: { type: String, required: true, maxlength: 191 },
  providerType: { type: String, required: true, maxlength: 191 },
  type: { type: String, enum: [...WEBHOOK_EVENT_TYPES], required: true },
  status: { type: String, enum: [...WEBHOOK_EVENT_STATUSES], required: true, default: 'APPLIED' },
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', default: null },
  externalSubscriptionId: { type: String, maxlength: 191, default: null },
  externalCustomerId: { type: String, maxlength: 191, default: null },
  metadata: { type: Schema.Types.Mixed, default: undefined },
  attempts: { type: Number, required: true, default: 1, min: 1 },
  appliedAt: { type: Date, default: null },
  error: { type: String, maxlength: 500, default: null },
}, { timestamps: true, minimize: false });

WebhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });
WebhookEventSchema.index({ provider: 1, type: 1, createdAt: -1 });
WebhookEventSchema.index({ status: 1, createdAt: -1 });

export const WebhookEventModel = mongoose.model<IWebhookEvent>('WebhookEvent', WebhookEventSchema);

export function isWebhookEventType(value: unknown): value is WebhookEventType {
  return typeof value === 'string' && (WEBHOOK_EVENT_TYPES as readonly string[]).includes(value);
}
