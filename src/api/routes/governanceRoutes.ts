import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { getAuthUser } from '../../auth/auth.middleware.js';
import { governanceService } from '../../services/governanceService.js';
import { requirePermission, getWorkspaceContext } from '../middleware/requirePermission.js';

const policySchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  approvalRules: z.object({
    workflowTypes: z.array(z.string()).optional(),
    requiredRoles: z.array(z.string()).optional(),
    minApprovers: z.number().int().min(1).optional(),
    requireApprovalForPublish: z.boolean().optional(),
    requireApprovalForExecution: z.boolean().optional(),
  }).optional(),
  executionPolicies: z.object({
    maxConcurrentExecutions: z.number().int().min(1).optional(),
    maxExecutionTimeSeconds: z.number().int().min(1).optional(),
    allowedNodeTypes: z.array(z.string()).optional(),
    forbiddenNodeTypes: z.array(z.string()).optional(),
    rateLimitPerMinute: z.number().int().min(1).optional(),
  }).optional(),
  securityPolicies: z.object({
    requireMFA: z.boolean().optional(),
    allowedIPRanges: z.array(z.string()).optional(),
    sessionTimeoutMinutes: z.number().int().min(1).optional(),
    requireSecretEncryption: z.boolean().optional(),
  }).optional(),
  complianceRules: z.object({
    dataResidency: z.array(z.string()).optional(),
    encryptionAtRest: z.boolean().optional(),
    auditLogRetentionDays: z.number().int().min(1).optional(),
    gdprCompliant: z.boolean().optional(),
  }).optional(),
  isActive: z.boolean().optional(),
});

const approvalRequestSchema = z.object({
  policyId: z.string().optional(),
  workflowId: z.string().optional(),
  requestType: z.enum(['WORKFLOW_PUBLISH', 'WORKFLOW_EXECUTION', 'POLICY_CHANGE', 'DEPLOYMENT']),
  reason: z.string().max(1000).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

const approvalReviewSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  comments: z.string().max(1000).optional(),
});

