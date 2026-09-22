import { Types } from 'mongoose';
import { LeadModel } from '../models/LeadModel.js';
import type {
  ILead,
  LeadStatus,
  LeadDemoStatus,
  LeadSource,
  LeadInterest,
} from '../models/LeadModel.js';
import { createAuditLog } from './auditService.js';

/**
 * Phase 14.5 - Lead lifecycle: capture, qualification, pipeline and demo linkage.
 *
 * Capture is intentionally tolerant (marketing forms are noisy); the pipeline
 * view is what sales works from, so scoring and next-action are derived here.
 */

export interface CaptureLeadInput {
  company: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string | undefined;
  industry?: string | undefined;
  companySize?: string | undefined;
  interest?: LeadInterest | undefined;
  message?: string | undefined;
  source?: LeadSource | undefined;
  utm?: Record<string, string> | undefined;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}

export interface UpdateLeadInput {
  status?: LeadStatus | undefined;
  demoStatus?: LeadDemoStatus | undefined;
  assignedTo?: string | null | undefined;
  industry?: string | undefined;
  companySize?: string | null | undefined;
  interest?: LeadInterest | null | undefined;
  estimatedValueMonthly?: number | null | undefined;
  lostReason?: string | null | undefined;
  tags?: string[] | undefined;
  note?: string | undefined;
  markContacted?: boolean | undefined;
  demoWorkspaceId?: string | null | undefined;
  workspaceId?: string | null | undefined;
}

