import { Types } from 'mongoose';
import { SubscriptionModel } from '../models/SubscriptionModel.js';
import { PLAN_LIMITS } from '../models/PlanModel.js';
import type { PlanLimits } from '../models/PlanModel.js';
import type { SubscriptionPlan } from '../models/SubscriptionModel.js';
import { WorkspaceUsageModel } from '../models/WorkspaceUsageModel.js';
import { APIKeyModel } from '../models/APIKeyModel.js';
import { WebhookModel } from '../models/WebhookModel.js';
import { WorkflowModel } from '../models/WorkflowModel.js';

/**
 * Get the plan details for a workspace
 */
export async function getPlan(workspaceId: Types.ObjectId | string): Promise<{
  plan: SubscriptionPlan;
  status: string;
  limits: PlanLimits;
} | null> {
  const workspaceIdObj = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;
  const subscription = await SubscriptionModel.findOne({ workspaceId: workspaceIdObj });
  if (!subscription) {
    return null;
  }
  return {
    plan: subscription.plan as SubscriptionPlan,
    status: subscription.status,
    limits: PLAN_LIMITS[subscription.plan as SubscriptionPlan],
  };
}

/**
 * Compare limits between two plans
 * Returns true if first plan's limits are >= second plan's limits for all metrics
 */
export function comparePlanLimits(planA: SubscriptionPlan, planB: SubscriptionPlan): boolean {
  const limitsA = PLAN_LIMITS[planA];
  const limitsB = PLAN_LIMITS[planB];
  return (
    limitsA.workflows >= limitsB.workflows &&
    limitsA.executionsPerMonth >= limitsB.executionsPerMonth &&
    limitsA.apiKeys >= limitsB.apiKeys &&
    limitsA.webhooks >= limitsB.webhooks &&
    limitsA.members >= limitsB.members &&
    limitsA.storageBytes >= limitsB.storageBytes
  );
}

/**
 * Validate that a workspace is within its plan limits for a specific resource
 * Throws an error with code 'PLAN_LIMIT_EXCEEDED' if limit is exceeded
 */
export async function validateWorkspaceQuota(
  workspaceId: Types.ObjectId | string,
  resource: keyof PlanLimits,
  amount: number = 1
): Promise<void> {
  const planData = await getPlan(workspaceId);
  if (!planData) {
    // If no subscription exists for this workspace, do not enforce limits
    return;
  }

  const workspaceIdObj = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;

  // Get current usage from WorkspaceUsageModel (or compute from other models if needed)
  const usage = await WorkspaceUsageModel.findOne({ workspaceId: workspaceIdObj });

  let currentUsage = 0;
  if (usage) {
    switch (resource) {
      case 'workflows':
        currentUsage = usage.totalWorkflows;
        break;
      case 'executionsPerMonth':
        currentUsage = usage.monthlyExecutions;
        break;
      case 'apiKeys':
        currentUsage = await APIKeyModel.countDocuments({ workspaceId: workspaceIdObj, status: 'ACTIVE' });
        break;
      case 'webhooks':
        currentUsage = await WebhookModel.countDocuments({ workspaceId: workspaceIdObj, status: 'ACTIVE' });
        break;
      case 'members': {
        const { WorkspaceMemberModel } = await import('../models/WorkspaceMemberModel.js');
        currentUsage = await WorkspaceMemberModel.countDocuments({ workspaceId: workspaceIdObj, status: 'ACTIVE' });
        break;
      }
      case 'storageBytes':
        currentUsage = usage.storageUsed;
        break;
    }
  } else {
    // If no usage record, compute from scratch
    switch (resource) {
      case 'workflows':
        currentUsage = await WorkflowModel.countDocuments({ workspaceId: workspaceIdObj });
        break;
      case 'executionsPerMonth':
        currentUsage = 0;
        break;
      case 'apiKeys':
        currentUsage = await APIKeyModel.countDocuments({ workspaceId: workspaceIdObj, status: 'ACTIVE' });
        break;
      case 'webhooks':
        currentUsage = await WebhookModel.countDocuments({ workspaceId: workspaceIdObj, status: 'ACTIVE' });
        break;
      case 'members': {
        const { WorkspaceMemberModel } = await import('../models/WorkspaceMemberModel.js');
        currentUsage = await WorkspaceMemberModel.countDocuments({ workspaceId: workspaceIdObj, status: 'ACTIVE' });
        break;
      }
      case 'storageBytes':
        currentUsage = 0;
        break;
    }
  }

  const limit = planData.limits[resource];

  if (currentUsage + amount > limit) {
    const error = new Error('PLAN_LIMIT_EXCEEDED') as any;
    error.status = 403;
    error.code = 'PLAN_LIMIT_EXCEEDED';
    error.resource = resource;
    error.limit = limit;
    error.currentUsage = currentUsage;
    error.requestedAmount = amount;
    throw error;
  }
}
