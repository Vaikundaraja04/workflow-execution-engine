import { Types } from 'mongoose';
import { SubscriptionModel } from '../models/SubscriptionModel.js';
import { PlanModel, PLAN_LIMITS, DEFAULT_PLANS } from '../models/PlanModel.js';
import { WorkspaceUsageModel } from '../models/WorkspaceUsageModel.js';
import { MockBillingProvider } from './billing/mockBillingProvider.js';
import { getPlan, comparePlanLimits, validateWorkspaceQuota } from './planService.js';
import { WorkspaceModel } from '../models/WorkspaceModel.js';
import { createAuditLog } from './auditService.js';

/**
 * Billing Service
 * Encapsulates billing provider logic and subscription management
 */
export class BillingService {
  private billingProvider: MockBillingProvider;

  constructor() {
    this.billingProvider = new MockBillingProvider();
  }

  /**
   * Subscribe a workspace to a plan
   * @param workspaceId - The workspace ID
   * @param plan - The plan to subscribe to (FREE, STARTER, PROFESSIONAL, ENTERPRISE)
   * @param billingProvider - The billing provider to use (e.g., 'stripe', 'mock')
   * @returns The created subscription
   */
  async subscribeWorkspace(
    workspaceId: Types.ObjectId | string,
    plan: 'FREE' | 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE',
    billingProvider: string = 'mock'
  ) {
    const workspaceIdObj = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;

    // Check if workspace already has a subscription
    const existingSubscription = await SubscriptionModel.findOne({ workspaceId: workspaceIdObj });
    if (existingSubscription) {
      throw new Error('Workspace already has an active subscription');
    }

    // Ensure default plans exist
    await this.ensureDefaultPlans();

    // Get plan details
    const planDoc = await PlanModel.findOne({ id: plan });
    if (!planDoc) {
      throw new Error(`Invalid plan: ${plan}`);
    }

    // Create customer in billing system
    const workspace = await WorkspaceModel.findById(workspaceIdObj);
    if (!workspace) {
      throw new Error('Workspace not found');
    }

    const customer = await this.billingProvider.createCustomer({
      email: `workspace-${workspaceIdObj}@example.com`,
      name: workspace.name,
      metadata: { workspaceId: workspaceIdObj.toString() }
    });

    // Create subscription in billing system
    // In a real implementation, we would map our plan to a price ID from the billing provider
    const priceId = this.getPriceIdForPlan(plan, billingProvider);
    const subscription = await this.billingProvider.createSubscription({
      customerId: customer.id,
      priceId,
      metadata: { workspaceId: workspaceIdObj.toString(), plan }
    });

    // Create our subscription record
    const newSubscription = await SubscriptionModel.create({
      workspaceId: workspaceIdObj,
      plan,
      status: 'ACTIVE', // Assuming immediate activation
      billingProvider,
      externalCustomerId: customer.id,
      externalSubscriptionId: subscription.id,
      currentPeriodStart: new Date(subscription.currentPeriodStart * 1000),
      currentPeriodEnd: new Date(subscription.currentPeriodEnd * 1000),
      trialEndsAt: subscription.trialEnd ? new Date(subscription.trialEnd * 1000) : null
    });

    // Create audit log
    await createAuditLog({
      action: 'SUBSCRIPTION_CREATED',
      workspaceId: workspaceIdObj,
      resource: 'subscription',
      resourceId: newSubscription._id.toString(),
      metadata: {
        externalSubscriptionId: subscription.id,
        externalCustomerId: customer.id,
        plan: newSubscription.plan,
        status: newSubscription.status
      }
    });

    return newSubscription;
  }

  /**
   * Upgrade subscription to a higher plan
   * @param workspaceId - The workspace ID
   * @param newPlan - The plan to upgrade to
   * @returns The updated subscription
   */
  async upgradeSubscription(
    workspaceId: Types.ObjectId | string,
    newPlan: 'FREE' | 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE'
  ) {
    return this.changeSubscription(workspaceId, newPlan, true);
  }

  /**
   * Downgrade subscription to a lower plan (effective at period end)
   * @param workspaceId - The workspace ID
   * @param newPlan - The plan to downgrade to
   * @returns The updated subscription
   */
  async downgradeSubscription(
    workspaceId: Types.ObjectId | string,
    newPlan: 'FREE' | 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE'
  ) {
    return this.changeSubscription(workspaceId, newPlan, false);
  }

