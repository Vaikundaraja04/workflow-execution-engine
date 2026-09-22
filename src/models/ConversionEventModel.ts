import mongoose, { Schema, Types } from 'mongoose';

/**
 * Phase 14.9 - Marketing Conversion Tracking.
 *
 * Append-only funnel events. Deliberately stores no credentials or request
 * bodies: only the funnel step, an optional tenant/lead reference and coarse
 * attribution metadata.
 */

export const CONVERSION_EVENTS = [
  'LANDING_VIEW',
  'SIGNUP_STARTED',
  'SIGNUP_COMPLETED',
  'DEMO_CREATED',
  'SUBSCRIPTION_STARTED',
] as const;
export type ConversionEventName = (typeof CONVERSION_EVENTS)[number];

/** Funnel order used for reporting. */
export const CONVERSION_FUNNEL_ORDER: readonly ConversionEventName[] = [
  'LANDING_VIEW',
  'SIGNUP_STARTED',
  'SIGNUP_COMPLETED',
  'DEMO_CREATED',
  'SUBSCRIPTION_STARTED',
];

export interface IConversionEvent {
  event: ConversionEventName;
  workspaceId?: Types.ObjectId | null;
  leadId?: Types.ObjectId | null;
  userId?: Types.ObjectId | null;
  plan?: string | null;
  packageId?: string | null;
  source?: string | null;
  anonymousId?: string | null;
  utm?: Record<string, string> | undefined;
  occurredAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ConversionEventSchema = new Schema<IConversionEvent>({
  event: { type: String, enum: [...CONVERSION_EVENTS], required: true },
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', default: null },
  leadId: { type: Schema.Types.ObjectId, ref: 'Lead', default: null },
  userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  plan: { type: String, maxlength: 32, default: null },
  packageId: { type: String, maxlength: 32, default: null },
  source: { type: String, maxlength: 64, default: null },
  anonymousId: { type: String, maxlength: 128, default: null },
  utm: { type: Schema.Types.Mixed, default: undefined },
  occurredAt: { type: Date, required: true, default: Date.now },
}, { timestamps: true, minimize: false });

ConversionEventSchema.index({ event: 1, occurredAt: -1 });
ConversionEventSchema.index({ workspaceId: 1, event: 1, occurredAt: -1 });
ConversionEventSchema.index({ leadId: 1, occurredAt: -1 });
ConversionEventSchema.index({ 'utm.source': 1, event: 1 });

export const ConversionEventModel = mongoose.model<IConversionEvent>('ConversionEvent', ConversionEventSchema);

export function isConversionEventName(value: unknown): value is ConversionEventName {
  return typeof value === 'string' && (CONVERSION_EVENTS as readonly string[]).includes(value);
}
