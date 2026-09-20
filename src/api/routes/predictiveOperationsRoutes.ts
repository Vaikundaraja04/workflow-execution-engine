import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import { requirePermission } from '../middleware/requirePermission.js';
import { PredictiveOperationsService, type AnomalyType, type SeverityLevel } from '../../services/predictiveOperationsService.js';
import { AutonomousOptimizerService } from '../../services/autonomousOptimizerService.js';

const router = Router();
const predictiveService = PredictiveOperationsService.getInstance();
const optimizerService = AutonomousOptimizerService.getInstance();

// List anomalies for a workspace
router.get(
  '/anomalies',
  requirePermission('OPERATIONS_READ'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      const filters: {
        workflowId?: Types.ObjectId | string;
        anomalyType?: AnomalyType;
        severity?: SeverityLevel;
        isAcknowledged?: boolean;
        startTime?: Date;
        endTime?: Date;
      } = {};

      if (typeof req.query.workflowId === 'string') {
        filters.workflowId = req.query.workflowId;
      }
      if (typeof req.query.anomalyType === 'string') {
        filters.anomalyType = req.query.anomalyType as AnomalyType;
      }
      if (typeof req.query.severity === 'string') {
        filters.severity = req.query.severity as SeverityLevel;
      }
      if (req.query.isAcknowledged === 'true' || req.query.isAcknowledged === 'false') {
        filters.isAcknowledged = req.query.isAcknowledged === 'true';
      }
      if (typeof req.query.startTime === 'string') {
        filters.startTime = new Date(req.query.startTime);
      }
      if (typeof req.query.endTime === 'string') {
        filters.endTime = new Date(req.query.endTime);
      }

      const anomalies = await predictiveService.getAnomalies(workspaceContext.workspaceId, filters);
      res.json({ data: anomalies });
    } catch (err) {
      next(err);
    }
  }
);

// Create a new anomaly record
router.post(
  '/anomalies',
  requirePermission('OPERATIONS_MANAGE'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      const {
        workflowId,
        executionId,
        anomalyType,
        severity,
        confidenceScore,
        metrics,
        predictedFailureTime,
        recommendedActions,
      } = req.body;

      if (!workflowId || !executionId || !anomalyType || !severity || confidenceScore === undefined || !predictedFailureTime) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const anomaly = await predictiveService.createAnomaly({
        workspaceId: workspaceContext.workspaceId,
        workflowId,
        executionId,
        anomalyType,
        severity,
        confidenceScore: Number(confidenceScore),
        metrics: metrics || {},
        predictedFailureTime: new Date(predictedFailureTime),
        recommendedActions: Array.isArray(recommendedActions) ? recommendedActions : [],
      });

      res.status(201).json({ data: anomaly });
    } catch (err) {
      next(err);
    }
  }
);

// Acknowledge an anomaly
router.patch(
  '/anomalies/:id/acknowledge',
  requirePermission('OPERATIONS_MANAGE'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      const rawId = req.params.id;
      const anomalyId = typeof rawId === 'string' ? rawId : '';

      const anomaly = await predictiveService.acknowledgeAnomaly(anomalyId, workspaceContext.userId);
      if (!anomaly) {
        return res.status(404).json({ error: 'Anomaly not found' });
      }

      res.json({ data: anomaly });
    } catch (err) {
      next(err);
    }
  }
);

// Delete an anomaly
router.delete(
  '/anomalies/:id',
  requirePermission('OPERATIONS_MANAGE'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawId = req.params.id;
      const anomalyId = typeof rawId === 'string' ? rawId : '';

      const deleted = await predictiveService.deleteAnomaly(anomalyId);
      if (!deleted) {
        return res.status(404).json({ error: 'Anomaly not found' });
      }

      res.json({ message: 'Anomaly deleted successfully' });
    } catch (err) {
      next(err);
    }
  }
);

// Analyze workflow for optimizations
router.get(
  '/workflows/:workflowId/optimizations',
  requirePermission('OPERATIONS_READ'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawWfId = req.params.workflowId;
      const workflowId = typeof rawWfId === 'string' ? rawWfId : '';

      const optimizationResult = await optimizerService.analyzeWorkflow(workflowId);
      res.json({ data: optimizationResult });
    } catch (err) {
      next(err);
    }
  }
);

// Apply optimizations to workflow
router.post(
  '/workflows/:workflowId/optimizations/apply',
  requirePermission('OPERATIONS_MANAGE'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawWfId = req.params.workflowId;
      const workflowId = typeof rawWfId === 'string' ? rawWfId : '';
      const { optimizations } = req.body;

      if (!Array.isArray(optimizations)) {
        return res.status(400).json({ error: 'Optimizations must be an array' });
      }

      const updatedWorkflowId = await optimizerService.applyOptimizations(workflowId, optimizations);
      res.json({ data: { workflowId: updatedWorkflowId } });
    } catch (err) {
      next(err);
    }
  }
);

export default router;