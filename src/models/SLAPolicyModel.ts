import mongoose, { Schema, Types } from 'mongoose';
import { SUPPORT_TICKET_PRIORITIES } from './SupportTicketModel.js';
import type { SupportTicketPriority } from './SupportTicketModel.js';

/**
 * Phase 18.4 - SLA policies.
 *
 * One policy per support priority: how long the first response and the
 * resolution may take. Defaults are seeded once and can be archived or extended
 * by administrators; tickets store the policy they were created under, so a
 * policy change never rewrites history.
 */

export const SLA_POLICY_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export type SlaPolicyStatus = (typeof SLA_POLICY_STATUSES)[number];

export interface ISlaPolicy {
  name: string;
  priority: SupportTicketPriority;
  responseTimeMinutes: number;
  resolutionTimeMinutes: number;
  status: SlaPolicyStatus;
  description: string | null;
  createdBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

export const DEFAULT_SLA_POLICIES: ReadonlyArray<{
  name: string;
  priority: SupportTicketPriority;
  responseTimeMinutes: number;
  resolutionTimeMinutes: number;
  description: string;
}> = [
  {
    name: 'Urgent support',
    priority: 'URGENT',
    responseTimeMinutes: 60,
    resolutionTimeMinutes: 480,
    description: 'Urgent: 1 hour first response, 8 hour resolution.',
  },
  {
    name: 'High support',
    priority: 'HIGH',
    responseTimeMinutes: 240,
    resolutionTimeMinutes: 1440,
    description: 'High: 4 hour first response, 24 hour resolution.',
  },
  {
    name: 'Normal support',
    priority: 'NORMAL',
    responseTimeMinutes: 480,
    resolutionTimeMinutes: 2880,
    description: 'Normal: 8 hour first response, 48 hour resolution.',
  },
  {
    name: 'Low support',
    priority: 'LOW',
    responseTimeMinutes: 1440,
    resolutionTimeMinutes: 4320,
    description: 'Low: 24 hour first response, 72 hour resolution.',
  },
];
const SlaPolicySchema = new Schema<ISlaPolicy>({
  name: { type: String, required: true, unique: true, trim: true, maxlength: 120 },
  priority: { type: String, enum: [...SUPPORT_TICKET_PRIORITIES], required: true },
  responseTimeMinutes: { type: Number, required: true, min: 1 },
  resolutionTimeMinutes: { type: Number, required: true, min: 1 },
  status: { type: String, enum: [...SLA_POLICY_STATUSES], required: true, default: 'ACTIVE' },
  description: { type: String, default: null, maxlength: 300 },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true, minimize: false });

SlaPolicySchema.index({ priority: 1, status: 1 });

export const SLAPolicyModel = mongoose.model<ISlaPolicy>('SLAPolicy', SlaPolicySchema);