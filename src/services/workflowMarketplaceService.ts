import { Types } from 'mongoose';
import { WorkflowTemplateMarketplaceModel } from '../models/WorkflowTemplateMarketplaceModel.js';
import type { WorkflowListingStatus, WorkflowListingType } from '../models/WorkflowTemplateMarketplaceModel.js';
import { MarketplaceLicenseModel } from '../models/MarketplaceLicenseModel.js';
import { MarketplaceReviewModel } from '../models/MarketplaceReviewModel.js';
import { WorkflowTemplateModel } from '../models/WorkflowTemplateModel.js';
import { SubscriptionModel } from '../models/SubscriptionModel.js';
import { TenantAccountModel } from '../models/TenantAccountModel.js';
import { UserModel } from '../models/UserModel.js';
import { PaymentRecordModel } from '../models/PaymentRecordModel.js';
import { DEFAULT_PUBLISHER_SHARE_PERCENT } from '../models/MarketplacePricingModel.js';
import type { MarketplaceBillingCycle, MarketplacePricingModel } from '../models/MarketplacePricingModel.js';
import { createBillingProvider, isBillingProviderName } from './billing/billingProviderRegistry.js';
import type { BillingPayment } from './billing/billingProvider.js';
import { marketplaceRevenueService } from './marketplaceRevenueService.js';
import { TemplateService } from './templateService.js';
import { createAuditLog } from './auditService.js';

/**
 * Phase 17.2 - Premium workflow marketplace.
 *
 * Commerce around existing workflow templates: publishers price a template
 * (premium workflow, industry solution or bundle), buyers purchase a license
 * through the Phase 15.3 billing providers, and installs still go through
 * TemplateService.installTemplate. The listing never duplicates a definition -
 * it records what it costs, how it sells and who earns what.
 */
export interface PublishWorkflowInput {
  templateId: string;
  workspaceId: string;
  userId: string;
  listingType?: WorkflowListingType | undefined;
  pricingModel: MarketplacePricingModel;
  price?: number | undefined;
  currency?: string | undefined;
  billingCycle?: MarketplaceBillingCycle | undefined;
  revenueSharePercentage?: number | undefined;
  bundleTemplateIds?: string[] | undefined;
  industryTags?: string[] | undefined;
  status?: WorkflowListingStatus | undefined;
}
export interface WorkflowListingView {
  listingId: string;
  templateId: string;
  name: string;
  description: string;
  category: string | null;
  tags: string[];
  listingType: WorkflowListingType;
  status: WorkflowListingStatus;
  pricingModel: MarketplacePricingModel;
  price: number;
  currency: string;
  billingCycle: MarketplaceBillingCycle;
  industryTags: string[];
  marketplaceVersion: number;
  statistics: { sales: number; installs: number; grossRevenue: number };
  rating: { average: number; count: number };
  publisherId: string;
  updatedAt: string;
}
export interface WorkflowSearchFilters {
  q?: string | undefined;
  listingType?: WorkflowListingType | undefined;
  industryTags?: string[] | undefined;
  minPrice?: number | undefined;
  maxPrice?: number | undefined;
  sortBy?: 'recent' | 'sales' | 'installs' | 'price' | undefined;
  page?: number | undefined;
  limit?: number | undefined;
}
export interface WorkflowSearchResult {
  items: WorkflowListingView[];
  page: number;
  limit: number;
  total: number;
  generatedAt: string;
}
export interface WorkflowPurchaseSession {
  listingId: string;
  templateId: string;
  templateName: string;
  pricingModel: MarketplacePricingModel;
  amount: number;
  currency: string;
  provider: string;
  paymentId: string;
  clientSecret: string;
  status: string;
}
export interface WorkflowPurchaseResult {
  settled: boolean;
  reason: 'SETTLED' | 'PAYMENT_NOT_SETTLED';
  license: { licenseId: string; status: string; activatedAt: string; expiresAt: string | null } | null;
  payment: { id: string; amount: number; currency: string; status: string; paid: boolean; method: string | null };
  transactionId: string | null;
}
export interface WorkflowInstallResult {
  listingId: string;
  templateId: string;
  workflow: unknown;
  version: unknown;
  license: { licenseId: string; status: string; activatedAt: string; expiresAt: string | null } | null;
}
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 48;
const MAX_TEMPLATE_LOOKUPS = 200;