  /**
   * Change subscription plan (internal method)
   * @param workspaceId - The workspace ID
   * @param newPlan - The new plan
   * @param prorate - Whether to prorate the change (immediate) or wait until period end
   * @returns The updated subscription
   */
  async changeSubscription(
    workspaceId: Types.ObjectId | string,
    newPlan: 'FREE' | 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE',
    prorate: boolean = true
  ) {
    const workspaceIdObj = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;

    const subscription = await SubscriptionModel.findOne({ workspaceId: workspaceIdObj });
    if (!subscription) {
      throw new Error('Subscription not found');
    }

    if (subscription.plan === newPlan) {
      throw new Error('Already subscribed to this plan');
    }

    // Validate new plan exists
    const planDoc = await PlanModel.findOne({ id: newPlan });
    if (!planDoc) {
      throw new Error(`Invalid plan: ${newPlan}`);
    }

    // For downgrades, check if current usage fits within new plan limits
    if (this.isPlanDowngrade(subscription.plan, newPlan)) {
      const usage = await WorkspaceUsageModel.findOne({ workspaceId: workspaceIdObj });
      const limits = PLAN_LIMITS[newPlan as keyof typeof PLAN_LIMITS];
      if (usage && limits) {
        if (
          usage.totalWorkflows > limits.workflows ||
          usage.monthlyExecutions > limits.executionsPerMonth ||
          usage.storageUsed > limits.storageBytes
        ) {
          throw new Error('Current usage exceeds limits of the target plan');
        }
      }
    }

    // Update subscription in billing system
    const newPriceId = this.getPriceIdForPlan(newPlan, subscription.billingProvider);
    const updatedSubscription = await this.billingProvider.changeSubscription({
      subscriptionId: subscription.externalSubscriptionId,
      newPriceId,
      prorate
    });

    // Update our subscription record
    subscription.plan = newPlan;
    subscription.status = 'ACTIVE'; // Assuming change keeps it active
    // Note: In a real implementation, we would update the period dates from the billing provider
    await subscription.save();

    // Create audit log
    await createAuditLog({
      action: 'SUBSCRIPTION_CHANGED',
      workspaceId: workspaceIdObj,
      resource: 'subscription',
      resourceId: subscription._id.toString(),
      metadata: {
        previousPlan: subscription.plan, // This is the old plan before save, but we changed it above
        newPlan: newPlan,
        prorate
      }
    });

    // Fetch the subscription again to get the updated plan (since we changed it above)
    const refreshedSubscription = await SubscriptionModel.findById(subscription._id);
    return refreshedSubscription;
  }

  /**
   * Cancel subscription
   * @param workspaceId - The workspace ID
   * @param immediate - Whether to cancel immediately or at period end
   * @returns The updated subscription
   */
  async cancelSubscription(
    workspaceId: Types.ObjectId | string,
    immediate: boolean = false
  ) {
    const workspaceIdObj = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;

    const subscription = await SubscriptionModel.findOne({ workspaceId: workspaceIdObj });
    if (!subscription) {
      throw new Error('Subscription not found');
    }

    if (subscription.status === 'CANCELLED' || subscription.status === 'EXPIRED') {
      throw new Error('Subscription is already cancelled or expired');
    }

    // Cancel in billing system
    const updatedSubscription = await this.billingProvider.cancelSubscription({
      subscriptionId: subscription.externalSubscriptionId,
      cancelAtPeriodEnd: !immediate
    });

    // Update our subscription record
    subscription.status = 'CANCELLED';
    await subscription.save();

    // Create audit log
    await createAuditLog({
      action: 'SUBSCRIPTION_CANCELLED',
      workspaceId: workspaceIdObj,
      resource: 'subscription',
      resourceId: subscription._id.toString(),
      metadata: {
        externalSubscriptionId: subscription.externalSubscriptionId,
        immediate
      }
    });

    return subscription;
  }

