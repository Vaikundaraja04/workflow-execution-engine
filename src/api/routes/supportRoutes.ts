import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { isPlatformAdminEmail, requirePlatformAdmin } from '../middleware/platformAdmin.js';
import { authorizeRequest, getWorkspaceContext } from '../middleware/requirePermission.js';
import { getAuthUser } from '../../auth/auth.middleware.js';
import { supportService } from '../../services/supportService.js';
import { slaMonitoringService } from '../../services/slaMonitoringService.js';
import {
  SUPPORT_TICKET_CATEGORIES,
  SUPPORT_TICKET_PRIORITIES,
  SUPPORT_TICKET_STATUSES,
} from '../../models/SupportTicketModel.js';

/**
 * Phase 18.3 / 18.4 - Enterprise support API.
 *
 * Members raise and read tickets for their own workspace; platform
 * administrators see and manage every ticket. A foreign ticket always resolves
 * to 404, never 403 with data.
 */

const createTicketSchema = z.object({
  workspaceId: z.string().trim().min(1).optional(),
  subject: z.string().trim().min(3).max(200),
  description: z.string().trim().min(3).max(5000),
  category: z.enum(SUPPORT_TICKET_CATEGORIES).optional(),
  priority: z.enum(SUPPORT_TICKET_PRIORITIES).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  assigneeId: z.string().trim().min(1).nullable().optional(),
}).strict();

const updateTicketSchema = z.object({
  status: z.enum(SUPPORT_TICKET_STATUSES).optional(),
  priority: z.enum(SUPPORT_TICKET_PRIORITIES).optional(),
  assigneeId: z.string().trim().min(1).nullable().optional(),
  resolution: z.string().trim().max(5000).nullable().optional(),
  category: z.enum(SUPPORT_TICKET_CATEGORIES).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
}).strict();

const sweepSchema = z.object({
  workspaceId: z.string().trim().min(1).optional(),
}).strict();

const badRequest = (message: string) => ({ error: { code: 'INVALID_REQUEST', message } });
function isAdmin(req: Request): boolean {
  try {
    return isPlatformAdminEmail(getAuthUser(req).email);
  } catch {
    return false;
  }
}

/** The caller's own workspace: platform admins are handled by their callers. */
async function memberWorkspaceId(req: Request): Promise<string> {
  const outcome = await authorizeRequest(req, {});
  if (outcome === 'allow') return getWorkspaceContext(req).workspaceId;
  if (outcome === 'forbidden') throw new Error('FORBIDDEN');
  if (outcome === 'denied') throw new Error('PERMISSION_DENIED');
  throw new Error('WORKSPACE_NOT_FOUND');
}

function numberQuery(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}
export function createSupportRouter(): Router {
  const router = Router();

  router.post('/tickets', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = createTicketSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json(badRequest('Invalid request body'));
      const admin = isAdmin(req);
      let workspaceId: string;
      if (admin) {
        workspaceId = parsed.data.workspaceId ?? (await memberWorkspaceId(req));
      } else {
        const own = await memberWorkspaceId(req);
        if (parsed.data.workspaceId !== undefined && parsed.data.workspaceId !== own) {
          throw new Error('WORKSPACE_NOT_FOUND');
        }
        workspaceId = own;
      }
      const ticket = await supportService.createTicket(
        { ...parsed.data, workspaceId },
        getAuthUser(req).userId,
      );
      res.status(201).json({ data: ticket });
    } catch (err) { next(err); }
  });
  router.get('/tickets', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const admin = isAdmin(req);
      const requestedWorkspace = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;
      let workspaceId: string | undefined;
      if (admin) {
        workspaceId = requestedWorkspace;
      } else {
        const own = await memberWorkspaceId(req);
        if (requestedWorkspace !== undefined && requestedWorkspace !== own) {
          throw new Error('WORKSPACE_NOT_FOUND');
        }
        workspaceId = own;
      }
      const breached = req.query.breached === undefined
        ? undefined
        : req.query.breached === 'true' || req.query.breached === '1';
      const status = oneOf(req.query.status, SUPPORT_TICKET_STATUSES);
      const priority = oneOf(req.query.priority, SUPPORT_TICKET_PRIORITIES);
      const page = numberQuery(req.query.page);
      const limit = numberQuery(req.query.limit);
      const result = await supportService.listTickets({
        ...(workspaceId !== undefined ? { workspaceId } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(priority !== undefined ? { priority } : {}),
        ...(typeof req.query.assigneeId === 'string' ? { assigneeId: req.query.assigneeId } : {}),
        ...(breached !== undefined ? { breached } : {}),
        ...(page !== undefined ? { page } : {}),
        ...(limit !== undefined ? { limit } : {}),
      });
      res.json({ data: result });
    } catch (err) { next(err); }
  });
  router.get('/tickets/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ticket = await supportService.getTicket(req.params.id as string);
      if (!isAdmin(req)) {
        const own = await memberWorkspaceId(req);
        if (ticket.workspaceId !== own) throw new Error('TICKET_NOT_FOUND');
      }
      res.json({ data: ticket });
    } catch (err) { next(err); }
  });

  router.patch('/tickets/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = updateTicketSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json(badRequest('Invalid request body'));
      const ticket = await supportService.getTicket(req.params.id as string);
      if (!isAdmin(req)) {
        const own = await memberWorkspaceId(req);
        if (ticket.workspaceId !== own) throw new Error('TICKET_NOT_FOUND');
      }
      const updated = await supportService.updateTicket(
        req.params.id as string,
        parsed.data,
        getAuthUser(req).userId,
      );
      res.json({ data: updated });
    } catch (err) { next(err); }
  });
  router.get('/sla', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const admin = isAdmin(req);
      const requestedWorkspace = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;
      let workspaceId: string | undefined;
      if (admin) {
        workspaceId = requestedWorkspace;
      } else {
        const own = await memberWorkspaceId(req);
        if (requestedWorkspace !== undefined && requestedWorkspace !== own) {
          throw new Error('WORKSPACE_NOT_FOUND');
        }
        workspaceId = own;
      }
      const [policies, breaches] = await Promise.all([
        slaMonitoringService.listPolicies({}),
        slaMonitoringService.breachedTickets(workspaceId, 50),
      ]);
      res.json({ data: { policies, breaches, generatedAt: new Date().toISOString() } });
    } catch (err) { next(err); }
  });

  router.post('/sla/sweep', requirePlatformAdmin(), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = sweepSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json(badRequest('Invalid request body'));
      const result = await slaMonitoringService.sweep({
        ...(parsed.data.workspaceId !== undefined ? { workspaceId: parsed.data.workspaceId } : {}),
        actorUserId: getAuthUser(req).userId,
      });
      res.json({ data: result });
    } catch (err) { next(err); }
  });

  return router;
}