function cycleDays(cycle: MarketplaceBillingCycle): number | null {
  if (cycle === 'MONTHLY') return 30;
  if (cycle === 'YEARLY') return 365;
  return null;
}

function clampShare(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_PUBLISHER_SHARE_PERCENT;
  return Math.max(0, Math.min(100, Math.floor(value as number)));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class WorkflowMarketplaceService {
  private async loadListing(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new Error('WORKFLOW_LISTING_NOT_FOUND');
    const objectId = new Types.ObjectId(id);
    const listing = await WorkflowTemplateMarketplaceModel.findOne({
      $or: [{ _id: objectId }, { templateId: objectId }],
    });
    if (!listing) throw new Error('WORKFLOW_LISTING_NOT_FOUND');
    return listing;
  }
  /** Publisher prices an existing workflow template and publishes the listing. */
  async publishWorkflow(input: PublishWorkflowInput) {
    if (!Types.ObjectId.isValid(input.templateId)) throw new Error('WORKFLOW_TEMPLATE_NOT_FOUND');
    const template = await WorkflowTemplateModel.findById(input.templateId);
    if (!template || !template.workspaceId || template.workspaceId.toString() !== input.workspaceId) {
      throw new Error('WORKFLOW_TEMPLATE_NOT_FOUND');
    }

    const price = input.pricingModel === 'FREE' ? 0 : Math.floor(input.price ?? 0);
    if (input.pricingModel !== 'FREE' && price <= 0) throw new Error('INVALID_PRICING');
    const billingCycle: MarketplaceBillingCycle = input.billingCycle
      ?? (input.pricingModel === 'SUBSCRIPTION' ? 'MONTHLY' : 'NONE');
    if (input.pricingModel === 'SUBSCRIPTION' && billingCycle === 'NONE') throw new Error('INVALID_PRICING');
    if (input.pricingModel === 'ENTERPRISE_LICENSE' && billingCycle === 'NONE') throw new Error('INVALID_PRICING');

    const listingType: WorkflowListingType = input.listingType ?? 'PREMIUM_WORKFLOW';
    const industryTags = [...new Set((input.industryTags ?? []).map((tag) => tag.trim()).filter(Boolean))].slice(0, 12);
    const bundleIds = [...new Set(input.bundleTemplateIds ?? [])];
    if (bundleIds.some((id) => !Types.ObjectId.isValid(id))) throw new Error('INVALID_WORKFLOW_LISTING');
    if (listingType === 'BUNDLE' && bundleIds.length === 0) throw new Error('INVALID_WORKFLOW_LISTING');
    if (listingType === 'INDUSTRY_SOLUTION' && industryTags.length === 0) throw new Error('INVALID_WORKFLOW_LISTING');
    const bundleTemplateIds = bundleIds.map((id) => new Types.ObjectId(id));
    if (bundleTemplateIds.length > 0) {
      const bundled = await WorkflowTemplateModel.find({ _id: { $in: bundleTemplateIds } }).select('workspaceId').lean();
      if (bundled.length !== bundleTemplateIds.length) throw new Error('INVALID_WORKFLOW_LISTING');
      for (const row of bundled) {
        if (!row.workspaceId || row.workspaceId.toString() !== input.workspaceId) throw new Error('INVALID_WORKFLOW_LISTING');
      }
    }

    const existing = await WorkflowTemplateMarketplaceModel.findOne({ templateId: template._id });
    const listing = await WorkflowTemplateMarketplaceModel.findOneAndUpdate(
      { templateId: template._id },
      {
        $set: {
          workspaceId: template.workspaceId,
          publisherId: template.publisherId ?? template.createdBy,
          listingType,
          pricingModel: input.pricingModel,
          price,
          currency: (input.currency ?? 'usd').toLowerCase(),
          billingCycle,
          revenueSharePercentage: clampShare(input.revenueSharePercentage),
          bundleTemplateIds,
          industryTags,
          status: input.status ?? 'PUBLISHED',
          marketplaceVersion: existing ? existing.marketplaceVersion + 1 : 1,
        },
        $setOnInsert: {
          createdBy: new Types.ObjectId(input.userId),
          statistics: { sales: 0, installs: 0, grossRevenue: 0 },
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    await createAuditLog({
      action: 'WORKFLOW_MARKETPLACE_PUBLISHED',
      userId: input.userId,
      workspaceId: template.workspaceId,
      resource: 'workflow_marketplace_listing',
      resourceId: listing._id.toString(),
      metadata: {
        templateId: template._id.toString(),
        listingType,
        pricingModel: input.pricingModel,
        price,
        currency: listing.currency,
        billingCycle,
        revenueSharePercentage: listing.revenueSharePercentage,
        status: listing.status,
        marketplaceVersion: listing.marketplaceVersion,
      },
    });

    return listing;
  }
  /** Browse published premium workflows with pricing, sales and rating signals. */
  async listWorkflows(filters: WorkflowSearchFilters = {}): Promise<WorkflowSearchResult> {
    const page = Number.isFinite(filters.page) && filters.page && filters.page > 0 ? Math.floor(filters.page) : 1;
    const requested = Number.isFinite(filters.limit) && filters.limit && filters.limit > 0 ? Math.floor(filters.limit) : DEFAULT_PAGE_SIZE;
    const limit = Math.min(MAX_PAGE_SIZE, requested);

    const query: Record<string, unknown> = { status: 'PUBLISHED' };
    if (filters.listingType) query.listingType = filters.listingType;
    const tags = (filters.industryTags ?? []).map((tag) => tag.trim()).filter(Boolean);
    if (tags.length > 0) query.industryTags = { $in: tags };
    const priceRange: Record<string, number> = {};
    if (Number.isFinite(filters.minPrice) && filters.minPrice && filters.minPrice > 0) priceRange.$gte = filters.minPrice;
    if (Number.isFinite(filters.maxPrice) && filters.maxPrice && filters.maxPrice > 0) priceRange.$lte = filters.maxPrice;
    if (Object.keys(priceRange).length > 0) query.price = priceRange;

    const search = filters.q?.trim();
    if (search) {
      const templates = await WorkflowTemplateModel.find({ name: { $regex: escapeRegex(search), $options: 'i' } })
        .select('_id')
        .limit(MAX_TEMPLATE_LOOKUPS)
        .lean();
      query.templateId = { $in: templates.map((row) => row._id) };
    }

    const sort: Record<string, 1 | -1> = filters.sortBy === 'sales'
      ? { 'statistics.sales': -1, updatedAt: -1 }
      : filters.sortBy === 'installs'
        ? { 'statistics.installs': -1, updatedAt: -1 }
        : filters.sortBy === 'price'
          ? { price: 1, updatedAt: -1 }
          : { updatedAt: -1 };
    const [total, rows] = await Promise.all([
      WorkflowTemplateMarketplaceModel.countDocuments(query),
      WorkflowTemplateMarketplaceModel.find(query)
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    const items = await this.toViews(rows, 'WORKFLOW');
    return { items, page, limit, total, generatedAt: new Date().toISOString() };
  }

  private async toViews(
    rows: Array<{
      _id: Types.ObjectId;
      templateId: Types.ObjectId;
      publisherId: Types.ObjectId;
      listingType: WorkflowListingType;
      status: WorkflowListingStatus;
      pricingModel: MarketplacePricingModel;
      price: number;
      currency: string;
      billingCycle: MarketplaceBillingCycle;
      industryTags: string[];
      marketplaceVersion: number;
      statistics: { sales: number; installs: number; grossRevenue: number };
      updatedAt: Date;
    }>,
    assetType: 'WORKFLOW',
  ): Promise<WorkflowListingView[]> {
    if (rows.length === 0) return [];
    const templateIds = rows.map((row) => row.templateId);
    const [templates, ratings] = await Promise.all([
      WorkflowTemplateModel.find({ _id: { $in: templateIds } }).select('name description category tags').lean(),
      MarketplaceReviewModel.aggregate<{ _id: Types.ObjectId; average: number; count: number }>([
        { $match: { assetType, assetId: { $in: templateIds }, status: 'PUBLISHED' } },
        { $group: { _id: '$assetId', average: { $avg: '$rating' }, count: { $sum: 1 } } },
      ]),
    ]);
    const templateMap = new Map(templates.map((row) => [row._id.toString(), row]));
    const ratingMap = new Map(ratings.map((row) => [row._id.toString(), row]));
    return rows.map((row) => {
      const template = templateMap.get(row.templateId.toString());
      const rating = ratingMap.get(row.templateId.toString());
      return {
        listingId: row._id.toString(),
        templateId: row.templateId.toString(),
        name: template?.name ?? 'Unknown workflow',
        description: template?.description ?? '',
        category: template?.category ?? null,
        tags: template?.tags ?? [],
        listingType: row.listingType,
        status: row.status,
        pricingModel: row.pricingModel,
        price: row.price,
        currency: row.currency,
        billingCycle: row.billingCycle,
        industryTags: row.industryTags,
        marketplaceVersion: row.marketplaceVersion,
        statistics: row.statistics,
        rating: rating ? { average: Math.round(rating.average * 10) / 10, count: rating.count } : { average: 0, count: 0 },
        publisherId: row.publisherId.toString(),
        updatedAt: new Date(row.updatedAt).toISOString(),
      };
    });
  }
  /** Listing details with review summary and the caller's license state. */
  async getWorkflow(id: string, buyerWorkspaceId?: string | undefined) {
    const listing = await this.loadListing(id);
    if (listing.status !== 'PUBLISHED') throw new Error('WORKFLOW_LISTING_NOT_FOUND');
    const template = await WorkflowTemplateModel.findById(listing.templateId)
      .select('name description category tags metadata statistics rating')
      .lean();

    const [distribution, recent, license] = await Promise.all([
      MarketplaceReviewModel.aggregate<{ _id: number; count: number }>([
        { $match: { assetType: 'WORKFLOW', assetId: listing.templateId, status: 'PUBLISHED' } },
        { $group: { _id: '$rating', count: { $sum: 1 } } },
      ]),
      MarketplaceReviewModel.find({ assetType: 'WORKFLOW', assetId: listing.templateId, status: 'PUBLISHED' })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('workspaceId rating review verifiedPurchase createdAt')
        .lean(),
      buyerWorkspaceId && Types.ObjectId.isValid(buyerWorkspaceId)
        ? MarketplaceLicenseModel.findOne({
          workspaceId: new Types.ObjectId(buyerWorkspaceId),
          assetType: 'WORKFLOW',
          assetId: listing.templateId,
        }).lean()
        : null,
    ]);

    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let total = 0;
    let sum = 0;
    for (const bucket of distribution) {
      counts[bucket._id] = bucket.count;
      total += bucket.count;
      sum += bucket._id * bucket.count;
    }
    return {
      listingId: listing._id.toString(),
      templateId: listing.templateId.toString(),
      template: template
        ? {
          name: template.name,
          description: template.description,
          category: template.category,
          tags: template.tags,
          metadata: template.metadata,
          statistics: template.statistics,
        }
        : null,
      listingType: listing.listingType,
      pricingModel: listing.pricingModel,
      price: listing.price,
      currency: listing.currency,
      billingCycle: listing.billingCycle,
      industryTags: listing.industryTags,
      bundleTemplateIds: listing.bundleTemplateIds.map((entry) => entry.toString()),
      marketplaceVersion: listing.marketplaceVersion,
      statistics: listing.statistics,
      publisherId: listing.publisherId.toString(),
      rating: {
        average: total > 0 ? Math.round((sum / total) * 10) / 10 : 0,
        count: total,
        distribution: counts,
      },
      recentReviews: recent.map((row) => ({
        workspaceId: row.workspaceId.toString(),
        rating: row.rating,
        review: row.review,
        verifiedPurchase: row.verifiedPurchase,
        createdAt: new Date(row.createdAt).toISOString(),
      })),
      license: license
        ? {
          licenseId: license._id.toString(),
          status: license.status,
          expiresAt: license.expiresAt ? license.expiresAt.toISOString() : null,
        }
        : null,
      updatedAt: new Date(listing.updatedAt).toISOString(),
    };
  }
  private async resolveCustomer(workspaceId: Types.ObjectId, provider: ReturnType<typeof createBillingProvider>) {
    const subscription = await SubscriptionModel.findOne({ workspaceId });
    if (!subscription) throw new Error('SUBSCRIPTION_NOT_FOUND');
    let customerId = subscription.externalCustomerId;
    if (!customerId) {
      const tenant = await TenantAccountModel.findOne({ workspaceId }).select('ownerUserId companyName').lean();
      const owner = tenant ? await UserModel.findById(tenant.ownerUserId).select('email').lean() : null;
      const customer = await provider.createCustomer({
        email: owner?.email ?? 'billing@localhost',
        name: tenant?.companyName ?? `Workspace ${workspaceId.toString()}`,
        metadata: { workspaceId: workspaceId.toString() },
      });
      subscription.externalCustomerId = customer.id;
      await subscription.save();
      customerId = customer.id;
    }
    return { subscription, customerId };
  }

  private async loadPurchasableListing(listingId: string, buyerWorkspaceId: string) {
    const listing = await this.loadListing(listingId);
    if (listing.status !== 'PUBLISHED') throw new Error('WORKFLOW_LISTING_NOT_FOUND');
    if (listing.workspaceId.toString() === buyerWorkspaceId) throw new Error('INVALID_PURCHASE');
    return listing;
  }
  /** Step 1 of a workflow purchase: provider payment intent for the price. */
  async createPurchaseSession(input: {
    listingId: string;
    workspaceId: string;
    userId: string;
    provider?: string | undefined;
    currency?: string | undefined;
  }): Promise<WorkflowPurchaseSession> {
    const workspaceIdObj = new Types.ObjectId(input.workspaceId);
    const listing = await this.loadPurchasableListing(input.listingId, input.workspaceId);
    if (listing.pricingModel === 'FREE' || listing.price <= 0) throw new Error('INVALID_PURCHASE');

    const subscription = await SubscriptionModel.findOne({ workspaceId: workspaceIdObj });
    if (!subscription) throw new Error('SUBSCRIPTION_NOT_FOUND');
    const providerName = input.provider && isBillingProviderName(input.provider)
      ? input.provider
      : subscription.billingProvider;
    const provider = createBillingProvider(providerName);
    const { customerId } = await this.resolveCustomer(workspaceIdObj, provider);
    const currency = (input.currency ?? listing.currency).toLowerCase();

    const intent = await provider.createPaymentIntent({
      amount: listing.price,
      currency,
      customerId,
      metadata: {
        workspaceId: input.workspaceId,
        listingId: listing._id.toString(),
        templateId: listing.templateId.toString(),
        assetType: 'WORKFLOW',
        purpose: 'MARKETPLACE_PURCHASE',
      },
    });

    const template = await WorkflowTemplateModel.findById(listing.templateId).select('name').lean();
    await createAuditLog({
      action: 'MARKETPLACE_PURCHASE_STARTED',
      userId: input.userId,
      workspaceId: workspaceIdObj,
      resource: 'workflow_marketplace_listing',
      resourceId: listing._id.toString(),
      metadata: {
        assetType: 'WORKFLOW',
        templateId: listing.templateId.toString(),
        pricingModel: listing.pricingModel,
        amount: listing.price,
        currency,
        provider: providerName,
      },
    });
    return {
      listingId: listing._id.toString(),
      templateId: listing.templateId.toString(),
      templateName: template?.name ?? 'Premium workflow',
      pricingModel: listing.pricingModel,
      amount: listing.price,
      currency,
      provider: providerName,
      paymentId: intent.id,
      clientSecret: intent.clientSecret,
      status: intent.status,
    };
  }

  private async upsertPaymentRecord(
    workspaceId: Types.ObjectId,
    providerName: string,
    payment: BillingPayment,
    activated: boolean,
  ): Promise<void> {
    await PaymentRecordModel.findOneAndUpdate(
      { provider: providerName, paymentId: payment.id },
      {
        $set: {
          workspaceId,
          provider: providerName,
          paymentId: payment.id,
          customerId: payment.customerId,
          packageId: null,
          plan: null,
          amount: payment.amount,
          amountReceived: payment.amountReceived,
          refundedAmount: payment.refundedAmount,
          currency: payment.currency,
          status: payment.status,
          method: payment.method,
          paid: payment.paid,
          activated,
          providerCreatedAt: payment.created,
        },
      },
      { upsert: true },
    );
  }
  /** Step 2 of a workflow purchase: verify, issue the license, record revenue. */
  async completePurchase(input: {
    listingId: string;
    workspaceId: string;
    userId: string;
    paymentId: string;
  }): Promise<WorkflowPurchaseResult> {
    const workspaceIdObj = new Types.ObjectId(input.workspaceId);
    const listing = await this.loadPurchasableListing(input.listingId, input.workspaceId);

    const existing = await MarketplaceLicenseModel.findOne({
      workspaceId: workspaceIdObj,
      assetType: 'WORKFLOW',
      assetId: listing.templateId,
    });
    if (existing && existing.status === 'ACTIVE' && (!existing.expiresAt || existing.expiresAt.getTime() > Date.now())) {
      throw new Error('LICENSE_ALREADY_ACTIVE');
    }

    const subscription = await SubscriptionModel.findOne({ workspaceId: workspaceIdObj });
    if (!subscription) throw new Error('SUBSCRIPTION_NOT_FOUND');
    const providerName = subscription.billingProvider;
    const provider = createBillingProvider(providerName);
    const payment = await provider.verifyPayment({ paymentId: input.paymentId });
    const settled = payment.paid;

    await this.upsertPaymentRecord(workspaceIdObj, providerName, payment, settled);
    if (!settled) {
      return {
        settled: false,
        reason: 'PAYMENT_NOT_SETTLED',
        license: null,
        payment: {
          id: payment.id,
          amount: payment.amount,
          currency: payment.currency,
          status: payment.status,
          paid: payment.paid,
          method: payment.method,
        },
        transactionId: null,
      };
    }
    const amount = payment.amountReceived > 0 ? payment.amountReceived : payment.amount;
    const cycle = cycleDays(listing.billingCycle);
    const expiresAt = cycle !== null ? new Date(Date.now() + cycle * DAY_MS) : null;

    const license = await MarketplaceLicenseModel.findOneAndUpdate(
      { workspaceId: workspaceIdObj, assetType: 'WORKFLOW', assetId: listing.templateId },
      {
        $set: {
          publisherId: listing.publisherId,
          pricingModel: listing.pricingModel,
          status: 'ACTIVE',
          paymentId: payment.id,
          provider: providerName,
          revenueSharePercentage: listing.revenueSharePercentage,
          activatedAt: new Date(),
          expiresAt,
          revokedAt: null,
          revokedBy: null,
          revokeReason: null,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    const transaction = await marketplaceRevenueService.recordTransaction({
      buyerWorkspaceId: input.workspaceId,
      sellerWorkspaceId: listing.workspaceId.toString(),
      publisherId: listing.publisherId.toString(),
      assetType: 'WORKFLOW',
      assetId: listing.templateId.toString(),
      amount,
      currency: payment.currency,
      revenueSharePercentage: listing.revenueSharePercentage,
      paymentId: payment.id,
      provider: providerName,
      metadata: {
        pricingModel: listing.pricingModel,
        billingCycle: listing.billingCycle,
        listingId: listing._id.toString(),
      },
    });

    license.transactionId = transaction.transactionId;
    await license.save();
    await WorkflowTemplateMarketplaceModel.updateOne(
      { _id: listing._id },
      { $inc: { 'statistics.sales': 1, 'statistics.grossRevenue': amount } },
    );
    await createAuditLog({
      action: 'MARKETPLACE_PURCHASE_COMPLETED',
      userId: input.userId,
      workspaceId: workspaceIdObj,
      resource: 'workflow_marketplace_listing',
      resourceId: listing._id.toString(),
      metadata: {
        assetType: 'WORKFLOW',
        templateId: listing.templateId.toString(),
        paymentId: payment.id,
        provider: providerName,
        amount,
        currency: payment.currency,
        transactionId: transaction.transactionId,
        platformCommission: transaction.platformCommission,
        publisherEarnings: transaction.publisherEarnings,
      },
    });
    await createAuditLog({
      action: 'MARKETPLACE_LICENSE_ACTIVATED',
      userId: input.userId,
      workspaceId: workspaceIdObj,
      resource: 'marketplace_license',
      resourceId: license._id.toString(),
      metadata: { assetType: 'WORKFLOW', assetId: listing.templateId.toString(), pricingModel: listing.pricingModel },
    });

    return {
      settled: true,
      reason: 'SETTLED',
      license: {
        licenseId: license._id.toString(),
        status: license.status,
        activatedAt: license.activatedAt.toISOString(),
        expiresAt: license.expiresAt ? license.expiresAt.toISOString() : null,
      },
      payment: {
        id: payment.id,
        amount,
        currency: payment.currency,
        status: payment.status,
        paid: payment.paid,
        method: payment.method,
      },
      transactionId: transaction.transactionId,
    };
  }
  /** Renew a workflow subscription or enterprise license after a settled payment. */
  async renewSubscription(input: {
    listingId: string;
    workspaceId: string;
    userId: string;
    paymentId: string;
  }) {
    const workspaceIdObj = new Types.ObjectId(input.workspaceId);
    const listing = await this.loadListing(input.listingId);
    if (listing.pricingModel !== 'SUBSCRIPTION' && listing.pricingModel !== 'ENTERPRISE_LICENSE') {
      throw new Error('INVALID_PURCHASE');
    }

    const license = await MarketplaceLicenseModel.findOne({
      workspaceId: workspaceIdObj,
      assetType: 'WORKFLOW',
      assetId: listing.templateId,
    });
    if (!license || license.status === 'REVOKED') throw new Error('LICENSE_NOT_FOUND');

    const subscription = await SubscriptionModel.findOne({ workspaceId: workspaceIdObj });
    if (!subscription) throw new Error('SUBSCRIPTION_NOT_FOUND');
    const providerName = subscription.billingProvider;
    const provider = createBillingProvider(providerName);
    const payment = await provider.verifyPayment({ paymentId: input.paymentId });
    if (!payment.paid) throw new Error('PAYMENT_NOT_SETTLED');

    const now = Date.now();
    const base = license.expiresAt && license.expiresAt.getTime() > now ? license.expiresAt.getTime() : now;
    const cycle = cycleDays(listing.billingCycle);
    const extensionMs = cycle !== null ? cycle * DAY_MS : 30 * DAY_MS;
    license.status = 'ACTIVE';
    license.expiresAt = new Date(base + extensionMs);
    license.lastRenewedAt = new Date();
    license.paymentId = payment.id;
    license.provider = providerName;
    await license.save();

    const amount = payment.amountReceived > 0 ? payment.amountReceived : payment.amount;
    const transaction = await marketplaceRevenueService.recordTransaction({
      buyerWorkspaceId: input.workspaceId,
      sellerWorkspaceId: listing.workspaceId.toString(),
      publisherId: listing.publisherId.toString(),
      assetType: 'WORKFLOW',
      assetId: listing.templateId.toString(),
      amount,
      currency: payment.currency,
      revenueSharePercentage: listing.revenueSharePercentage,
      paymentId: payment.id,
      provider: providerName,
      metadata: { pricingModel: listing.pricingModel, renewal: true, listingId: listing._id.toString() },
    });
    license.transactionId = transaction.transactionId;
    await license.save();
    await WorkflowTemplateMarketplaceModel.updateOne(
      { _id: listing._id },
      { $inc: { 'statistics.sales': 1, 'statistics.grossRevenue': amount } },
    );

    await createAuditLog({
      action: 'MARKETPLACE_LICENSE_RENEWED',
      userId: input.userId,
      workspaceId: workspaceIdObj,
      resource: 'marketplace_license',
      resourceId: license._id.toString(),
      metadata: {
        assetType: 'WORKFLOW',
        assetId: listing.templateId.toString(),
        expiresAt: license.expiresAt.toISOString(),
        amount,
        currency: payment.currency,
        transactionId: transaction.transactionId,
      },
    });

    return {
      license: {
        licenseId: license._id.toString(),
        status: license.status,
        expiresAt: license.expiresAt.toISOString(),
        lastRenewedAt: license.lastRenewedAt ? license.lastRenewedAt.toISOString() : null,
      },
      payment: { id: payment.id, amount, currency: payment.currency, status: payment.status, paid: payment.paid },
      transactionId: transaction.transactionId,
    };
  }
  /**
   * Install a premium workflow into a buyer workspace. Paid listings require an
   * ACTIVE license; when a paymentId is supplied the purchase is settled first.
   * Free listings activate a zero-share license. The install itself stays in
   * TemplateService.installTemplate.
   */
  async installWorkflow(input: {
    listingId: string;
    workspaceId: string;
    userId: string;
    paymentId?: string | undefined;
    workflowName?: string | undefined;
  }): Promise<WorkflowInstallResult> {
    const workspaceIdObj = new Types.ObjectId(input.workspaceId);
    const listing = await this.loadListing(input.listingId);
    if (listing.status !== 'PUBLISHED') throw new Error('WORKFLOW_LISTING_NOT_FOUND');

    const isPaid = listing.pricingModel !== 'FREE' && listing.price > 0;
    let license: WorkflowInstallResult['license'] = null;

    if (isPaid) {
      const existing = await MarketplaceLicenseModel.findOne({
        workspaceId: workspaceIdObj,
        assetType: 'WORKFLOW',
        assetId: listing.templateId,
      });
      const active = existing && existing.status === 'ACTIVE'
        && (!existing.expiresAt || existing.expiresAt.getTime() > Date.now());
      if (existing && active) {
        license = {
          licenseId: existing._id.toString(),
          status: existing.status,
          activatedAt: existing.activatedAt.toISOString(),
          expiresAt: existing.expiresAt ? existing.expiresAt.toISOString() : null,
        };
      } else {
        if (!input.paymentId) throw new Error('LICENSE_REQUIRED');
        const settled = await this.completePurchase({
          listingId: input.listingId,
          workspaceId: input.workspaceId,
          userId: input.userId,
          paymentId: input.paymentId,
        });
        if (!settled.settled || !settled.license) throw new Error('PAYMENT_NOT_SETTLED');
        license = settled.license;
      }
    } else {
      const issued = await MarketplaceLicenseModel.findOneAndUpdate(
        { workspaceId: workspaceIdObj, assetType: 'WORKFLOW', assetId: listing.templateId },
        {
          $set: {
            publisherId: listing.publisherId,
            pricingModel: 'FREE',
            status: 'ACTIVE',
            revenueSharePercentage: 0,
            activatedAt: new Date(),
            expiresAt: null,
            revokedAt: null,
            revokedBy: null,
            revokeReason: null,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      await createAuditLog({
        action: 'MARKETPLACE_LICENSE_ACTIVATED',
        userId: input.userId,
        workspaceId: workspaceIdObj,
        resource: 'marketplace_license',
        resourceId: issued._id.toString(),
        metadata: { assetType: 'WORKFLOW', assetId: listing.templateId.toString(), pricingModel: 'FREE' },
      });
      license = {
        licenseId: issued._id.toString(),
        status: issued.status,
        activatedAt: issued.activatedAt.toISOString(),
        expiresAt: null,
      };
    }
    const installed = await TemplateService.installTemplate(
      listing.templateId,
      input.userId,
      input.workspaceId,
      input.workflowName,
    );
    await WorkflowTemplateMarketplaceModel.updateOne({ _id: listing._id }, { $inc: { 'statistics.installs': 1 } });

    const workflowId = (installed.workflow as { _id?: Types.ObjectId })._id;
    await createAuditLog({
      action: 'MARKETPLACE_WORKFLOW_INSTALLED',
      userId: input.userId,
      workspaceId: workspaceIdObj,
      resource: 'workflow_marketplace_listing',
      resourceId: listing._id.toString(),
      metadata: {
        templateId: listing.templateId.toString(),
        pricingModel: listing.pricingModel,
        workflowId: workflowId ? workflowId.toString() : null,
      },
    });

    return {
      listingId: listing._id.toString(),
      templateId: listing.templateId.toString(),
      workflow: installed.workflow,
      version: installed.version,
      license,
    };
  }

  /** The caller's published listings for the publisher portal. */
  async listPublisherListings(workspaceId: string, options: { status?: WorkflowListingStatus | undefined } = {}) {
    if (!Types.ObjectId.isValid(workspaceId)) return [];
    const query: Record<string, unknown> = { workspaceId: new Types.ObjectId(workspaceId) };
    if (options.status) query.status = options.status;
    const rows = await WorkflowTemplateMarketplaceModel.find(query)
      .sort({ updatedAt: -1 })
      .limit(MAX_TEMPLATE_LOOKUPS)
      .lean();
    return this.toViews(rows, 'WORKFLOW');
  }
}

export const workflowMarketplaceService = new WorkflowMarketplaceService();
