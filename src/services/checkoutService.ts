import { Types } from 'mongoose';
import { SubscriptionModel } from '../models/SubscriptionModel.js';
import type { SubscriptionPlan } from '../models/SubscriptionModel.js';
import { TenantAccountModel } from '../models/TenantAccountModel.js';
import { UserModel } from '../models/UserModel.js';
import { PaymentRecordModel } from '../models/PaymentRecordModel.js';
import { createBillingProvider, isBillingProviderName } from './billing/billingProviderRegistry.js';
import type { BillingPayment } from './billing/billingProvider.js';
import { billingService } from './billingService.js';
import { productPackagingService } from './productPackagingService.js';
import { featureEntitlementService } from './featureEntitlementService.js';
import type { EntitlementSummary } from './featureEntitlementService.js';
import { conversionTrackingService } from './conversionTrackingService.js';
import { createAuditLog } from './auditService.js';

/**
 * Phase 15.3 - Self-serve checkout.
 *
 * Plan selection -> provider checkout session -> payment verification ->
 * subscription activation -> entitlement refresh. Entitlements are derived from
 * the subscription by featureEntitlementService, so activating the plan IS the
 * entitlement update; the caller receives the evaluated summary so the client
 * can refresh immediately.
 */

export const CHECKOUT_RAILS = ['card', 'upi', 'google_pay', 'netbanking'] as const;
export type CheckoutRail = (typeof CHECKOUT_RAILS)[number];

/** Rails the active provider can accept. Razorpay covers the India rails. */
const PROVIDER_RAILS: Record<string, readonly CheckoutRail[]> = {
  mock: ['card'],
  stripe: ['card'],
  razorpay: ['card', 'upi', 'google_pay', 'netbanking'],
};

export function railsForProvider(provider: string): readonly CheckoutRail[] {
  return PROVIDER_RAILS[provider] ?? ['card'];
}

export interface CheckoutSessionView {
  id: string;
  clientSecret: string;
  status: string;
  provider: string;
  packageId: string;
  plan: SubscriptionPlan;
  amount: number;
  currency: string;
  rails: readonly CheckoutRail[];
}

export interface CheckoutVerificationResult {
  activated: boolean;
  alreadyActive: boolean;
  reason: 'ACTIVATED' | 'PAYMENT_NOT_SETTLED' | 'ALREADY_ON_PACKAGE';
  payment: BillingPayment;
  subscription: {
    plan: SubscriptionPlan;
    status: string;
    billingProvider: string;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
  } | null;
  entitlements: EntitlementSummary;
}

export interface CheckoutContext {
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}

export class CheckoutService {
  railsForProvider(provider: string): readonly CheckoutRail[] {
    return railsForProvider(provider);
  }

  /** Create a provider checkout session for a sellable package. */
  async createSession(input: {
    workspaceId: string;
    packageId: string;
    userId: string;
    provider?: string | undefined;
    currency?: string | undefined;
    context?: CheckoutContext | undefined;
  }): Promise<CheckoutSessionView> {
    const workspaceIdObj = new Types.ObjectId(input.workspaceId);
    const plan = await productPackagingService.getProductPlan(input.packageId);
    const subscription = await SubscriptionModel.findOne({ workspaceId: workspaceIdObj });
    if (!subscription) throw new Error('SUBSCRIPTION_NOT_FOUND');
    if (subscription.plan === plan.internalPlan) throw new Error('ALREADY_ON_PACKAGE');

    const providerName = input.provider && isBillingProviderName(input.provider)
      ? input.provider
      : subscription.billingProvider;
    const provider = createBillingProvider(providerName);

    let customerId = subscription.externalCustomerId;
    if (!customerId) {
      const tenant = await TenantAccountModel.findOne({ workspaceId: workspaceIdObj })
        .select('ownerUserId companyName')
        .lean();
      const owner = tenant ? await UserModel.findById(tenant.ownerUserId).select('email').lean() : null;
      const customer = await provider.createCustomer({
        email: owner?.email ?? 'billing@localhost',
        name: tenant?.companyName ?? `Workspace ${input.workspaceId}`,
        metadata: { workspaceId: input.workspaceId },
      });
      subscription.externalCustomerId = customer.id;
      await subscription.save();
      customerId = customer.id;
    }

    const currency = (input.currency ?? plan.currency).toLowerCase();
    const intent = await provider.createPaymentIntent({
      amount: plan.priceMonthly,
      currency,
      customerId,
      metadata: {
        workspaceId: input.workspaceId,
        packageId: plan.id,
        plan: plan.internalPlan,
      },
    });

    await createAuditLog({
      action: 'CHECKOUT_STARTED',
      userId: input.userId,
      workspaceId: workspaceIdObj,
      resource: 'subscription',
      resourceId: subscription._id.toString(),
      metadata: {
        provider: providerName,
        packageId: plan.id,
        plan: plan.internalPlan,
        amount: plan.priceMonthly,
        currency,
      },
      ...(input.context?.ipAddress !== undefined ? { ipAddress: input.context.ipAddress } : {}),
      ...(input.context?.userAgent !== undefined ? { userAgent: input.context.userAgent } : {}),
    });

    return {
      id: intent.id,
      clientSecret: intent.clientSecret,
      status: intent.status,
      provider: providerName,
      packageId: plan.id,
      plan: plan.internalPlan,
      amount: plan.priceMonthly,
      currency,
      rails: railsForProvider(providerName),
    };
  }

