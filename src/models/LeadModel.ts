import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * Phase 14.5 - Lead Management.
 *
 * Captures inbound demand (company, contact, industry, size, interest) together
 * with the demo lifecycle so sales can work a pipeline from lead to subscription.
 */

export const LEAD_STATUSES = [
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'DEMO_SCHEDULED',
  'DEMO_COMPLETED',
  'PROPOSAL',
  'WON',
  'LOST',
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_DEMO_STATUSES = ['NONE', 'REQUESTED', 'CREATED', 'COMPLETED', 'EXPIRED'] as const;
export type LeadDemoStatus = (typeof LEAD_DEMO_STATUSES)[number];

export const LEAD_SOURCES = [
  'WEBSITE',
  'PRICING_PAGE',
  'DEMO_REQUEST',
  'REFERRAL',
  'OUTBOUND',
  'PARTNER',
  'OTHER',
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_INTERESTS = ['STARTER', 'BUSINESS', 'ENTERPRISE', 'NOT_SURE'] as const;
export type LeadInterest = (typeof LEAD_INTERESTS)[number];

export const COMPANY_SIZES = ['1-10', '11-50', '51-200', '201-1000', '1000+'] as const;
export type CompanySize = (typeof COMPANY_SIZES)[number];

export const INDUSTRIES = [
  'Technology',
  'Financial Services',
  'Healthcare',
  'Retail',
  'Manufacturing',
  'Logistics',
  'Professional Services',
  'Telecommunications',
  'Public Sector',
  'Other',
] as const;
export type Industry = (typeof INDUSTRIES)[number];

export interface ILeadNote {
  authorUserId: Types.ObjectId | null;
  note: string;
  createdAt: Date;
}

export interface ILead extends Document<Types.ObjectId> {
  company: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string | null;
  industry: string;
  companySize: string | null;
  interest: LeadInterest | null;
  message?: string | null;
  source: LeadSource;
  status: LeadStatus;
  demoStatus: LeadDemoStatus;
  workspaceId?: Types.ObjectId | null;
  demoWorkspaceId?: Types.ObjectId | null;
  demoExpiresAt?: Date | null;
  assignedTo?: Types.ObjectId | null;
  estimatedValueMonthly?: number | null;
  lostReason?: string | null;
  notes: ILeadNote[];
  tags: string[];
  utm?: Record<string, string> | undefined;
  lastContactedAt?: Date | null;
  capturedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const LeadNoteSchema = new Schema<ILeadNote>({
  authorUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  note: { type: String, required: true, maxlength: 2000 },
  createdAt: { type: Date, required: true, default: Date.now },
}, { _id: false });

const LeadSchema = new Schema<ILead>({
  company: { type: String, required: true, trim: true, maxlength: 160 },
  contactName: { type: String, required: true, trim: true, maxlength: 160 },
  contactEmail: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
  contactPhone: { type: String, trim: true, maxlength: 40, default: null },
  industry: { type: String, required: true, trim: true, maxlength: 80, default: 'Other' },
  companySize: { type: String, enum: [...COMPANY_SIZES, null], default: null },
  interest: { type: String, enum: [...LEAD_INTERESTS, null], default: null },
  message: { type: String, trim: true, maxlength: 2000, default: null },
  source: { type: String, enum: [...LEAD_SOURCES], required: true, default: 'WEBSITE' },
  status: { type: String, enum: [...LEAD_STATUSES], required: true, default: 'NEW' },
  demoStatus: { type: String, enum: [...LEAD_DEMO_STATUSES], required: true, default: 'NONE' },
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', default: null },
  demoWorkspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', default: null },
  demoExpiresAt: { type: Date, default: null },
  assignedTo: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  estimatedValueMonthly: { type: Number, min: 0, default: null },
  lostReason: { type: String, trim: true, maxlength: 400, default: null },
  notes: { type: [LeadNoteSchema], default: [] },
  tags: { type: [String], default: [] },
  utm: { type: Schema.Types.Mixed, default: undefined },
  lastContactedAt: { type: Date, default: null },
  capturedAt: { type: Date, required: true, default: Date.now },
}, { timestamps: true, minimize: false });

LeadSchema.index({ contactEmail: 1, createdAt: -1 });
LeadSchema.index({ status: 1, createdAt: -1 });
LeadSchema.index({ demoStatus: 1, updatedAt: -1 });
LeadSchema.index({ company: 1 });
LeadSchema.index({ demoWorkspaceId: 1 });

export const LeadModel = mongoose.model<ILead>('Lead', LeadSchema);

export function isLeadStatus(value: unknown): value is LeadStatus {
  return typeof value === 'string' && (LEAD_STATUSES as readonly string[]).includes(value);
}

export function isLeadDemoStatus(value: unknown): value is LeadDemoStatus {
  return typeof value === 'string' && (LEAD_DEMO_STATUSES as readonly string[]).includes(value);
}
