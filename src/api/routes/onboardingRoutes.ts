import { Router } from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { onboardingService } from '../../services/onboardingService.js';
import { requireMembership, requirePermission, getWorkspaceContext } from '../middleware/requirePermission.js';
import { requireActiveTenant } from '../middleware/requireEntitlement.js';
import { getAuthUser } from '../../auth/auth.middleware.js';
import { INDUSTRIES } from '../../models/LeadModel.js';
import { SOLUTION_IDS } from '../../services/solutionTemplateService.js';

/**
 * Phase 15.5 - Onboarding wizard API.
 *
 * Every route is workspace-scoped: the caller must be an active member, and the
 * steps that create or invite resources additionally require the matching RBAC
 * permission (WORKFLOW_CREATE for workflows and solution installs, MEMBER_MANAGE
 * for invitations).
 */

const industrySchema = z.object({ industry: z.enum(INDUSTRIES) }).strict();
const solutionSchema = z.object({ solutionId: z.enum(SOLUTION_IDS).optional() }).strict();
const workflowSchema = z.object({ name: z.string().trim().min(1).max(120).optional() }).strict();
const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  role: z.enum(['ADMIN', 'EDITOR', 'VIEWER']).optional(),
}).strict();

const badRequest = (message: string) => ({ error: { code: 'INVALID_REQUEST', message } });

export function createOnboardingRouter(requireAuth: RequestHandler): Router {
  const router = Router();
  const memberGuard = [requireAuth, requireActiveTenant(), requireMembership()] as RequestHandler[];

  router.post('/start', memberGuard, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId } = getWorkspaceContext(req);
      const result = await onboardingService.startOnboarding(workspaceId, getAuthUser(req).userId);
      res.status(result.created ? 201 : 200).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get('/status', memberGuard, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId } = getWorkspaceContext(req);
      res.json(await onboardingService.getProgress(workspaceId));
    } catch (error) {
      next(error);
    }
  });

  router.post('/industry', memberGuard, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = industrySchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json(badRequest('Invalid request body'));
      const { workspaceId } = getWorkspaceContext(req);
      res.json(await onboardingService.selectIndustry(workspaceId, getAuthUser(req).userId, parsed.data.industry));
    } catch (error) {
      next(error);
    }
  });

  router.post('/solution', memberGuard, requirePermission('WORKFLOW_CREATE'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = solutionSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json(badRequest('Invalid request body'));
      const { workspaceId } = getWorkspaceContext(req);
      res.json(await onboardingService.installRecommendedSolution(
        workspaceId,
        getAuthUser(req).userId,
        parsed.data.solutionId,
      ));
    } catch (error) {
      next(error);
    }
  });

  router.post('/workflow', memberGuard, requirePermission('WORKFLOW_CREATE'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = workflowSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json(badRequest('Invalid request body'));
      const { workspaceId } = getWorkspaceContext(req);
      res.status(201).json(await onboardingService.createFirstWorkflow(
        workspaceId,
        getAuthUser(req).userId,
        parsed.data.name,
      ));
    } catch (error) {
      next(error);
    }
  });

  router.post('/invite', memberGuard, requirePermission('MEMBER_MANAGE'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = inviteSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json(badRequest('Invalid request body'));
      const { workspaceId } = getWorkspaceContext(req);
      res.status(201).json(await onboardingService.inviteTeamMember(workspaceId, getAuthUser(req).userId, {
        email: parsed.data.email,
        role: parsed.data.role,
      }));
    } catch (error) {
      next(error);
    }
  });

  router.post('/complete', memberGuard, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId } = getWorkspaceContext(req);
      res.json(await onboardingService.completeOnboarding(workspaceId, getAuthUser(req).userId));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
