import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { requirePermission } from '../middleware/requirePermission.js';
import { SelfHealingService } from '../../services/selfHealingService.js';
import { SelfHealingDecisionService } from '../../services/selfHealingDecisionService.js';

const router = Router();
const selfHealingService = SelfHealingService.getInstance();
const decisionService = SelfHealingDecisionService.getInstance();

// List all policies for a workspace
router.get(
  '/policies',
  requirePermission('SELF_HEALING_READ'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      const policies = await selfHealingService.listPolicies(workspaceContext.workspaceId);
      res.json({ data: policies });
    } catch (err) {
      next(err);
    }
  }
);

// Create a new policy
router.post(
  '/policies',
  requirePermission('SELF_HEALING_MANAGE'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      const policy = await selfHealingService.createPolicy(workspaceContext.workspaceId, req.body);
      res.status(201).json({ data: policy });
    } catch (err) {
      next(err);
    }
  }
);

// Get a policy by ID
router.get(
  '/policies/:id',
  requirePermission('SELF_HEALING_READ'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      const rawId = req.params.id;
      const policyId = typeof rawId === 'string' ? rawId : '';
      const policy = await selfHealingService.getPolicyById(policyId, workspaceContext.workspaceId);
      if (!policy) {
        return res.status(404).json({ error: 'Policy not found' });
      }
      res.json({ data: policy });
    } catch (err) {
      next(err);
    }
  }
);

// Update a policy
router.put(
  '/policies/:id',
  requirePermission('SELF_HEALING_MANAGE'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      const rawId = req.params.id;
      const policyId = typeof rawId === 'string' ? rawId : '';
      const policy = await selfHealingService.updatePolicy(policyId, workspaceContext.workspaceId, req.body);
      if (!policy) {
        return res.status(404).json({ error: 'Policy not found' });
      }
      res.json({ data: policy });
    } catch (err) {
      next(err);
    }
  }
);

// Delete a policy
router.delete(
  '/policies/:id',
  requirePermission('SELF_HEALING_MANAGE'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      const rawId = req.params.id;
      const policyId = typeof rawId === 'string' ? rawId : '';
      const deleted = await selfHealingService.deletePolicy(policyId, workspaceContext.workspaceId);
      if (!deleted) {
        return res.status(404).json({ error: 'Policy not found' });
      }
      res.json({ message: 'Policy deleted successfully' });
    } catch (err) {
      next(err);
    }
  }
);

// List incidents
router.get(
  '/incidents',
  requirePermission('SELF_HEALING_READ'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const executionId = typeof req.query.executionId === 'string' ? req.query.executionId : undefined;
      const filters: { status?: string; executionId?: string } = {};
      if (status !== undefined) {
        filters.status = status;
      }
      if (executionId !== undefined) {
        filters.executionId = executionId;
      }
      const incidents = await selfHealingService.listIncidents(workspaceContext.workspaceId, filters);
      res.json({ data: incidents });
    } catch (err) {
      next(err);
    }
  }
);

// Get incident by ID
router.get(
  '/incidents/:id',
  requirePermission('SELF_HEALING_READ'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      const rawId = req.params.id;
      const incidentId = typeof rawId === 'string' ? rawId : '';
      const incident = await selfHealingService.getIncidentById(incidentId, workspaceContext.workspaceId);
      if (!incident) {
        return res.status(404).json({ error: 'Incident not found' });
      }
      res.json({ data: incident });
    } catch (err) {
      next(err);
    }
  }
);

// Trigger failure evaluation
router.post(
  '/evaluate/:executionId',
  requirePermission('SELF_HEALING_MANAGE'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      const rawId = req.params.executionId;
      const executionId = typeof rawId === 'string' ? rawId : '';
      const forceApproval = req.body?.forceApproval === true;
      const incident = await selfHealingService.evaluateExecutionFailure(
        executionId,
        workspaceContext.workspaceId,
        { forceApproval }
      );
      res.json({ data: incident });
    } catch (err) {
      next(err);
    }
  }
);

// Approve incident
router.post(
  '/incidents/:id/approve',
  requirePermission('SELF_HEALING_MANAGE'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      const rawId = req.params.id;
      const incidentId = typeof rawId === 'string' ? rawId : '';
      const token = req.body?.token;
      const incident = await selfHealingService.approveIncident(
        incidentId,
        workspaceContext.userId,
        token
      );
      res.json({ data: incident });
    } catch (err) {
      next(err);
    }
  }
);

// Reject incident
router.post(
  '/incidents/:id/reject',
  requirePermission('SELF_HEALING_MANAGE'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      const rawId = req.params.id;
      const incidentId = typeof rawId === 'string' ? rawId : '';
      const reason = req.body?.reason;
      const incident = await selfHealingService.rejectIncident(
        incidentId,
        workspaceContext.userId,
        reason
      );
      res.json({ data: incident });
    } catch (err) {
      next(err);
    }
  }
);


// ─── Phase 12.3: Decision Engine Endpoints ─────────────────────────────────────

// GET /api/v1/self-healing/executions/:id/recommendations
// Get AI-powered recovery recommendations for a failed execution
router.get(
  '/executions/:id/recommendations',
  requirePermission('SELF_HEALING_READ'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      const rawId = req.params.id;
      const executionId = typeof rawId === 'string' ? rawId : '';
      const recommendations = await decisionService.getRecommendations(
        executionId,
        workspaceContext.workspaceId,
      );
      res.json({ data: recommendations });
    } catch (err: any) {
      next(err);
    }
  },
);

// POST /api/v1/self-healing/executions/:id/apply
// Apply a recovery action to a failed execution
router.post(
  '/executions/:id/apply',
  requirePermission('SELF_HEALING_MANAGE'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      const rawId = req.params.id;
      const executionId = typeof rawId === 'string' ? rawId : '';
      const actionIndex = req.body?.actionIndex ?? 0;
      const result = await decisionService.applyRecovery(
        executionId,
        workspaceContext.workspaceId,
        actionIndex,
        workspaceContext.userId,
      );

      if (!result.success) {
        if (result.incidentId) {
          return res.status(403).json({
            error: result.error,
            incidentId: result.incidentId,
            requiresApproval: true,
          });
        }
        return res.status(400).json({ error: result.error });
      }

      res.json({
        data: {
          success: true,
          incidentId: result.incidentId,
          execution: result.execution,
        },
      });
    } catch (err: any) {
      next(err);
    }
  },
);

export default router;