  /**
   * Get subscription for a workspace
   * @param workspaceId - The workspace ID
   * @returns The subscription or null if not found
   */
  async getSubscription(workspaceId: Types.ObjectId | string) {
    const workspaceIdObj = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;
    return SubscriptionModel.findOne({ workspaceId: workspaceIdObj });
  }

  /**
   * Get current usage and plan for a workspace
   * @param workspaceId - The workspace ID
   * @returns Usage and plan object or null if not found
   */
  async getUsage(workspaceId: Types.ObjectId | string) {
    const workspaceIdObj = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;
    const planData = await getPlan(workspaceIdObj.toString());
    if (!planData) {
      return null;
    }
    const usage = await WorkspaceUsageModel.findOne({ workspaceId: workspaceIdObj });
    const usageData = usage ?? {
      totalWorkflows: 0,
      totalExecutions: 0,
      successfulExecutions: 0,
      monthlyExecutions: 0,
      monthKey: '',
      successRate: 0,
      averageExecutionTime: 0,
      storageUsed: 0,
    };
    return {
      ...planData,
      usage: {
        executionsThisMonth: usageData.monthlyExecutions,
      }
    };
  }

  /**
   * Check if a workspace has entitlement for a feature
   * @param workspaceId - The workspace ID
   * @param feature - The feature to check (e.g., 'advanced analytics', 'custom webhooks')
   * @returns Boolean indicating if the feature is entitled
   */
  async checkFeatureEntitlement(
    workspaceId: Types.ObjectId | string,
    feature: string
  ): Promise<boolean> {
    const workspaceIdObj = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;
    const subscription = await this.getSubscription(workspaceIdObj);
    if (!subscription) {
      return false;
    }

    const planDoc = await PlanModel.findOne({ id: subscription.plan });
    if (!planDoc) {
      return false;
    }

    return planDoc.features.includes(feature);
  }

  /**
   * Record usage for a workspace (optional usage-based billing)
   * @param workspaceId - The workspace ID
   * @param metric - The metric to increment (e.g., 'executions', 'storage')
   * @param quantity - The amount to increment by
   */
  async recordUsage(
    workspaceId: Types.ObjectId | string,
    metric: string,
    quantity: number = 1
  ) {
    // In a real implementation, this would send usage data to the billing provider
    // For now, we'll just log it (or we could store in a separate usage collection)
    console.log(`Recording usage for workspace ${workspaceId}: ${metric} += ${quantity}`);
    // TODO: Implement actual usage recording if needed for billing
  }

  /**
   * Ensure default plans exist in the database
   */
  private async ensureDefaultPlans() {
    const count = await PlanModel.countDocuments();
    if (count === 0) {
      await PlanModel.insertMany(Object.values(DEFAULT_PLANS));
    }
  }

  /**
   * Get the price ID for a plan from the billing provider
   * In a real implementation, this would map our internal plan IDs to provider price IDs
   * @param plan - The internal plan ID
   * @param billingProvider - The billing provider name
   * @returns The price ID for the billing provider
   */
  private getPriceIdForPlan(
    plan: 'FREE' | 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE',
    billingProvider: string
  ): string {
    // Mock implementation - in reality, we'd have a mapping stored somewhere
    const priceMap: Record<string, Record<string, string>> = {
      mock: {
        FREE: 'price_free_mock',
        STARTER: 'price_starter_mock',
        PROFESSIONAL: 'price_professional_mock',
        ENTERPRISE: 'price_enterprise_mock'
      }
      // In production, we'd have actual Stripe/Razorpay price IDs
    };

    const mockMap = priceMap['mock'] ?? {};
    return priceMap[billingProvider]?.[plan] || mockMap[plan] || 'price_default';
  }

  /**
   * Check if changing from oldPlan to newPlan is a downgrade
   * @param oldPlan - The current plan
   * @param newPlan - The target plan
   * @returns True if it's a downgrade
   */
  private isPlanDowngrade(
    oldPlan: 'FREE' | 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE',
    newPlan: 'FREE' | 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE'
  ): boolean {
    const planOrder: Record<'FREE' | 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE', number> = {
      FREE: 0,
      STARTER: 1,
      PROFESSIONAL: 2,
      ENTERPRISE: 3
    };

    return planOrder[oldPlan] > planOrder[newPlan];
  }
}

// Export a singleton instance
export const billingService = new BillingService();