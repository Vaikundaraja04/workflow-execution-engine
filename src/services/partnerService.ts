import { Types } from 'mongoose';
import { PartnerModel } from '../models/PartnerModel.js';
import type { IPartner, PartnerStatus, PartnerTier } from '../models/PartnerModel.js';
import { LeadModel } from '../models/LeadModel.js';
import { PaymentRecordModel } from '../models/PaymentRecordModel.js';
import { createAuditLog } from './auditService.js';
import { PartnerMarketplaceModel } from '../models/PartnerMarketplaceModel.js';
import type { PartnerListingStatus, PartnerListingType } from '../models/PartnerMarketplaceModel.js';
import { WorkflowTemplateModel } from '../models/WorkflowTemplateModel.js';

/**
 * Phase 16.6 - Partner channel service.
 *
 * Partners, their referrals and the commission they earn. Revenue is computed
 * from the payments the referred workspaces actually made - never projected -
 * and a partner record never grants access to customer data.
 */

const DEFAULT_COMMISSION_RATE = 20;
const MAX_PARTNERS = 200;

export interface PartnerView {
  partnerId: string;
  name: string;
  company: string;
  contactName: string;
  contactEmail: string;
  code: string;
  status: PartnerStatus;
  tier: PartnerTier;
  commissionRatePercent: number;
  referrals: {
    leads: number;
    customers: number;
    churned: number;
  };
  createdAt: string;
}

export interface PartnerRevenueRow {
  partnerId: string;
  code: string;
  name: string;
  tier: PartnerTier;
  commissionRatePercent: number;
  referredLeads: number;
  referredCustomers: number;
  payingCustomers: number;
  grossPaidByCurrency: Record<string, number>;
  commissionByCurrency: Record<string, number>;
}

export interface PartnerRevenueReport {
  partners: PartnerRevenueRow[];
  totals: {
    partners: number;
    referredCustomers: number;
    payingCustomers: number;
    grossPaidByCurrency: Record<string, number>;
    commissionByCurrency: Record<string, number>;
  };
  generatedAt: string;
}

export interface PartnerSolutionView {
  solutionId: string;
  partnerId: string;
  partnerName: string;
  workspaceId: string | null;
  listingType: PartnerListingType;
  title: string;
  description: string;
  templateId: string | null;
  solutionReference: string | null;
  industryTags: string[];
  commissionRatePercent: number;
  status: PartnerListingStatus;
  statistics: { referrals: number; customers: number; commissionEarned: number };
  createdAt: string;
  updatedAt: string;
}

export interface PartnerSolutionInput {
  listingType?: PartnerListingType | undefined;
  title: string;
  description: string;
  templateId?: string | null | undefined;
  solutionId?: string | null | undefined;
  industryTags?: string[] | undefined;
  commissionRatePercent?: number | undefined;
  status?: PartnerListingStatus | undefined;
}