export interface LeadListFilters {
  status?: LeadStatus | undefined;
  demoStatus?: LeadDemoStatus | undefined;
  source?: LeadSource | undefined;
  search?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface LeadScore {
  score: number;
  band: 'hot' | 'warm' | 'cold';
  factors: { fit: number; intent: number; engagement: number };
}

export interface LeadRow {
  id: string;
  company: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  industry: string;
  companySize: string | null;
  interest: LeadInterest | null;
  source: LeadSource;
  status: LeadStatus;
  demoStatus: LeadDemoStatus;
  demoWorkspaceId: string | null;
  workspaceId: string | null;
  assignedTo: string | null;
  estimatedValueMonthly: number | null;
  tags: string[];
  notesCount: number;
  capturedAt: Date;
  lastContactedAt: Date | null;
  updatedAt: Date;
  score: LeadScore;
  nextAction: string;
  followUpStatus: LeadFollowUpStatus;
}

export interface PipelineStage {
  status: LeadStatus;
  count: number;
  estimatedValueMonthly: number;
}

export interface PipelineSummary {
  stages: PipelineStage[];
  totals: { leads: number; open: number; won: number; lost: number; pipelineValueMonthly: number };
  demoFunnel: { requested: number; created: number; completed: number };
}

export interface LeadListResult {
  leads: LeadRow[];
  total: number;
  limit: number;
  offset: number;
  pipeline: PipelineSummary;
}

export interface LeadDetail extends LeadRow {
  message: string | null;
  lostReason: string | null;
  notes: Array<{ authorUserId: string | null; note: string; createdAt: Date }>;
}

export const OPEN_LEAD_STATUSES: readonly LeadStatus[] = [
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'DEMO_SCHEDULED',
  'DEMO_COMPLETED',
  'PROPOSAL',
];

export const PIPELINE_STATUS_ORDER: readonly LeadStatus[] = [
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'DEMO_SCHEDULED',
  'DEMO_COMPLETED',
  'PROPOSAL',
  'WON',
  'LOST',
];

const COMPANY_SIZE_SCORE: Record<string, number> = {
  '1-10': 40,
  '11-50': 60,
  '51-200': 80,
  '201-1000': 95,
  '1000+': 100,
};

const INTEREST_SCORE: Record<LeadInterest, number> = {
  STARTER: 50,
  BUSINESS: 80,
  ENTERPRISE: 100,
  NOT_SURE: 40,
};

export type LeadFollowUpStatus = 'overdue' | 'due' | 'scheduled' | 'none';

const FOLLOW_UP_DUE_DAYS = 3;
const FOLLOW_UP_OVERDUE_DAYS = 7;

/**
 * Follow-up state sales works from: closed leads need nothing, and an open lead
 * is scheduled, due or overdue against the last touch (or capture) date.
 */
export function followUpStatusFor(
  lead: Pick<ILead, 'status' | 'lastContactedAt' | 'capturedAt'>,
  now: Date = new Date(),
): LeadFollowUpStatus {
  if (lead.status === 'WON' || lead.status === 'LOST') return 'none';
  const reference = lead.lastContactedAt ?? lead.capturedAt;
  const days = (now.getTime() - new Date(reference).getTime()) / (24 * 60 * 60 * 1000);
  if (days >= FOLLOW_UP_OVERDUE_DAYS) return 'overdue';
  if (days >= FOLLOW_UP_DUE_DAYS) return 'due';
  return 'scheduled';
}

const DEMO_SCORE: Record<LeadDemoStatus, number> = {
  NONE: 30,
  REQUESTED: 70,
  CREATED: 85,
  COMPLETED: 100,
  EXPIRED: 20,
};

/** Derive a 0-100 lead score plus the recommended next action. */
export function scoreLead(
  lead: Pick<ILead, 'companySize' | 'interest' | 'demoStatus' | 'message' | 'lastContactedAt' | 'estimatedValueMonthly'>,
): LeadScore {
  const fit = lead.companySize
    ? COMPANY_SIZE_SCORE[lead.companySize] ?? 50
    : lead.interest
      ? INTEREST_SCORE[lead.interest]
      : 45;
  const intent = lead.interest
    ? Math.round((INTEREST_SCORE[lead.interest] + DEMO_SCORE[lead.demoStatus]) / 2)
    : DEMO_SCORE[lead.demoStatus];

  const daysSinceContact = lead.lastContactedAt
    ? (Date.now() - lead.lastContactedAt.getTime()) / (24 * 60 * 60 * 1000)
    : null;
  let engagement = 50;
  if (lead.message && lead.message.trim().length > 0) engagement += 15;
  if (lead.estimatedValueMonthly && lead.estimatedValueMonthly > 0) engagement += 10;
  if (daysSinceContact !== null) {
    engagement = daysSinceContact <= 3 ? engagement + 20 : daysSinceContact <= 14 ? engagement : engagement - 15;
  }
  engagement = Math.max(0, Math.min(100, engagement));

  const score = Math.round(fit * 0.35 + intent * 0.4 + engagement * 0.25);
  const band: LeadScore['band'] = score >= 70 ? 'hot' : score >= 45 ? 'warm' : 'cold';
  return { score, band, factors: { fit, intent, engagement } };
}

export function nextActionFor(lead: Pick<ILead, 'status' | 'demoStatus'>): string {
  switch (lead.status) {
    case 'NEW':
      return 'Qualify: confirm requirements and company size';
    case 'CONTACTED':
      return lead.demoStatus === 'NONE' ? 'Offer a guided demo workspace' : 'Schedule the demo walkthrough';
    case 'QUALIFIED':
      return 'Send the packaged solution overview for their industry';
    case 'DEMO_SCHEDULED':
      return 'Confirm the demo session and invite the technical evaluator';
    case 'DEMO_COMPLETED':
      return 'Share pricing for the package they trialled and start the trial';
    case 'PROPOSAL':
      return 'Follow up on the proposal and confirm the billing provider';
    case 'WON':
      return 'Hand off to customer success for onboarding';
    case 'LOST':
      return 'Record the loss reason and set a nurture reminder';
    default:
      return 'Review lead';
  }
}

export function toLeadRow(lead: ILead): LeadRow {
  return {
    id: lead._id.toString(),
    company: lead.company,
    contactName: lead.contactName,
    contactEmail: lead.contactEmail,
    contactPhone: lead.contactPhone ?? null,
    industry: lead.industry,
    companySize: lead.companySize ?? null,
    interest: lead.interest ?? null,
    source: lead.source,
    status: lead.status,
    demoStatus: lead.demoStatus,
    demoWorkspaceId: lead.demoWorkspaceId ? lead.demoWorkspaceId.toString() : null,
    workspaceId: lead.workspaceId ? lead.workspaceId.toString() : null,
    assignedTo: lead.assignedTo ? lead.assignedTo.toString() : null,
    estimatedValueMonthly: lead.estimatedValueMonthly ?? null,
    tags: lead.tags,
    notesCount: lead.notes.length,
    capturedAt: lead.capturedAt,
    lastContactedAt: lead.lastContactedAt ?? null,
    updatedAt: lead.updatedAt,
    score: scoreLead(lead),
    nextAction: nextActionFor(lead),
    followUpStatus: followUpStatusFor(lead),
  };
}

function toLeadDetail(lead: ILead): LeadDetail {
  return {
    ...toLeadRow(lead),
    message: lead.message ?? null,
    lostReason: lead.lostReason ?? null,
    notes: lead.notes.map((note) => ({
      authorUserId: note.authorUserId ? note.authorUserId.toString() : null,
      note: note.note,
      createdAt: note.createdAt,
    })),
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class LeadService {
  /** Capture an inbound lead (public demo / contact forms). */
  async capture(input: CaptureLeadInput): Promise<{ lead: LeadDetail; duplicateOf: string | null }> {
    const contactEmail = input.contactEmail.trim().toLowerCase();
    const existing = await LeadModel.findOne({ contactEmail }).sort({ createdAt: -1 });

    const lead = existing ?? new LeadModel({
      company: input.company.trim(),
      contactName: input.contactName.trim(),
      contactEmail,
      source: input.source ?? 'WEBSITE',
      status: 'NEW',
      demoStatus: 'NONE',
      capturedAt: new Date(),
    });

    lead.company = input.company.trim();
    lead.contactName = input.contactName.trim();
    if (input.contactPhone !== undefined) lead.contactPhone = input.contactPhone.trim();
    if (input.industry !== undefined) lead.industry = input.industry.trim();
    if (input.companySize !== undefined) lead.companySize = input.companySize;
    if (input.interest !== undefined) lead.interest = input.interest;
    if (input.message !== undefined) lead.message = input.message.trim();
    if (input.utm !== undefined) lead.utm = input.utm;
    if (!existing) lead.source = input.source ?? 'WEBSITE';

    await lead.save();

    await createAuditLog({
      action: 'LEAD_CAPTURED',
      resource: 'lead',
      resourceId: lead._id.toString(),
      metadata: {
        source: lead.source,
        industry: lead.industry,
        companySize: lead.companySize ?? null,
        interest: lead.interest ?? null,
        repeat: existing !== null,
      },
      ...(input.ipAddress !== undefined ? { ipAddress: input.ipAddress } : {}),
      ...(input.userAgent !== undefined ? { userAgent: input.userAgent } : {}),
    });

    return { lead: toLeadDetail(lead), duplicateOf: existing ? existing._id.toString() : null };
  }

  /** Shared filter translation for the sales board and the CRM export. */
  private buildQuery(filters: LeadListFilters): Record<string, unknown> {
    const query: Record<string, unknown> = {};
    if (filters.status) query.status = filters.status;
    if (filters.demoStatus) query.demoStatus = filters.demoStatus;
    if (filters.source) query.source = filters.source;
    if (filters.search) {
      const pattern = new RegExp(escapeRegExp(filters.search.trim()), 'i');
      query.$or = [{ company: pattern }, { contactName: pattern }, { contactEmail: pattern }];
    }
    return query;
  }

  /** Full pipeline fetch for the CRM export - not capped by board pagination. */
  async exportRows(filters: LeadListFilters = {}, limit = 1000): Promise<LeadRow[]> {
    const capped = Number.isFinite(limit) && limit > 0 ? Math.min(5000, Math.floor(limit)) : 1000;
    const documents = await LeadModel.find(this.buildQuery(filters)).sort({ createdAt: -1 }).limit(capped);
    return documents.map(toLeadRow);
  }

  /** Sales list with filters plus the pipeline roll-up the board renders. */
  async list(filters: LeadListFilters = {}): Promise<LeadListResult> {
    const limit = Number.isFinite(filters.limit) && filters.limit && filters.limit > 0
      ? Math.min(200, Math.floor(filters.limit))
      : 50;
    const offset = Number.isFinite(filters.offset) && filters.offset && filters.offset >= 0
      ? Math.floor(filters.offset)
      : 0;

    const query = this.buildQuery(filters);

    const [documents, total, pipeline] = await Promise.all([
      LeadModel.find(query).sort({ createdAt: -1 }).skip(offset).limit(limit),
      LeadModel.countDocuments(query),
      this.pipeline(),
    ]);

    return { leads: documents.map(toLeadRow), total, limit, offset, pipeline };
  }

  async get(leadId: string): Promise<LeadDetail> {
    if (!Types.ObjectId.isValid(leadId)) throw new Error('INVALID_LEAD_ID');
    const lead = await LeadModel.findById(leadId);
    if (!lead) throw new Error('LEAD_NOT_FOUND');
    return toLeadDetail(lead);
  }

  /** Update qualification fields, status, assignment or append a note. */
  async update(
    leadId: string,
    input: UpdateLeadInput,
    actorUserId: string,
    context: { ipAddress?: string | undefined; userAgent?: string | undefined } = {},
  ): Promise<LeadDetail> {
    if (!Types.ObjectId.isValid(leadId)) throw new Error('INVALID_LEAD_ID');
    const lead = await LeadModel.findById(leadId);
    if (!lead) throw new Error('LEAD_NOT_FOUND');

    const changes: string[] = [];
    if (input.status !== undefined && input.status !== lead.status) {
      lead.status = input.status;
      changes.push('status');
    }
    if (input.demoStatus !== undefined && input.demoStatus !== lead.demoStatus) {
      lead.demoStatus = input.demoStatus;
      changes.push('demoStatus');
    }
    if (input.assignedTo !== undefined) {
      lead.assignedTo = input.assignedTo === null ? null : new Types.ObjectId(input.assignedTo);
      changes.push('assignedTo');
    }
    if (input.industry !== undefined) {
      lead.industry = input.industry.trim();
      changes.push('industry');
    }
    if (input.companySize !== undefined) {
      lead.companySize = input.companySize;
      changes.push('companySize');
    }
    if (input.interest !== undefined) {
      lead.interest = input.interest;
      changes.push('interest');
    }
    if (input.estimatedValueMonthly !== undefined) {
      lead.estimatedValueMonthly = input.estimatedValueMonthly;
      changes.push('estimatedValueMonthly');
    }
    if (input.lostReason !== undefined) {
      lead.lostReason = input.lostReason;
      changes.push('lostReason');
    }
    if (input.tags !== undefined) {
      lead.tags = input.tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0).slice(0, 20);
      changes.push('tags');
    }
    if (input.demoWorkspaceId !== undefined) {
      lead.demoWorkspaceId = input.demoWorkspaceId === null ? null : new Types.ObjectId(input.demoWorkspaceId);
      changes.push('demoWorkspaceId');
    }
    if (input.workspaceId !== undefined) {
      lead.workspaceId = input.workspaceId === null ? null : new Types.ObjectId(input.workspaceId);
      changes.push('workspaceId');
    }
    if (input.markContacted) {
      lead.lastContactedAt = new Date();
      changes.push('lastContactedAt');
    }
    if (input.note !== undefined && input.note.trim().length > 0) {
      lead.notes.push({
        authorUserId: new Types.ObjectId(actorUserId),
        note: input.note.trim(),
        createdAt: new Date(),
      });
      changes.push('note');
    }

    await lead.save();

    await createAuditLog({
      action: 'LEAD_UPDATED',
      userId: actorUserId,
      resource: 'lead',
      resourceId: lead._id.toString(),
      metadata: { changes, status: lead.status, demoStatus: lead.demoStatus },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return toLeadDetail(lead);
  }

  /** Link a provisioned demo sandbox (or a converted customer) to the lead. */
  async attachDemo(
    leadId: string,
    link: {
      demoWorkspaceId: string;
      demoExpiresAt?: Date | null;
      workspaceId?: string | null;
      demoStatus?: LeadDemoStatus | undefined;
    },
    actorUserId?: string,
  ): Promise<LeadDetail> {
    if (!Types.ObjectId.isValid(leadId)) throw new Error('INVALID_LEAD_ID');
    const lead = await LeadModel.findById(leadId);
    if (!lead) throw new Error('LEAD_NOT_FOUND');

    lead.demoWorkspaceId = new Types.ObjectId(link.demoWorkspaceId);
    lead.demoExpiresAt = link.demoExpiresAt ?? null;
    lead.demoStatus = link.demoStatus ?? 'CREATED';
    if (link.workspaceId) lead.workspaceId = new Types.ObjectId(link.workspaceId);
    if (lead.status === 'NEW' || lead.status === 'CONTACTED') lead.status = 'DEMO_SCHEDULED';
    await lead.save();

    await createAuditLog({
      action: 'LEAD_DEMO_LINKED',
      ...(actorUserId ? { userId: actorUserId } : {}),
      resource: 'lead',
      resourceId: lead._id.toString(),
      metadata: {
        demoWorkspaceId: link.demoWorkspaceId,
        demoStatus: lead.demoStatus,
        status: lead.status,
      },
    });

    return toLeadDetail(lead);
  }

  /** Pipeline roll-up for the sales board. */
  async pipeline(): Promise<PipelineSummary> {
    const grouped = await LeadModel.aggregate<{ _id: LeadStatus; count: number; value: number }>([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          value: { $sum: { $ifNull: ['$estimatedValueMonthly', 0] } },
        },
      },
    ]);
    const byStatus = new Map(grouped.map((entry) => [entry._id, entry]));

    const stages: PipelineStage[] = PIPELINE_STATUS_ORDER.map((status) => ({
      status,
      count: byStatus.get(status)?.count ?? 0,
      estimatedValueMonthly: byStatus.get(status)?.value ?? 0,
    }));

    const demoGrouped = await LeadModel.aggregate<{ _id: LeadDemoStatus; count: number }>([
      { $group: { _id: '$demoStatus', count: { $sum: 1 } } },
    ]);
    const demoByStatus = new Map(demoGrouped.map((entry) => [entry._id, entry.count]));

    return {
      stages,
      totals: {
        leads: stages.reduce((sum, stage) => sum + stage.count, 0),
        open: stages
          .filter((stage) => OPEN_LEAD_STATUSES.includes(stage.status))
          .reduce((sum, stage) => sum + stage.count, 0),
        won: byStatus.get('WON')?.count ?? 0,
        lost: byStatus.get('LOST')?.count ?? 0,
        pipelineValueMonthly: stages
          .filter((stage) => OPEN_LEAD_STATUSES.includes(stage.status))
          .reduce((sum, stage) => sum + stage.estimatedValueMonthly, 0),
      },
      demoFunnel: {
        requested: demoByStatus.get('REQUESTED') ?? 0,
        created: demoByStatus.get('CREATED') ?? 0,
        completed: demoByStatus.get('COMPLETED') ?? 0,
      },
    };
  }
}

export const leadService = new LeadService();

