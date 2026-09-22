import mongoose, { Schema, Types } from 'mongoose';

/**
 * Phase 18.3 - Enterprise support tickets.
 *
 * One record per customer request: who raised it, what it is, who owns it and
 * how it stands against the SLA deadlines stamped at creation. The ticket is the
 * operational record - SLA policy, deadlines and breaches are derived from it,
 * never duplicated into it.
 */

export const SUPPORT_TICKET_CATEGORIES = [
  'GENERAL',
  'BILLING',
  'TECHNICAL',
  'ACCOUNT',
  'SECURITY',
] as const;
export type SupportTicketCategory = (typeof SUPPORT_TICKET_CATEGORIES)[number];

export const SUPPORT_TICKET_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type SupportTicketPriority = (typeof SUPPORT_TICKET_PRIORITIES)[number];

export const SUPPORT_TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING', 'RESOLVED'] as const;
export type SupportTicketStatus = (typeof SUPPORT_TICKET_STATUSES)[number];

/** Statuses that still consume support capacity. */
export const SUPPORT_TICKET_OPEN_STATUSES: readonly SupportTicketStatus[] = [
  'OPEN',
  'IN_PROGRESS',
  'WAITING',
];

export interface ISupportTicket {
  ticketNumber: string;
  workspaceId: Types.ObjectId;
  subject: string;
  description: string;
  category: SupportTicketCategory;
  priority: SupportTicketPriority;
  status: SupportTicketStatus;
  createdBy: Types.ObjectId;
  assigneeId: Types.ObjectId | null;
  slaPolicyId: Types.ObjectId | null;
  firstResponseDueAt: Date | null;
  resolutionDueAt: Date | null;
  firstResponseAt: Date | null;
  resolvedAt: Date | null;
  resolution: string | null;
  escalationLevel: number;
  breached: boolean;
  breachNotifiedAt: Date | null;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}
const SupportTicketSchema = new Schema<ISupportTicket>({
  ticketNumber: { type: String, required: true, unique: true, maxlength: 40 },
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  subject: { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, required: true, trim: true, maxlength: 5000 },
  category: { type: String, enum: [...SUPPORT_TICKET_CATEGORIES], required: true, default: 'GENERAL' },
  priority: { type: String, enum: [...SUPPORT_TICKET_PRIORITIES], required: true, default: 'NORMAL' },
  status: { type: String, enum: [...SUPPORT_TICKET_STATUSES], required: true, default: 'OPEN' },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  assigneeId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  slaPolicyId: { type: Schema.Types.ObjectId, ref: 'SLAPolicy', default: null },
  firstResponseDueAt: { type: Date, default: null },
  resolutionDueAt: { type: Date, default: null },
  firstResponseAt: { type: Date, default: null },
  resolvedAt: { type: Date, default: null },
  resolution: { type: String, default: null, maxlength: 5000 },
  escalationLevel: { type: Number, required: true, min: 0, max: 2, default: 0 },
  breached: { type: Boolean, required: true, default: false },
  breachNotifiedAt: { type: Date, default: null },
  tags: { type: [String], default: [] },
}, { timestamps: true, minimize: false });

SupportTicketSchema.index({ workspaceId: 1, status: 1, createdAt: -1 });
SupportTicketSchema.index({ status: 1, priority: 1, createdAt: -1 });
SupportTicketSchema.index({ resolutionDueAt: 1, status: 1 });
SupportTicketSchema.index({ assigneeId: 1, status: 1 });

export const SupportTicketModel = mongoose.model<ISupportTicket>('SupportTicket', SupportTicketSchema);