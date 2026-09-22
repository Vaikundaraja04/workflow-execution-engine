import mongoose, { Schema, Types } from 'mongoose';

/**
 * Phase 16.1 - Growth lifecycle event ledger.
 *
 * One append-only row per lifecycle transition (visit -> signup -> demo ->
 * trial -> payment -> customer -> churn). ConversionEventModel (Phase 14.9)
 * stays the marketing funnel log; this ledger is the canonical source for the
 * growth funnel, conversion and retention reports. Rows store references and
 * coarse attribution only - never credentials or payload bodies.
 */

export const GROWTH_EVENTS = [
  'LANDING_VIEW',
  'SIGNUP_STARTED',
  'SIGNUP_COMPLETED',
  'DEMO_REQUESTED',
  'DEMO_STARTED',
  'TRIAL_STARTED',
  'TRIAL_ACTIVATED',
  'PAYMENT_COMPLETED',
  'CUSTOMER_CONVERTED',
  'CUSTOMER_CHURNED',
] as const;
export type GrowthEventName = (typeof GROWTH_EVENTS)[number];

/** Funnel order used by the acquisition report. */
export const GROWTH_FUNNEL_ORDER: readonly GrowthEventName[] = [
  'LANDING_VIEW',
  'SIGNUP_STARTED',
  'SIGNUP_COMPLETED',
  'DEMO_REQUESTED',
  'DEMO_STARTED',
  'TRIAL_STARTED',
  'TRIAL_ACTIVATED',
  'PAYMENT_COMPLETED',
  'CUSTOMER_CONVERTED',
  'CUSTOMER_CHURNED',
];

export interface IGrowthEvent {
  event: GrowthEventName;
  workspaceId?: Types.ObjectId | null;
  leadId?: Types.ObjectId | null;
  userId?: Types.ObjectId | null;
  partnerId?: Types.ObjectId | null;
  plan?: string | null;
  packageId?: string | null;
  source?: string | null;
  anonymousId?: string | null;
  amount?: number | null;
  currency?: string | null;
  metadata?: Record<string, unknown> | undefined;
  occurredAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const GrowthEventSchema = new Schema<IGrowthEvent>({
  event: { type: String, enum: [...GROWTH_EVENTS], required: true },
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', default: null },
  leadId: { type: Schema.Types.ObjectId, ref: 'Lead', default: null },
  userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  partnerId: { type: Schema.Types.ObjectId, ref: 'Partner', default: null },
  plan: { type: String, maxlength: 32, default: null },
  packageId: { type: String, maxlength: 32, default: null },
  source: { type: String, maxlength: 64, default: null },
  anonymousId: { type: String, maxlength: 128, default: null },
  amount: { type: Number, min: 0, default: null },
  currency: { type: String, maxlength: 8, default: null },
  metadata: { type: Schema.Types.Mixed, default: undefined },
  occurredAt: { type: Date, required: true, default: Date.now },
}, { timestamps: true, minimize: false });

GrowthEventSchema.index({ event: 1, occurredAt: -1 });
GrowthEventSchema.index({ workspaceId: 1, event: 1, occurredAt: -1 });
GrowthEventSchema.index({ leadId: 1, occurredAt: -1 });
GrowthEventSchema.index({ partnerId: 1, occurredAt: -1 });
GrowthEventSchema.index({ source: 1, event: 1, occurredAt: -1 });

export const GrowthEventModel = mongoose.model<IGrowthEvent>('GrowthEvent', GrowthEventSchema);

export function isGrowthEventName(value: unknown): value is GrowthEventName {
  return typeof value === 'string' && (GROWTH_EVENTS as readonly string[]).includes(value);
}