export function createGovernanceRouter(): Router {
  const router = Router();

  // GET /api/v1/governance/policies - List policies
  router.get(
    '/policies',
    requirePermission('GOVERNANCE_READ', { useBodyWorkspace: true }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workspaceId = getWorkspaceContext(req).workspaceId;
        const policies = await governanceService.getPolicies(workspaceId);
        res.json({ policies });
      } catch (err) {
        next(err);
      }
    }
  );

  // POST /api/v1/governance/policies - Create policy
  router.post(
    '/policies',
    requirePermission('GOVERNANCE_MANAGE', { useBodyWorkspace: true }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workspaceId = getWorkspaceContext(req).workspaceId;
        const { userId } = getAuthUser(req);
        const parsed = policySchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid policy payload' } });
        }

        // Remove undefined properties to avoid issues with exactOptionalPropertyTypes
        const policyData = { ...parsed.data, workspaceId, description: parsed.data.description ?? '' };
        if (policyData.isActive === undefined) {
          delete policyData.isActive;
        }
        if (policyData.approvalRules === undefined) {
          delete policyData.approvalRules;
        } else {
          // Clean up undefined properties in nested approvalRules object
          if (policyData.approvalRules.workflowTypes === undefined) {
            delete policyData.approvalRules.workflowTypes;
          }
          if (policyData.approvalRules.requiredRoles === undefined) {
            delete policyData.approvalRules.requiredRoles;
          }
          if (policyData.approvalRules.minApprovers === undefined) {
            delete policyData.approvalRules.minApprovers;
          }
          if (policyData.approvalRules.requireApprovalForPublish === undefined) {
            delete policyData.approvalRules.requireApprovalForPublish;
          }
          if (policyData.approvalRules.requireApprovalForExecution === undefined) {
            delete policyData.approvalRules.requireApprovalForExecution;
          }
        }
        if (policyData.executionPolicies === undefined) {
          delete policyData.executionPolicies;
        } else {
          // Clean up undefined properties in nested executionPolicies object
          if (policyData.executionPolicies.maxConcurrentExecutions === undefined) {
            delete policyData.executionPolicies.maxConcurrentExecutions;
          }
          if (policyData.executionPolicies.maxExecutionTimeSeconds === undefined) {
            delete policyData.executionPolicies.maxExecutionTimeSeconds;
          }
          if (policyData.executionPolicies.allowedNodeTypes === undefined) {
            delete policyData.executionPolicies.allowedNodeTypes;
          }
          if (policyData.executionPolicies.forbiddenNodeTypes === undefined) {
            delete policyData.executionPolicies.forbiddenNodeTypes;
          }
          if (policyData.executionPolicies.rateLimitPerMinute === undefined) {
            delete policyData.executionPolicies.rateLimitPerMinute;
          }
        }
        if (policyData.securityPolicies === undefined) {
          delete policyData.securityPolicies;
        } else {
          // Clean up undefined properties in nested securityPolicies object
          if (policyData.securityPolicies.requireMFA === undefined) {
            delete policyData.securityPolicies.requireMFA;
          }
          if (policyData.securityPolicies.allowedIPRanges === undefined) {
            delete policyData.securityPolicies.allowedIPRanges;
          }
          if (policyData.securityPolicies.sessionTimeoutMinutes === undefined) {
            delete policyData.securityPolicies.sessionTimeoutMinutes;
          }
          if (policyData.securityPolicies.requireSecretEncryption === undefined) {
            delete policyData.securityPolicies.requireSecretEncryption;
          }
        }
        if (policyData.complianceRules === undefined) {
          delete policyData.complianceRules;
        } else {
          // Clean up undefined properties in nested complianceRules object
          if (policyData.complianceRules.dataResidency === undefined) {
            delete policyData.complianceRules.dataResidency;
          }
          if (policyData.complianceRules.encryptionAtRest === undefined) {
            delete policyData.complianceRules.encryptionAtRest;
          }
          if (policyData.complianceRules.auditLogRetentionDays === undefined) {
            delete policyData.complianceRules.auditLogRetentionDays;
          }
          if (policyData.complianceRules.gdprCompliant === undefined) {
            delete policyData.complianceRules.gdprCompliant;
          }
        }

        const policy = await governanceService.createPolicy(policyData, userId);
        res.status(201).json(policy);
      } catch (err) {
        next(err);
      }
    }
  );

  // GET /api/v1/governance/policies/:id - Get policy by ID
  router.get(
    '/policies/:id',
    requirePermission('GOVERNANCE_READ', { useBodyWorkspace: true }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = req.params.id as string | undefined;
        if (!id || !Types.ObjectId.isValid(id)) {
          return res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid policy ID' } });
        }

        const policy = await governanceService.getPolicyById(id);
        if (!policy) {
          return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Policy not found' } });
        }
        res.json(policy);
      } catch (err) {
        next(err);
      }
    }
  );

  // PATCH /api/v1/governance/policies/:id - Update policy
  router.patch(
    '/policies/:id',
    requirePermission('GOVERNANCE_MANAGE', { useBodyWorkspace: true }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = req.params.id as string | undefined;
        const { userId } = getAuthUser(req);
        if (!id || !Types.ObjectId.isValid(id)) {
          return res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid policy ID' } });
        }

        const parsed = policySchema.partial().safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid policy payload' } });
        }

        const updated = await governanceService.updatePolicy(id, parsed.data as any, userId);
        res.json(updated);
      } catch (err) {
        next(err);
      }
    }
  );

  // DELETE /api/v1/governance/policies/:id - Deactivate policy
  router.delete(
    '/policies/:id',
    requirePermission('GOVERNANCE_MANAGE', { useBodyWorkspace: true }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = req.params.id as string | undefined;
        const { userId } = getAuthUser(req);
        if (!id || !Types.ObjectId.isValid(id)) {
          return res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid policy ID' } });
        }

        await governanceService.deletePolicy(id, userId);
        res.json({ message: 'Policy successfully deactivated' });
      } catch (err) {
        next(err);
      }
    }
  );

  // POST /api/v1/governance/approvals - Create approval request
  router.post(
    '/approvals',
    requirePermission('WORKFLOW_CREATE', { useBodyWorkspace: true }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workspaceId = getWorkspaceContext(req).workspaceId;
        const { userId } = getAuthUser(req);
        const parsed = approvalRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid approval request' } });
        }

        const approval = await governanceService.createApprovalRequest(
          workspaceId,
          userId,
          parsed.data
        );
        res.status(201).json(approval);
      } catch (err) {
        next(err);
      }
    }
  );

  // GET /api/v1/governance/approvals - List approvals
  router.get(
    '/approvals',
    requirePermission('GOVERNANCE_READ', { useBodyWorkspace: true }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workspaceId = getWorkspaceContext(req).workspaceId;
        const status = req.query.status as string | undefined;
        const approvals = await governanceService.getApprovals(workspaceId, status);
        res.json({ approvals });
      } catch (err) {
        next(err);
      }
    }
  );

  // POST /api/v1/governance/approvals/:id/review - Review approval
  router.post(
    '/approvals/:id/review',
    requirePermission('GOVERNANCE_MANAGE', { useBodyWorkspace: true }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = req.params.id as string | undefined;
        const { userId } = getAuthUser(req);
        if (!id || !Types.ObjectId.isValid(id)) {
          return res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid approval ID' } });
        }

        const parsed = approvalReviewSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Status (APPROVED/REJECTED) is required' } });
        }

        const reviewed = await governanceService.reviewApprovalRequest(
          id,
          userId,
          parsed.data.status,
          parsed.data.comments
        );
        res.json(reviewed);
      } catch (err) {
        next(err);
      }
    }
  );

  // POST /api/v1/governance/evaluate - Evaluate workflow against policies
  router.post(
    '/evaluate',
    requirePermission('WORKFLOW_READ', { useBodyWorkspace: true }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workspaceId = getWorkspaceContext(req).workspaceId;
        const { workflow, action } = req.body;
        const evaluation = await governanceService.evaluateWorkflowApproval(
          workspaceId,
          workflow || {},
          action || 'PUBLISH'
        );
        res.json(evaluation);
      } catch (err) {
        next(err);
      }
    }
  );

  // GET /api/v1/governance/activity - Get governance activity/audit logs
  router.get(
    '/activity',
    requirePermission('AUDIT_READ', { useBodyWorkspace: true }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const workspaceId = getWorkspaceContext(req).workspaceId;
        const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
        const activity = await governanceService.getGovernanceActivity(workspaceId, limit);
        res.json({ activity });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}

export default createGovernanceRouter;