import { Types } from 'mongoose';
import { EnterpriseAccountModel } from '../models/EnterpriseAccountModel.js';
import type { ContractType, EnterpriseCustomerStatus } from '../models/EnterpriseAccountModel.js';
import { WorkspaceModel } from '../models/WorkspaceModel.js';
import { SubscriptionModel } from '../models/SubscriptionModel.js';
import { createAuditLog } from './auditService.js';

/**
 * Phase 18.1 - Enterprise account management.
 *
 * The commercial register over the delivered workspace and subscription
 * records: one account per workspace, an owner, a contract, a renewal date and
 * an explicit customer status. Nothing here duplicates billing state - the
 * subscription stays authoritative and is joined in for the reader.
 */

export interface EnterpriseAccountView {
  accountId: string;
  workspaceId: string;
  workspaceName: string | null;
  company: string;
  industry: string;
  accountOwnerId: string;
  contractType: ContractType;
  subscriptionPlan: string | null;
  subscriptionStatus: string | null;
  renewalDate: string | null;
  renewalDueInDays: number | null;
  customerStatus: EnterpriseCustomerStatus;
  mrr: number | null;
  seats: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAccountInput {
  workspaceId: string;
  company: string;
  industry?: string | undefined;
  accountOwnerId: string;
  contractType?: ContractType | undefined;
  subscriptionPlan?: string | null | undefined;
  renewalDate?: string | null | undefined;
  customerStatus?: EnterpriseCustomerStatus | undefined;
  mrr?: number | null | undefined;
  seats?: number | null | undefined;
  notes?: string | null | undefined;
}

export interface UpdateAccountInput {
  customerStatus?: EnterpriseCustomerStatus | undefined;
  contractType?: ContractType | undefined;
  subscriptionPlan?: string | null | undefined;
  renewalDate?: string | null | undefined;
  accountOwnerId?: string | undefined;
  industry?: string | undefined;
  mrr?: number | null | undefined;
  seats?: number | null | undefined;
  notes?: string | null | undefined;
}
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function daysUntil(date: Date | null, now: Date): number | null {
  if (!date) return null;
  return Math.ceil((date.getTime() - now.getTime()) / DAY_MS);
}

interface AccountRow {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  company: string;
  industry: string;
  accountOwnerId: Types.ObjectId;
  contractType: ContractType;
  subscriptionPlan: string | null;
  renewalDate: Date | null;
  customerStatus: EnterpriseCustomerStatus;
  mrr: number | null;
  seats: number | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class AccountManagementService {
  /** One page of the register plus the book summary - zeros when nothing matches. */
  async listAccounts(filters: {
    customerStatus?: EnterpriseCustomerStatus | undefined;
    industry?: string | undefined;
    accountOwnerId?: string | undefined;
    q?: string | undefined;
    renewalWithinDays?: number | undefined;
    page?: number | undefined;
    limit?: number | undefined;
    now?: Date | undefined;
  } = {}) {
    const now = filters.now ?? new Date();
    const page = Number.isFinite(filters.page) && filters.page && filters.page > 0 ? Math.floor(filters.page) : 1;
    const requested = Number.isFinite(filters.limit) && filters.limit && filters.limit > 0 ? Math.floor(filters.limit) : DEFAULT_PAGE_SIZE;
    const limit = Math.min(MAX_PAGE_SIZE, requested);

    const query: Record<string, unknown> = {};
    if (filters.customerStatus) query.customerStatus = filters.customerStatus;
    if (filters.industry) query.industry = filters.industry;
    if (filters.accountOwnerId && Types.ObjectId.isValid(filters.accountOwnerId)) {
      query.accountOwnerId = new Types.ObjectId(filters.accountOwnerId);
    }
    if (filters.q) query.company = { $regex: escapeRegex(filters.q.trim()), $options: 'i' };
    const within = Number.isFinite(filters.renewalWithinDays) && filters.renewalWithinDays && filters.renewalWithinDays > 0
      ? Math.floor(filters.renewalWithinDays)
      : null;
    if (within !== null) {
      query.renewalDate = { $gte: now, $lte: new Date(now.getTime() + within * DAY_MS) };
    }
    const [total, rows] = await Promise.all([
      EnterpriseAccountModel.countDocuments(query),
      EnterpriseAccountModel.find(query)
        .sort({ renewalDate: 1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);
    const [byStatusRows, renewingSoon] = await Promise.all([
      EnterpriseAccountModel.aggregate<{ _id: string; count: number; mrr: number }>([
        { $match: query },
        { $group: { _id: '$customerStatus', count: { $sum: 1 }, mrr: { $sum: { $ifNull: ['$mrr', 0] } } } },
      ]),
      EnterpriseAccountModel.countDocuments({
        ...query,
        renewalDate: { $gte: now, $lte: new Date(now.getTime() + 30 * DAY_MS) },
      }),
    ]);

    const byStatus: Record<EnterpriseCustomerStatus, number> = {
      TRIAL: 0,
      ACTIVE: 0,
      AT_RISK: 0,
      SUSPENDED: 0,
      CHURNED: 0,
    };
    let mrrTotal = 0;
    for (const bucket of byStatusRows) {
      if (bucket._id in byStatus) byStatus[bucket._id as EnterpriseCustomerStatus] = bucket.count;
      mrrTotal += bucket.mrr;
    }

    return {
      items: await this.viewsFor(rows, now),
      summary: { total, byStatus, renewingSoon, mrrTotal },
      page,
      limit,
      generatedAt: new Date().toISOString(),
    };
  }
  private toView(
    row: AccountRow,
    workspaceName: string | null,
    subscription: { plan: string; status: string } | null,
    now: Date,
  ): EnterpriseAccountView {
    return {
      accountId: row._id.toString(),
      workspaceId: row.workspaceId.toString(),
      workspaceName,
      company: row.company,
      industry: row.industry,
      accountOwnerId: row.accountOwnerId.toString(),
      contractType: row.contractType,
      subscriptionPlan: row.subscriptionPlan ?? (subscription ? subscription.plan : null),
      subscriptionStatus: subscription ? subscription.status : null,
      renewalDate: row.renewalDate ? row.renewalDate.toISOString() : null,
      renewalDueInDays: daysUntil(row.renewalDate, now),
      customerStatus: row.customerStatus,
      mrr: row.mrr,
      seats: row.seats,
      notes: row.notes,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
    };
  }

  private async viewsFor(rows: AccountRow[], now: Date): Promise<EnterpriseAccountView[]> {
    if (rows.length === 0) return [];
    const workspaceIds = rows.map((row) => row.workspaceId);
    const [workspaces, subscriptions] = await Promise.all([
      WorkspaceModel.find({ _id: { $in: workspaceIds } }).select('name').lean(),
      SubscriptionModel.find({ workspaceId: { $in: workspaceIds } }).select('workspaceId plan status').lean(),
    ]);
    const names = new Map(workspaces.map((row) => [row._id.toString(), row.name as string]));
    const subs = new Map(subscriptions.map((row) => [row.workspaceId.toString(), { plan: row.plan as string, status: row.status as string }]));
    return rows.map((row) => this.toView(
      row,
      names.get(row.workspaceId.toString()) ?? null,
      subs.get(row.workspaceId.toString()) ?? null,
      now,
    ));
  }

  private async viewFor(row: AccountRow, now: Date = new Date()): Promise<EnterpriseAccountView> {
    const views = await this.viewsFor([row], now);
    return views[0] as EnterpriseAccountView;
  }
  /** One account per workspace; the workspace and owner must exist. */
  async createAccount(input: CreateAccountInput, actorUserId: string): Promise<EnterpriseAccountView> {
    if (!Types.ObjectId.isValid(input.workspaceId)) throw new Error('WORKSPACE_NOT_FOUND');
    if (!Types.ObjectId.isValid(input.accountOwnerId)) throw new Error('INVALID_ACCOUNT');
    const workspace = await WorkspaceModel.findById(input.workspaceId).lean();
    if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');
    const existing = await EnterpriseAccountModel.findOne({ workspaceId: workspace._id }).lean();
    if (existing) throw new Error('ACCOUNT_ALREADY_EXISTS');

    const subscription = await SubscriptionModel.findOne({ workspaceId: workspace._id }).lean();
    const account = await EnterpriseAccountModel.create({
      workspaceId: workspace._id,
      company: input.company.trim(),
      industry: (input.industry ?? 'UNKNOWN').trim() || 'UNKNOWN',
      accountOwnerId: new Types.ObjectId(input.accountOwnerId),
      contractType: input.contractType ?? 'ANNUAL',
      subscriptionPlan: input.subscriptionPlan ?? (subscription ? subscription.plan : null),
      renewalDate: input.renewalDate
        ? new Date(input.renewalDate)
        : subscription
          ? subscription.currentPeriodEnd
          : null,
      customerStatus: input.customerStatus ?? 'TRIAL',
      mrr: input.mrr ?? null,
      seats: input.seats ?? null,
      notes: input.notes ?? null,
      createdBy: new Types.ObjectId(actorUserId),
    });

    await createAuditLog({
      action: 'ENTERPRISE_ACCOUNT_CREATED',
      userId: actorUserId,
      workspaceId: workspace._id,
      resource: 'enterprise_account',
      resourceId: account._id.toString(),
      metadata: {
        company: account.company,
        customerStatus: account.customerStatus,
        contractType: account.contractType,
        subscriptionPlan: account.subscriptionPlan,
        renewalDate: account.renewalDate ? account.renewalDate.toISOString() : null,
      },
    });

    return this.viewFor(account.toObject() as AccountRow);
  }
  private async loadAccount(idOrWorkspaceId: string): Promise<AccountRow> {
    if (!Types.ObjectId.isValid(idOrWorkspaceId)) throw new Error('ACCOUNT_NOT_FOUND');
    const objectId = new Types.ObjectId(idOrWorkspaceId);
    const row = await EnterpriseAccountModel.findOne({ $or: [{ _id: objectId }, { workspaceId: objectId }] }).lean();
    if (!row) throw new Error('ACCOUNT_NOT_FOUND');
    return row as AccountRow;
  }

  async getAccount(idOrWorkspaceId: string, now: Date = new Date()): Promise<EnterpriseAccountView> {
    const row = await this.loadAccount(idOrWorkspaceId);
    return this.viewFor(row, now);
  }

  /** Account view without throwing - the intelligence service joins it when one exists. */
  async findAccountForWorkspace(workspaceId: string, now: Date = new Date()): Promise<EnterpriseAccountView | null> {
    if (!Types.ObjectId.isValid(workspaceId)) return null;
    const row = await EnterpriseAccountModel.findOne({ workspaceId: new Types.ObjectId(workspaceId) }).lean();
    if (!row) return null;
    return this.viewFor(row as AccountRow, now);
  }
  /** Every change is audited with the fields it touched and the status it left. */
  async updateAccount(
    idOrWorkspaceId: string,
    patch: UpdateAccountInput,
    actorUserId: string,
  ): Promise<EnterpriseAccountView> {
    if (!Types.ObjectId.isValid(idOrWorkspaceId)) throw new Error('ACCOUNT_NOT_FOUND');
    const objectId = new Types.ObjectId(idOrWorkspaceId);
    const row = await EnterpriseAccountModel.findOne({ $or: [{ _id: objectId }, { workspaceId: objectId }] });
    if (!row) throw new Error('ACCOUNT_NOT_FOUND');
    if (patch.accountOwnerId !== undefined && !Types.ObjectId.isValid(patch.accountOwnerId)) {
      throw new Error('INVALID_ACCOUNT');
    }

    const previousStatus = row.customerStatus;
    const changed: string[] = [];
    if (patch.customerStatus !== undefined && patch.customerStatus !== row.customerStatus) {
      row.customerStatus = patch.customerStatus;
      changed.push('customerStatus');
    }
    if (patch.contractType !== undefined && patch.contractType !== row.contractType) {
      row.contractType = patch.contractType;
      changed.push('contractType');
    }
    if (patch.subscriptionPlan !== undefined && patch.subscriptionPlan !== row.subscriptionPlan) {
      row.subscriptionPlan = patch.subscriptionPlan;
      changed.push('subscriptionPlan');
    }
    if (patch.renewalDate !== undefined) {
      const next = patch.renewalDate ? new Date(patch.renewalDate) : null;
      if ((next ? next.toISOString() : null) !== (row.renewalDate ? row.renewalDate.toISOString() : null)) {
        row.renewalDate = next;
        changed.push('renewalDate');
      }
    }
    if (patch.accountOwnerId !== undefined) {
      row.accountOwnerId = new Types.ObjectId(patch.accountOwnerId);
      changed.push('accountOwnerId');
    }
    if (patch.industry !== undefined && patch.industry !== row.industry) {
      row.industry = patch.industry;
      changed.push('industry');
    }
    if (patch.mrr !== undefined && patch.mrr !== row.mrr) {
      row.mrr = patch.mrr;
      changed.push('mrr');
    }
    if (patch.seats !== undefined && patch.seats !== row.seats) {
      row.seats = patch.seats;
      changed.push('seats');
    }
    if (patch.notes !== undefined && patch.notes !== row.notes) {
      row.notes = patch.notes;
      changed.push('notes');
    }
    if (changed.length === 0) return this.viewFor(row.toObject() as AccountRow);
    await row.save();
    await createAuditLog({
      action: 'ENTERPRISE_ACCOUNT_UPDATED',
      userId: actorUserId,
      workspaceId: row.workspaceId,
      resource: 'enterprise_account',
      resourceId: row._id.toString(),
      metadata: { changed, previousStatus, customerStatus: row.customerStatus },
    });

    return this.viewFor(row.toObject() as AccountRow);
  }
}

export const accountManagementService = new AccountManagementService();