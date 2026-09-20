import type { Request, Response, NextFunction } from 'express';
import { RegionService } from '../services/regionService.js';

export interface RegionRequest extends Request {
  targetRegion?: string;
  isCrossRegion?: boolean;
}

export function createRegionMiddleware(regionService: RegionService, currentRegion: string) {
  return async (req: RegionRequest, res: Response, next: NextFunction) => {
    try {
      // 1. Check custom header (e.g., x-region, x-tenant-region)
      let targetRegion = req.headers['x-region'] as string;

      // 2. If workspaceId is in params or query, look up its region
      const rawWorkspaceId = req.params?.workspaceId || req.query?.workspaceId;
      const workspaceId = typeof rawWorkspaceId === 'string' ? rawWorkspaceId : undefined;
      if (!targetRegion && workspaceId) {
        targetRegion = await regionService.getWorkspaceRegion(workspaceId);
      }

      // Default to current region if not specified
      targetRegion = targetRegion || currentRegion;
      req.targetRegion = targetRegion;
      req.isCrossRegion = targetRegion !== currentRegion;

      // If this is a cross-region request, we could add a header or log
      res.setHeader('X-Served-By-Region', currentRegion);
      res.setHeader('X-Target-Region', targetRegion);

      next();
    } catch (err) {
      next(err);
    }
  };
}
