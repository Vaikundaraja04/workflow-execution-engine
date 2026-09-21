import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { Types } from 'mongoose';
import { getAuthUser } from '../../auth/auth.middleware.js';
import { getWorkspaceContext, resolveTargetWorkspace } from './requirePermission.js';
import { billingService } from '../../services/billingService.js';
import { TenantAccountModel } from '../../models/TenantAccountModel.js';

/**
 * Gate a route on a plan entitlement. Apply after a workspace guard
 * (requirePermission / requireMembership) so the workspace context exists.
 */
export function requireEntitlement(feature: string): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const { workspaceId } = getWorkspaceContext(req);
      const entitled = await billingService.checkFeatureEntitlement(workspaceId, feature);
      if (!entitled) {
        next(new Error('FEATURE_NOT_ENTITLED'));
        return;
      }
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
