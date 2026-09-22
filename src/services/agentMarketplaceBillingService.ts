import { Types } from 'mongoose';
import { MarketplacePricingModel, DEFAULT_PUBLISHER_SHARE_PERCENT } from '../models/MarketplacePricingModel.js';
import type { MarketplaceBillingCycle, MarketplacePricingModel as PricingModel, MarketplacePricingStatus } from '../models/MarketplacePricingModel.js';
import { MarketplaceLicenseModel } from '../models/MarketplaceLicenseModel.js';
import { AgentMarketplaceModel } from '../models/AgentMarketplaceModel.js';
import { SubscriptionModel } from '../models/SubscriptionModel.js';
import { TenantAccountModel } from '../models/TenantAccountModel.js';
import { UserModel } from '../models/UserModel.js';
import { PaymentRecordModel } from '../models/PaymentRecordModel.js';
import { WorkflowTemplateModel } from '../models/WorkflowTemplateModel.js';
import { createBillingProvider, isBillingProviderName } from './billing/billingProviderRegistry.js';
import type { BillingPayment } from './billing/billingProvider.js';
import { marketplaceRevenueService } from './marketplaceRevenueService.js';
import { createAuditLog } from './auditService.js';

/**
 * Phase 17.1 - Agent marketplace monetization.
 *
 * Pricing records, purchases, licenses and renewals for agent listings. The
 * purchase path reuses the Phase 15.3 billing providers (session -> verify ->
 * settle) and the 17.3 revenue ledger; the listing, install and versioning
 * logic stays in agentMarketplaceService. Installs of paid listings require an
 * ACTIVE license - installAgent calls assertLicenseForInstall.
 */

export interface SetPricingInput {
  listingId: string;
  userId: string;
  callerWorkspaceId?: string | undefined;
  pricingModel: PricingModel;
  price?: number | undefined;
  currency?: string | undefined;
  billingCycle?: MarketplaceBillingCycle | undefined;
  revenueSharePercentage?: number | undefined;
  seats?: number | null | undefined;
  termMonths?: number | null | undefined;
  status?: MarketplacePricingStatus | undefined;
}

export interface PurchaseSessionView {
  listingId: string;
  listingName: string;
  pricingModel: PricingModel;
  amount: number;
  currency: string;
  provider: string;
  paymentId: string;
  clientSecret: string;
  status: string;
}