function slugCode(value: string): string {
  const base = value.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20);
  return `${base || 'PARTNER'}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function addCurrency(bucket: Record<string, number>, currency: string, amount: number): void {
  bucket[currency] = (bucket[currency] ?? 0) + amount;
}

export class PartnerService {
  /** Register a partner company with a referral code and commission rate. */
  async createPartner(
    input: {
      name: string;
      company: string;
      contactName: string;
      contactEmail: string;
      code?: string | undefined;
      tier?: PartnerTier | undefined;
      commissionRatePercent?: number | undefined;
      notes?: string | undefined;
    },
    actorUserId?: string | undefined,
  ): Promise<PartnerView> {
    const code = (input.code ?? slugCode(input.company)).toUpperCase();
    const existing = await PartnerModel.findOne({ code }).lean();
    if (existing) throw new Error('PARTNER_CODE_TAKEN');

    const partner = await PartnerModel.create({
      name: input.name.trim(),
      company: input.company.trim(),
      contactName: input.contactName.trim(),
      contactEmail: input.contactEmail.trim().toLowerCase(),
      code,
      status: 'ACTIVE',
      tier: input.tier ?? 'BRONZE',
      commissionRatePercent: input.commissionRatePercent ?? DEFAULT_COMMISSION_RATE,
      notes: input.notes ?? null,
      createdBy: actorUserId && Types.ObjectId.isValid(actorUserId) ? new Types.ObjectId(actorUserId) : null,
      referrals: [],
    });

    await createAuditLog({
      action: 'PARTNER_CREATED',
      ...(actorUserId !== undefined ? { userId: actorUserId } : {}),
      resource: 'partner',
      resourceId: partner._id.toString(),
      metadata: { code, tier: partner.tier, commissionRatePercent: partner.commissionRatePercent },
    });

    return this.viewFor(partner);
  }

  async getPartner(partnerId: string): Promise<PartnerView> {
    if (!Types.ObjectId.isValid(partnerId)) throw new Error('INVALID_PARTNER_ID');
    const partner = await PartnerModel.findById(partnerId);
    if (!partner) throw new Error('PARTNER_NOT_FOUND');
    return this.viewFor(partner);
  }

  async listPartners(options: { status?: PartnerStatus | undefined; limit?: number | undefined } = {}): Promise<PartnerView[]> {
    const limit = Number.isFinite(options.limit) && options.limit && options.limit > 0
      ? Math.min(MAX_PARTNERS, Math.floor(options.limit))
      : 50;
    const query: Record<string, unknown> = {};
    if (options.status) query.status = options.status;
    const partners = await PartnerModel.find(query).sort({ createdAt: -1 }).limit(limit);
    return partners.map((partner) => this.viewFor(partner));
  }

  /** Attach a lead and/or workspace to a partner by referral code. */
  async registerReferral(input: {
    code: string;
    leadId?: string | null | undefined;
    workspaceId?: string | null | undefined;
  }, actorUserId?: string | undefined): Promise<PartnerView> {
    const code = input.code.trim().toUpperCase();
    const partner = await PartnerModel.findOne({ code });
    if (!partner) throw new Error('PARTNER_NOT_FOUND');
    if (!input.leadId && !input.workspaceId) throw new Error('INVALID_REFERRAL');
    if (input.leadId && !Types.ObjectId.isValid(input.leadId)) throw new Error('INVALID_LEAD_ID');
    if (input.workspaceId && !Types.ObjectId.isValid(input.workspaceId)) throw new Error('INVALID_WORKSPACE_ID');

    const leadId = input.leadId ? new Types.ObjectId(input.leadId) : null;
    const workspaceId = input.workspaceId ? new Types.ObjectId(input.workspaceId) : null;
    const duplicate = partner.referrals.some((referral) =>
      (leadId && referral.leadId?.equals(leadId)) || (workspaceId && referral.workspaceId?.equals(workspaceId)));
    if (duplicate) return this.viewFor(partner);

    partner.referrals.push({
      leadId,
      workspaceId,
      referredAt: new Date(),
      status: workspaceId ? 'REGISTERED' : 'REFERRED',
    });
    await partner.save();

    await createAuditLog({
      action: 'PARTNER_REFERRAL_REGISTERED',
      ...(actorUserId !== undefined ? { userId: actorUserId } : {}),
      ...(workspaceId ? { workspaceId } : {}),
      resource: 'partner',
      resourceId: partner._id.toString(),
      metadata: { code, leadId: leadId?.toString() ?? null, workspaceId: workspaceId?.toString() ?? null },
    });

    return this.viewFor(partner);
  }

  /**
   * Link a newly converted workspace to the partner that referred its lead.
   * Never throws: attribution must not break a checkout.
   */
  async syncWorkspaceReferral(workspaceId: string, contactEmail: string | null | undefined): Promise<{ linked: boolean }> {
    try {
      if (!contactEmail || !Types.ObjectId.isValid(workspaceId)) return { linked: false };
      const lead = await LeadModel.findOne({ contactEmail: contactEmail.trim().toLowerCase() })
        .sort({ createdAt: -1 })
        .select('_id')
        .lean();
      if (!lead) return { linked: false };

      const partner = await PartnerModel.findOne({ 'referrals.leadId': lead._id });
      if (!partner) return { linked: false };
      const referral = partner.referrals.find((entry) => entry.leadId?.equals(lead._id));
      if (!referral) return { linked: false };
      if (referral.workspaceId?.toString() === workspaceId) return { linked: false };

      referral.workspaceId = new Types.ObjectId(workspaceId);
      referral.status = 'CUSTOMER';
      await partner.save();
      return { linked: true };
    } catch {
      return { linked: false };
    }
  }

  /** Partner revenue and commission, computed from payments actually collected. */
  async revenueReport(options: { limit?: number | undefined } = {}): Promise<PartnerRevenueReport> {
    const limit = Number.isFinite(options.limit) && options.limit && options.limit > 0
      ? Math.min(MAX_PARTNERS, Math.floor(options.limit))
      : MAX_PARTNERS;
    const partners = await PartnerModel.find().sort({ createdAt: 1 }).limit(limit).lean();

    const workspaceIds = partners
      .flatMap((partner) => partner.referrals)
      .map((referral) => referral.workspaceId)
      .filter((id): id is Types.ObjectId => id instanceof Types.ObjectId);

    const paymentRows = workspaceIds.length === 0
      ? []
      : await PaymentRecordModel.aggregate<{
        _id: { workspaceId: Types.ObjectId; currency: string };
        paid: number;
      }>([
        { $match: { workspaceId: { $in: workspaceIds }, paid: true } },
        {
          $group: {
            _id: { workspaceId: '$workspaceId', currency: '$currency' },
            paid: { $sum: '$amountReceived' },
          },
        },
      ]);
    const paidByWorkspace = new Map<string, Record<string, number>>();
    for (const row of paymentRows) {
      const key = row._id.workspaceId.toString();
      const bucket = paidByWorkspace.get(key) ?? {};
      addCurrency(bucket, (row._id.currency ?? 'usd').toUpperCase(), row.paid);
      paidByWorkspace.set(key, bucket);
    }

    const rows: PartnerRevenueRow[] = partners.map((partner) => {
      const referredWorkspaces = partner.referrals
        .map((referral) => referral.workspaceId)
        .filter((id): id is Types.ObjectId => id instanceof Types.ObjectId);
      const grossPaidByCurrency: Record<string, number> = {};
      let payingCustomers = 0;
      for (const workspaceId of referredWorkspaces) {
        const bucket = paidByWorkspace.get(workspaceId.toString());
        if (!bucket) continue;
        payingCustomers += 1;
        for (const [currency, amount] of Object.entries(bucket)) {
          addCurrency(grossPaidByCurrency, currency, amount);
        }
      }
      const commissionByCurrency: Record<string, number> = {};
      for (const [currency, amount] of Object.entries(grossPaidByCurrency)) {
        commissionByCurrency[currency] = Math.round((amount * partner.commissionRatePercent) / 100);
      }

      return {
        partnerId: partner._id.toString(),
        code: partner.code,
        name: partner.name,
        tier: partner.tier,
        commissionRatePercent: partner.commissionRatePercent,
        referredLeads: partner.referrals.filter((referral) => referral.leadId).length,
        referredCustomers: partner.referrals.length,
        payingCustomers,
        grossPaidByCurrency,
        commissionByCurrency,
      };
    });

    const totals: PartnerRevenueReport['totals'] = {
      partners: rows.length,
      referredCustomers: rows.reduce((sum, row) => sum + row.referredCustomers, 0),
      payingCustomers: rows.reduce((sum, row) => sum + row.payingCustomers, 0),
      grossPaidByCurrency: {},
      commissionByCurrency: {},
    };
    for (const row of rows) {
      for (const [currency, amount] of Object.entries(row.grossPaidByCurrency)) {
        addCurrency(totals.grossPaidByCurrency, currency, amount);
      }
      for (const [currency, amount] of Object.entries(row.commissionByCurrency)) {
        addCurrency(totals.commissionByCurrency, currency, amount);
      }
    }

    return { partners: rows, totals, generatedAt: new Date().toISOString() };
  }

  private solutionViewFor(
    solution: {
      _id: Types.ObjectId;
      partnerId: Types.ObjectId;
      workspaceId: Types.ObjectId | null;
      listingType: PartnerListingType;
      title: string;
      description: string;
      templateId: Types.ObjectId | null;
      solutionId: string | null;
      industryTags: string[];
      commissionRatePercent: number;
      status: PartnerListingStatus;
      statistics: { referrals: number; customers: number; commissionEarned: number };
      createdAt: Date;
      updatedAt: Date;
    },
    partnerName: string,
  ): PartnerSolutionView {
    return {
      solutionId: solution._id.toString(),
      partnerId: solution.partnerId.toString(),
      partnerName,
      workspaceId: solution.workspaceId ? solution.workspaceId.toString() : null,
      listingType: solution.listingType,
      title: solution.title,
      description: solution.description,
      templateId: solution.templateId ? solution.templateId.toString() : null,
      solutionReference: solution.solutionId,
      industryTags: solution.industryTags,
      commissionRatePercent: solution.commissionRatePercent,
      status: solution.status,
      statistics: solution.statistics,
      createdAt: new Date(solution.createdAt).toISOString(),
      updatedAt: new Date(solution.updatedAt).toISOString(),
    };
  }
  /** Platform admins publish what a partner offers the ecosystem. */
  async createSolution(partnerId: string, input: PartnerSolutionInput, actorUserId?: string | undefined): Promise<PartnerSolutionView> {
    if (!Types.ObjectId.isValid(partnerId)) throw new Error('INVALID_PARTNER_ID');
    const partner = await PartnerModel.findById(partnerId);
    if (!partner) throw new Error('PARTNER_NOT_FOUND');

    let templateId: Types.ObjectId | null = null;
    if (input.templateId) {
      if (!Types.ObjectId.isValid(input.templateId)) throw new Error('WORKFLOW_TEMPLATE_NOT_FOUND');
      const template = await WorkflowTemplateModel.findById(input.templateId).select('_id').lean();
      if (!template) throw new Error('WORKFLOW_TEMPLATE_NOT_FOUND');
      templateId = template._id;
    }

    const solution = await PartnerMarketplaceModel.create({
      partnerId: partner._id,
      workspaceId: null,
      listingType: input.listingType ?? 'SOLUTION',
      title: input.title.trim(),
      description: input.description.trim(),
      templateId,
      solutionId: input.solutionId ?? null,
      industryTags: [...new Set((input.industryTags ?? []).map((tag) => tag.trim()).filter(Boolean))].slice(0, 12),
      commissionRatePercent: input.commissionRatePercent ?? partner.commissionRatePercent,
      status: input.status ?? 'PUBLISHED',
      statistics: { referrals: 0, customers: 0, commissionEarned: 0 },
      createdBy: actorUserId && Types.ObjectId.isValid(actorUserId) ? new Types.ObjectId(actorUserId) : new Types.ObjectId(),
    });

    await createAuditLog({
      action: 'PARTNER_SOLUTION_PUBLISHED',
      ...(actorUserId !== undefined ? { userId: actorUserId } : {}),
      resource: 'partner_solution',
      resourceId: solution._id.toString(),
      metadata: {
        partnerId: partner._id.toString(),
        listingType: solution.listingType,
        status: solution.status,
        templateId: templateId ? templateId.toString() : null,
        commissionRatePercent: solution.commissionRatePercent,
      },
    });

    return this.solutionViewFor(solution, partner.name);
  }
  /** Publish, archive or draft a solution listing (platform admins). */
  async updateSolutionStatus(
    solutionId: string,
    status: PartnerListingStatus,
    actorUserId?: string | undefined,
  ): Promise<PartnerSolutionView> {
    if (!Types.ObjectId.isValid(solutionId)) throw new Error('PARTNER_SOLUTION_NOT_FOUND');
    const solution = await PartnerMarketplaceModel.findById(solutionId);
    if (!solution) throw new Error('PARTNER_SOLUTION_NOT_FOUND');
    solution.status = status;
    await solution.save();

    const partner = await PartnerModel.findById(solution.partnerId).select('name').lean();
    await createAuditLog({
      action: 'PARTNER_SOLUTION_PUBLISHED',
      ...(actorUserId !== undefined ? { userId: actorUserId } : {}),
      resource: 'partner_solution',
      resourceId: solution._id.toString(),
      metadata: { partnerId: solution.partnerId.toString(), status },
    });

    return this.solutionViewFor(solution, partner?.name ?? 'Partner');
  }
  /** Solution discovery: published by default; status filtering is admin-only at the route. */
  async listSolutions(options: {
    status?: PartnerListingStatus | undefined;
    listingType?: PartnerListingType | undefined;
    partnerId?: string | undefined;
    limit?: number | undefined;
  } = {}): Promise<PartnerSolutionView[]> {
    const limit = Number.isFinite(options.limit) && options.limit && options.limit > 0
      ? Math.min(MAX_PARTNERS, Math.floor(options.limit))
      : MAX_PARTNERS;
    const query: Record<string, unknown> = { status: options.status ?? 'PUBLISHED' };
    if (options.listingType) query.listingType = options.listingType;
    if (options.partnerId && Types.ObjectId.isValid(options.partnerId)) {
      query.partnerId = new Types.ObjectId(options.partnerId);
    }
    const rows = await PartnerMarketplaceModel.find(query).sort({ createdAt: -1 }).limit(limit).lean();
    if (rows.length === 0) return [];
    const partnerIds = [...new Set(rows.map((row) => row.partnerId.toString()))].map((id) => new Types.ObjectId(id));
    const partners = await PartnerModel.find({ _id: { $in: partnerIds } }).select('name').lean();
    const names = new Map(partners.map((partner) => [partner._id.toString(), partner.name]));
    return rows.map((row) => this.solutionViewFor(row, names.get(row.partnerId.toString()) ?? 'Partner'));
  }
  /** Public view of a partner with referral counts. */
  private viewFor(partner: IPartner & { _id: Types.ObjectId }): PartnerView {
    return {
      partnerId: partner._id.toString(),
      name: partner.name,
      company: partner.company,
      contactName: partner.contactName,
      contactEmail: partner.contactEmail,
      code: partner.code,
      status: partner.status,
      tier: partner.tier,
      commissionRatePercent: partner.commissionRatePercent,
      referrals: {
        leads: partner.referrals.filter((referral) => referral.leadId).length,
        customers: partner.referrals.filter((referral) => referral.workspaceId).length,
        churned: partner.referrals.filter((referral) => referral.status === 'CHURNED').length,
      },
      createdAt: new Date(partner.createdAt).toISOString(),
    };
  }
}

export const partnerService = new PartnerService();
