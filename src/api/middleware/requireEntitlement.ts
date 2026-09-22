import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { Types } from 'mongoose';
import { getAuthUser } from '../../auth/auth.middleware.js';
import { getWorkspaceContext, resolveTargetWorkspace } from './requirePermission.js';
import { featureEntitlementService } from '../../services/featureEntitlementService.js';
import type { FeatureKey } from '../../models/ProductPlanModel.js';
import { TenantAccountModel } from '../../models/TenantAccountModel.js';

/**
 * Phase 14.2 - Gate a route on a plan entitlement. Apply after a workspace guard
 * (requirePermission / requireMembership) so the workspace context exists.
 *
 * The authoritative matrix now lives in featureEntitlementService: it composes
 * the subscription plan, the sellable package limits and metered usage, and it
 * re-checks the RBAC permission that maps to the feature when a role is known.
 */
export function requireEntitlement(feature: FeatureKey): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const { workspaceId, role } = getWorkspaceContext(req);
      await featureEntitlementService.assertFeature(workspaceId, feature, { role });
      next();
    } catch (error) {
      next(error);
    }
  };
}

async function resolveActiveTenantWorkspaceId(req: Request): Promise<string> {
  try {
    return getWorkspaceContext(req).workspaceId;
  } catch {
    const { userId } = getAuthUser(req);
    return resolveTargetWorkspace(req, {}, userId);
  }
}

/**
 * Block workspace APIs for suspended or closed tenants. Runs before or after
 * the workspace guards - it resolves the workspace context itself when the
 * permission middleware has not run yet.
 */
export function requireActiveTenant(): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const workspaceId = await resolveActiveTenantWorkspaceId(req);
      const tenant = await TenantAccountModel.findOne({
        workspaceId: new Types.ObjectId(workspaceId),
      }).select('status').lean();
      if (tenant && (tenant.status === 'SUSPENDED' || tenant.status === 'CLOSED')) {
        next(new Error('TENANT_SUSPENDED'));
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