export interface PurchaseResult {
  settled: boolean;
  reason: 'SETTLED' | 'ALREADY_LICENSED' | 'PAYMENT_NOT_SETTLED';
  license: {
    licenseId: string;
    status: string;
    activatedAt: string;
    expiresAt: string | null;
  } | null;
  payment: {
    id: string;
    amount: number;
    currency: string;
    status: string;
    paid: boolean;
    method: string | null;
  };
  transactionId: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function cycleDays(cycle: MarketplaceBillingCycle): number | null {
  if (cycle === 'MONTHLY') return 30;
  if (cycle === 'YEARLY') return 365;
  return null;
}

function clampShare(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_PUBLISHER_SHARE_PERCENT;
  return Math.max(0, Math.min(100, Math.floor(value as number)));
}

export class AgentMarketplaceBillingService {
  /** Publisher sets (or replaces) the pricing record for one listing. */
  async setPricing(input: SetPricingInput) {
    const listing = await AgentMarketplaceModel.findById(input.listingId);
    if (!listing) throw new Error('LISTING_NOT_FOUND');
    if (input.callerWorkspaceId && listing.workspaceId.toString() !== input.callerWorkspaceId) throw new Error('LISTING_NOT_FOUND');

    const price = input.pricingModel === 'FREE' ? 0 : Math.floor(input.price ?? 0);
    if (input.pricingModel !== 'FREE' && price <= 0) throw new Error('INVALID_PRICING');
    const billingCycle: MarketplaceBillingCycle = input.billingCycle
      ?? (input.pricingModel === 'SUBSCRIPTION' ? 'MONTHLY' : 'NONE');
    if (input.pricingModel === 'SUBSCRIPTION' && billingCycle === 'NONE') throw new Error('INVALID_PRICING');
    if (input.pricingModel === 'ENTERPRISE_LICENSE' && !(input.termMonths ?? input.seats)) {
      throw new Error('INVALID_PRICING');
    }

    const pricing = await MarketplacePricingModel.findOneAndUpdate(
      { assetType: 'AGENT', assetId: listing._id },
      {
        $set: {
          workspaceId: listing.workspaceId,
          assetType: 'AGENT',
          assetId: listing._id,
          publisherId: listing.publisherId,
          pricingModel: input.pricingModel,
          price,
          currency: (input.currency ?? 'usd').toLowerCase(),
          billingCycle,
          revenueSharePercentage: clampShare(input.revenueSharePercentage),
          seats: input.seats ?? null,
          termMonths: input.termMonths ?? null,
          status: input.status ?? 'ACTIVE',
          createdBy: new Types.ObjectId(input.userId),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    await createAuditLog({
      action: 'MARKETPLACE_PRICING_UPDATED',
      userId: input.userId,
      workspaceId: listing.workspaceId,
      resource: 'agent_listing',
      resourceId: listing._id.toString(),
      metadata: {
        pricingModel: pricing?.pricingModel,
        price: pricing?.price,
        currency: pricing?.currency,
        billingCycle: pricing?.billingCycle,
        revenueSharePercentage: pricing?.revenueSharePercentage,
        status: pricing?.status,
      },
    });

    return pricing;
  }

  async getPricing(listingId: string) {
    if (!Types.ObjectId.isValid(listingId)) return null;
    return MarketplacePricingModel.findOne({ assetType: 'AGENT', assetId: new Types.ObjectId(listingId) }).lean();
  }

  /** Workspace billing customer, created on first purchase (15.3 pattern). */
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
    const listing = await AgentMarketplaceModel.findById(listingId);
    if (!listing || listing.status !== 'PUBLISHED') throw new Error('LISTING_NOT_FOUND');
    if (listing.workspaceId.toString() === buyerWorkspaceId) throw new Error('INVALID_PURCHASE');
    if (listing.visibility !== 'PUBLIC') throw new Error('LISTING_NOT_FOUND');
    const pricing = await MarketplacePricingModel.findOne({ assetType: 'AGENT', assetId: listing._id });
    if (!pricing || pricing.status !== 'ACTIVE') throw new Error('PRICE_NOT_SET');
    return { listing, pricing };
  }

  /** Step 1 of a purchase: provider payment intent for the listing price. */
  async createPurchaseSession(input: {
    listingId: string;
    workspaceId: string;
    userId: string;
    provider?: string | undefined;
    currency?: string | undefined;
  }): Promise<PurchaseSessionView> {
    const workspaceIdObj = new Types.ObjectId(input.workspaceId);
    const { listing, pricing } = await this.loadPurchasableListing(input.listingId, input.workspaceId);
    if (pricing.pricingModel === 'FREE' || pricing.price <= 0) throw new Error('INVALID_PURCHASE');

    const subscription = await SubscriptionModel.findOne({ workspaceId: workspaceIdObj });
    if (!subscription) throw new Error('SUBSCRIPTION_NOT_FOUND');
    const providerName = input.provider && isBillingProviderName(input.provider)
      ? input.provider
      : subscription.billingProvider;
    const provider = createBillingProvider(providerName);
    const { customerId } = await this.resolveCustomer(workspaceIdObj, provider);
    const currency = (input.currency ?? pricing.currency).toLowerCase();

    const intent = await provider.createPaymentIntent({
      amount: pricing.price,
      currency,
      customerId,
      metadata: {
        workspaceId: input.workspaceId,
        listingId: listing._id.toString(),
        assetType: 'AGENT',
        purpose: 'MARKETPLACE_PURCHASE',
      },
    });

    await createAuditLog({
      action: 'MARKETPLACE_PURCHASE_STARTED',
      userId: input.userId,
      workspaceId: workspaceIdObj,
      resource: 'agent_listing',
      resourceId: listing._id.toString(),
      metadata: {
        pricingModel: pricing.pricingModel,
        amount: pricing.price,
        currency,
        provider: providerName,
      },
    });

    return {
      listingId: listing._id.toString(),
      listingName: listing.name,
      pricingModel: pricing.pricingModel,
      amount: pricing.price,
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

  /** Step 2 of a purchase: verify the payment, issue the license, record revenue. */
  async completePurchase(input: {
    listingId: string;
    workspaceId: string;
    userId: string;
    paymentId: string;
  }): Promise<PurchaseResult> {
    const workspaceIdObj = new Types.ObjectId(input.workspaceId);
    const { listing, pricing } = await this.loadPurchasableListing(input.listingId, input.workspaceId);

    const existing = await MarketplaceLicenseModel.findOne({
      workspaceId: workspaceIdObj,
      assetType: 'AGENT',
      assetId: listing._id,
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
    const cycle = cycleDays(pricing.billingCycle);
    const expiresAt = cycle !== null
      ? new Date(Date.now() + cycle * DAY_MS)
      : pricing.termMonths
        ? new Date(Date.now() + pricing.termMonths * 30 * DAY_MS)
        : null;

    const license = await MarketplaceLicenseModel.findOneAndUpdate(
      { workspaceId: workspaceIdObj, assetType: 'AGENT', assetId: listing._id },
      {
        $set: {
          publisherId: listing.publisherId,
          pricingModel: pricing.pricingModel,
          status: 'ACTIVE',
          seats: pricing.seats ?? null,
          paymentId: payment.id,
          provider: providerName,
          revenueSharePercentage: pricing.revenueSharePercentage,
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
      assetType: 'AGENT',
      assetId: listing._id.toString(),
      amount,
      currency: payment.currency,
      revenueSharePercentage: pricing.revenueSharePercentage,
      paymentId: payment.id,
      provider: providerName,
      metadata: { pricingModel: pricing.pricingModel, billingCycle: pricing.billingCycle },
    });

    license.transactionId = transaction.transactionId;
    await license.save();

    await createAuditLog({
      action: 'MARKETPLACE_PURCHASE_COMPLETED',
      userId: input.userId,
      workspaceId: workspaceIdObj,
      resource: 'agent_listing',
      resourceId: listing._id.toString(),
      metadata: {
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
      metadata: { assetType: 'AGENT', assetId: listing._id.toString(), pricingModel: pricing.pricingModel },
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

  /** FREE listing: issue the license without a payment. */
  async activateLicense(input: { listingId: string; workspaceId: string; userId: string }) {
    const workspaceIdObj = new Types.ObjectId(input.workspaceId);
    const listing = await AgentMarketplaceModel.findById(input.listingId);
    if (!listing || listing.status !== 'PUBLISHED') throw new Error('LISTING_NOT_FOUND');
    const pricing = await MarketplacePricingModel.findOne({ assetType: 'AGENT', assetId: listing._id });
    if (pricing && pricing.status === 'ACTIVE' && (pricing.pricingModel !== 'FREE' || pricing.price > 0)) {
      throw new Error('INVALID_PURCHASE');
    }

    const license = await MarketplaceLicenseModel.findOneAndUpdate(
      { workspaceId: workspaceIdObj, assetType: 'AGENT', assetId: listing._id },
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
      resourceId: license._id.toString(),
      metadata: { assetType: 'AGENT', assetId: listing._id.toString(), pricingModel: 'FREE' },
    });

    return license;
  }

  /** Renew a subscription or enterprise license after a settled payment. */
  async renewSubscription(input: {
    listingId: string;
    workspaceId: string;
    userId: string;
    paymentId: string;
  }) {
    const workspaceIdObj = new Types.ObjectId(input.workspaceId);
    const listing = await AgentMarketplaceModel.findById(input.listingId);
    if (!listing) throw new Error('LISTING_NOT_FOUND');
    const pricing = await MarketplacePricingModel.findOne({ assetType: 'AGENT', assetId: listing._id });
    if (!pricing || pricing.status !== 'ACTIVE') throw new Error('PRICE_NOT_SET');
    if (pricing.pricingModel !== 'SUBSCRIPTION' && pricing.pricingModel !== 'ENTERPRISE_LICENSE') {
      throw new Error('INVALID_PURCHASE');
    }

    const license = await MarketplaceLicenseModel.findOne({
      workspaceId: workspaceIdObj,
      assetType: 'AGENT',
      assetId: listing._id,
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
    const cycle = cycleDays(pricing.billingCycle);
    const extensionMs = cycle !== null
      ? cycle * DAY_MS
      : (pricing.termMonths ?? 1) * 30 * DAY_MS;
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
      assetType: 'AGENT',
      assetId: listing._id.toString(),
      amount,
      currency: payment.currency,
      revenueSharePercentage: pricing.revenueSharePercentage,
      paymentId: payment.id,
      provider: providerName,
      metadata: { pricingModel: pricing.pricingModel, renewal: true },
    });
    license.transactionId = transaction.transactionId;
    await license.save();

    await createAuditLog({
      action: 'MARKETPLACE_LICENSE_RENEWED',
      userId: input.userId,
      workspaceId: workspaceIdObj,
      resource: 'marketplace_license',
      resourceId: license._id.toString(),
      metadata: {
        assetId: listing._id.toString(),
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

  /** Publisher (or platform admin) revokes a buyer's license. */
  async revokeAccess(input: {
    listingId: string;
    buyerWorkspaceId: string;
    userId: string;
    callerWorkspaceId: string;
    reason?: string | undefined;
    platformAdmin?: boolean | undefined;
  }) {
    const listing = await AgentMarketplaceModel.findById(input.listingId);
    if (!listing) throw new Error('LISTING_NOT_FOUND');
    if (!input.platformAdmin && listing.workspaceId.toString() !== input.callerWorkspaceId) {
      throw new Error('LISTING_NOT_FOUND');
    }
    const license = await MarketplaceLicenseModel.findOne({
      workspaceId: new Types.ObjectId(input.buyerWorkspaceId),
      assetType: 'AGENT',
      assetId: listing._id,
    });
    if (!license) throw new Error('LICENSE_NOT_FOUND');

    license.status = 'REVOKED';
    license.revokedAt = new Date();
    license.revokedBy = new Types.ObjectId(input.userId);
    license.revokeReason = input.reason ?? null;
    await license.save();

    await createAuditLog({
      action: 'MARKETPLACE_LICENSE_REVOKED',
      userId: input.userId,
      workspaceId: listing.workspaceId,
      resource: 'marketplace_license',
      resourceId: license._id.toString(),
      metadata: {
        assetType: 'AGENT',
        assetId: listing._id.toString(),
        buyerWorkspaceId: input.buyerWorkspaceId,
        reason: input.reason ?? null,
      },
    });

    return {
      licenseId: license._id.toString(),
      status: license.status,
      revokedAt: license.revokedAt ? license.revokedAt.toISOString() : null,
      buyerWorkspaceId: input.buyerWorkspaceId,
    };
  }

  /** Licenses held by one buyer workspace, enriched with asset names. */
  async listLicenses(workspaceId: string, filters: { assetType?: string | undefined; status?: string | undefined } = {}) {
    const query: Record<string, unknown> = { workspaceId: new Types.ObjectId(workspaceId) };
    if (filters.assetType === 'AGENT' || filters.assetType === 'WORKFLOW') query.assetType = filters.assetType;
    if (filters.status === 'ACTIVE' || filters.status === 'EXPIRED' || filters.status === 'REVOKED') {
      query.status = filters.status;
    }
    const licenses = await MarketplaceLicenseModel.find(query).sort({ updatedAt: -1 }).limit(100).lean();

    const agentIds = licenses.filter((license) => license.assetType === 'AGENT').map((license) => license.assetId);
    const workflowIds = licenses.filter((license) => license.assetType === 'WORKFLOW').map((license) => license.assetId);
    const [agents, workflowTemplates] = await Promise.all([
      agentIds.length > 0 ? AgentMarketplaceModel.find({ _id: { $in: agentIds } }).select('name').lean() : [],
      workflowIds.length > 0 ? WorkflowTemplateModel.find({ _id: { $in: workflowIds } }).select('name').lean() : [],
    ]);
    const agentNames = new Map(agents.map((row) => [row._id.toString(), row.name]));
    const workflowNames = new Map(workflowTemplates.map((row) => [row._id.toString(), row.name as string]));

    return licenses.map((license) => ({
      licenseId: license._id.toString(),
      assetType: license.assetType,
      assetId: license.assetId.toString(),
      assetName: license.assetType === 'AGENT'
        ? agentNames.get(license.assetId.toString()) ?? 'Unknown asset'
        : workflowNames.get(license.assetId.toString()) ?? 'Unknown asset',
      publisherId: license.publisherId.toString(),
      pricingModel: license.pricingModel,
      status: license.status,
      seats: license.seats,
      activatedAt: license.activatedAt.toISOString(),
      expiresAt: license.expiresAt ? license.expiresAt.toISOString() : null,
      lastRenewedAt: license.lastRenewedAt ? license.lastRenewedAt.toISOString() : null,
      transactionId: license.transactionId,
    }));
  }

  /**
   * Install gate: paid listings require an ACTIVE license in the buyer's
   * workspace. Called by agentMarketplaceService.installAgent before cloning.
   */
  async assertLicenseForInstall(listingId: string, workspaceId: string): Promise<void> {
    const assetId = new Types.ObjectId(listingId);
    const pricing = await MarketplacePricingModel.findOne({ assetType: 'AGENT', assetId }).lean();
    if (!pricing || pricing.status !== 'ACTIVE' || pricing.pricingModel === 'FREE' || pricing.price <= 0) {
      return;
    }
    const license = await MarketplaceLicenseModel.findOne({
      workspaceId: new Types.ObjectId(workspaceId),
      assetType: 'AGENT',
      assetId,
    });
    if (!license || license.status !== 'ACTIVE') throw new Error('LICENSE_REQUIRED');
    if (license.expiresAt && license.expiresAt.getTime() <= Date.now()) {
      await MarketplaceLicenseModel.updateOne({ _id: license._id }, { $set: { status: 'EXPIRED' } });
      throw new Error('LICENSE_REQUIRED');
    }
  }
}

export const agentMarketplaceBillingService = new AgentMarketplaceBillingService();