  /**
   * Verify a checkout payment and, only when it settled, activate the package.
   * Idempotent: a workspace already on the package reports alreadyActive.
   */
  async verifyAndActivate(input: {
    workspaceId: string;
    paymentId: string;
    packageId?: string | undefined;
    userId: string;
    context?: CheckoutContext | undefined;
  }): Promise<CheckoutVerificationResult> {
    const workspaceIdObj = new Types.ObjectId(input.workspaceId);
    const subscription = await SubscriptionModel.findOne({ workspaceId: workspaceIdObj });
    if (!subscription) throw new Error('SUBSCRIPTION_NOT_FOUND');

    const provider = createBillingProvider(subscription.billingProvider);
    const payment = await provider.verifyPayment({ paymentId: input.paymentId });

    const requestedPackageId = input.packageId ?? payment.metadata?.packageId ?? null;
    if (!requestedPackageId) throw new Error('INVALID_REQUEST');
    const plan = await productPackagingService.getProductPlan(requestedPackageId);

    let activated = false;
    let alreadyActive = subscription.plan === plan.internalPlan;
    let reason: CheckoutVerificationResult['reason'] = alreadyActive
      ? 'ALREADY_ON_PACKAGE'
      : 'PAYMENT_NOT_SETTLED';

    if (payment.paid && !alreadyActive) {
      await billingService.changeSubscription(workspaceIdObj, plan.internalPlan, true);
      await TenantAccountModel.updateOne(
        { workspaceId: workspaceIdObj },
        { $set: { plan: plan.internalPlan } },
      );
      activated = true;
      alreadyActive = true;
      reason = 'ACTIVATED';
    }

    await PaymentRecordModel.findOneAndUpdate(
      { provider: subscription.billingProvider, paymentId: payment.id },
      {
        $set: {
          workspaceId: workspaceIdObj,
          provider: subscription.billingProvider,
          paymentId: payment.id,
          customerId: payment.customerId,
          packageId: plan.id,
          plan: plan.internalPlan,
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

    if (activated) {
      await conversionTrackingService.recordSafely({
        event: 'SUBSCRIPTION_STARTED',
        workspaceId: input.workspaceId,
        userId: input.userId,
        plan: plan.internalPlan,
        packageId: plan.id,
        source: 'CHECKOUT',
      });
      await createAuditLog({
        action: 'CHECKOUT_COMPLETED',
        userId: input.userId,
        workspaceId: workspaceIdObj,
        resource: 'subscription',
        resourceId: subscription._id.toString(),
        metadata: {
          provider: subscription.billingProvider,
          paymentId: payment.id,
          packageId: plan.id,
          plan: plan.internalPlan,
          amount: payment.amount,
          currency: payment.currency,
          method: payment.method,
        },
        ...(input.context?.ipAddress !== undefined ? { ipAddress: input.context.ipAddress } : {}),
        ...(input.context?.userAgent !== undefined ? { userAgent: input.context.userAgent } : {}),
      });
    }

    const refreshed = await SubscriptionModel.findOne({ workspaceId: workspaceIdObj }).lean();
    return {
      activated,
      alreadyActive,
      reason,
      payment,
      subscription: refreshed
        ? {
            plan: refreshed.plan as SubscriptionPlan,
            status: refreshed.status,
            billingProvider: refreshed.billingProvider,
            currentPeriodStart: refreshed.currentPeriodStart,
            currentPeriodEnd: refreshed.currentPeriodEnd,
          }
        : null,
      entitlements: await featureEntitlementService.getSummary(workspaceIdObj),
    };
  }

  /** Verified payment history for the customer console. */
  async listPayments(workspaceId: string, limit?: number | undefined) {
    const workspaceIdObj = new Types.ObjectId(workspaceId);
    const safeLimit = typeof limit === 'number' && Number.isFinite(limit) && limit > 0
      ? Math.min(100, Math.floor(limit))
      : 24;
    return PaymentRecordModel.find({ workspaceId: workspaceIdObj })
      .sort({ createdAt: -1 })
      .limit(safeLimit)
      .lean();
  }
}

export const checkoutService = new CheckoutService();
