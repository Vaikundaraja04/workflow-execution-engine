import { Router } from 'express';
import type { IPredictionAlert } from '../../models/PredictionAlertModel.js';
import type { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import { requirePermission } from '../middleware/requirePermission.js';
import { PredictiveIntelligenceService, type PredictionType } from '../../services/predictiveIntelligenceService.js';

const router = Router();
const predictiveService = PredictiveIntelligenceService.getInstance();

// GET /api/v1/predictive-intelligence/failures
router.get(
  '/failures',
  requirePermission('PREDICTIVE_INTELLIGENCE_READ'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      const horizon = (req.query.horizon as string) || '24h';
      const workflowId = typeof req.query.workflowId === 'string' ? req.query.workflowId : undefined;

      const result = await predictiveService.predictFailureProbability({
        workspaceId: workspaceContext.workspaceId,
        ...(workflowId ? { workflowId } : {}),
        horizon: horizon as any,
      });

      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/predictive-intelligence/performance
router.get(
  '/performance',
  requirePermission('PREDICTIVE_INTELLIGENCE_READ'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      const horizon = (req.query.horizon as string) || '24h';
      const workflowId = typeof req.query.workflowId === 'string' ? req.query.workflowId : undefined;

      const result = await predictiveService.predictPerformance({
        workspaceId: workspaceContext.workspaceId,
        ...(workflowId ? { workflowId } : {}),
        horizon: horizon as any,
      });

      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/predictive-intelligence/capacity
router.get(
  '/capacity',
  requirePermission('PREDICTIVE_INTELLIGENCE_READ'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      const horizon = (req.query.horizon as string) || '24h';

      const result = await predictiveService.predictCapacity({
        workspaceId: workspaceContext.workspaceId,
        horizon: horizon as any,
      });

      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/predictive-intelligence/cost
router.get(
  '/cost',
  requirePermission('PREDICTIVE_INTELLIGENCE_READ'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      const horizon = (req.query.horizon as string) || '24h';

      const result = await predictiveService.predictCost({
        workspaceId: workspaceContext.workspaceId,
        horizon: horizon as any,
      });

      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/predictive-intelligence/alerts
router.get(
  '/alerts',
  requirePermission('PREDICTIVE_INTELLIGENCE_READ'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      const filters: {
        type?: PredictionType;
        severity?: IPredictionAlert['severity'];
        status?: 'active' | 'acknowledged' | 'resolved' | 'dismissed';
        startTime?: Date;
        endTime?: Date;
      } = {};

      if (typeof req.query.type === 'string') filters.type = req.query.type as PredictionType;
      if (typeof req.query.severity === 'string') filters.severity = req.query.severity as IPredictionAlert['severity'];
      if (typeof req.query.status === 'string') filters.status = req.query.status as 'active' | 'acknowledged' | 'resolved' | 'dismissed';
      if (typeof req.query.startTime === 'string') filters.startTime = new Date(req.query.startTime);
      if (typeof req.query.endTime === 'string') filters.endTime = new Date(req.query.endTime);

      const alerts = await predictiveService.getAlerts(workspaceContext.workspaceId, filters);
      res.json({ data: alerts });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/predictive-intelligence/alerts/:id/acknowledge
router.post(
  '/alerts/:id/acknowledge',
  requirePermission('PREDICTIVE_INTELLIGENCE_MANAGE'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      const rawId = req.params.id;
      const alertId = typeof rawId === 'string' ? rawId : '';
      const { note } = req.body;

      const alert = await predictiveService.acknowledgeAlert(alertId, workspaceContext.userId, note);
      if (!alert) {
        return res.status(404).json({ error: 'Alert not found' });
      }

      res.json({ data: alert });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/predictive-intelligence/alerts/:id/resolve
router.post(
  '/alerts/:id/resolve',
  requirePermission('PREDICTIVE_INTELLIGENCE_MANAGE'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      const rawId = req.params.id;
      const alertId = typeof rawId === 'string' ? rawId : '';

      const alert = await predictiveService.resolveAlert(alertId, workspaceContext.userId);
      if (!alert) {
        return res.status(404).json({ error: 'Alert not found' });
      }

      res.json({ data: alert });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/predictive-intelligence/alerts/:id/dismiss
router.post(
  '/alerts/:id/dismiss',
  requirePermission('PREDICTIVE_INTELLIGENCE_MANAGE'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawId = req.params.id;
      const alertId = typeof rawId === 'string' ? rawId : '';

      const alert = await predictiveService.dismissAlert(alertId);
      if (!alert) {
        return res.status(404).json({ error: 'Alert not found' });
      }

      res.json({ data: alert });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/predictive-intelligence/run-cycle
router.post(
  '/run-cycle',
  requirePermission('PREDICTIVE_INTELLIGENCE_MANAGE'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;

      const result = await predictiveService.runFullPredictionCycle(workspaceContext.workspaceId);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
