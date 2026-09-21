import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { requirePermission } from '../middleware/requirePermission.js';
import { AgentService } from '../../services/agent/agentService.js';
import { AgentExecutionService } from '../../services/agent/agentExecutionService.js';
import { AgentToolPolicyService } from '../../services/agent/agentToolPolicyService.js';
import { ApprovalService } from '../../services/agent/approvalService.js';
import { AgentRunModel } from '../../models/AgentRunModel.js';
import { Types } from 'mongoose';

const router = Router();
const agentService = AgentService.getInstance();
const executionService = AgentExecutionService.getInstance();
const policyService = AgentToolPolicyService.getInstance();
const approvalService = ApprovalService.getInstance();

function ctx(req: Request) {
  return (req as unknown as { workspaceContext: { workspaceId: string; userId: string } }).workspaceContext;
}
function serialize(doc: unknown) {
  return JSON.parse(JSON.stringify(doc));
}

router.post('/', requirePermission('AGENT_MANAGE' as never), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { workspaceId, userId } = ctx(req);
    const agent = await agentService.createAgent(workspaceId, userId, req.body ?? {});
    res.status(201).json({ data: serialize(agent) });
  } catch (err) { next(err); }
});

router.get('/', requirePermission('AGENT_READ'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const agents = await agentService.listAgents(ctx(req).workspaceId);
    res.json({ data: serialize(agents) });
  } catch (err) { next(err); }
});

router.get('/approvals/queue', requirePermission('AGENT_MANAGE' as never), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const queue = await approvalService.listQueue(ctx(req).workspaceId, status);
    res.json({ data: serialize(queue) });
  } catch (err) { next(err); }
});

router.get('/:id', requirePermission('AGENT_READ'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const agent = await agentService.getAgent(req.params.id as string, ctx(req).workspaceId);
    if (!agent) {
      res.status(404).json({ error: { code: 'AGENT_NOT_FOUND', message: 'Agent not found' } });
      return;
    }
    res.json({ data: serialize(agent) });
  } catch (err) { next(err); }
});

router.put('/:id', requirePermission('AGENT_MANAGE' as never), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const agent = await agentService.updateAgent(req.params.id as string, ctx(req).workspaceId, (req.body ?? {}) as never);
    if (!agent) {
      res.status(404).json({ error: { code: 'AGENT_NOT_FOUND', message: 'Agent not found' } });
      return;
    }
    res.json({ data: serialize(agent) });
  } catch (err) { next(err); }
});

router.delete('/:id', requirePermission('AGENT_MANAGE' as never), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deleted = await agentService.deleteAgent(req.params.id as string, ctx(req).workspaceId);
    if (!deleted) {
      res.status(404).json({ error: { code: 'AGENT_NOT_FOUND', message: 'Agent not found' } });
      return;
    }
    res.json({ data: { deleted: true } });
  } catch (err) { next(err); }
});

router.post('/:id/test', requirePermission('AGENT_TOOL_EXECUTE' as never), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { workspaceId, userId } = ctx(req);
    const out = (await executionService.testAgent(req.params.id as string, workspaceId, userId, {
      input: req.body?.input, invocation: req.body?.invocation,
    })) as unknown as Record<string, unknown>;
    if (out && (out as { approvalRequired?: boolean }).approvalRequired) {
      return res.status(202).json({ data: serialize(out) });
    }
    res.status(201).json({ data: serialize(out) });
  } catch (err) {
    if (err instanceof Error && (err.message === 'AGENT_NOT_FOUND' || err.message === 'TOOL_NOT_FOUND')) {
      return res.status(404).json({ error: { code: err.message, message: err.message } });
    }
    if (err instanceof Error && (err.message === 'TOOL_NOT_ALLOWED' || err.message === 'TOOL_DENIED_BY_POLICY')) {
      return res.status(403).json({ error: { code: err.message, message: err.message } });
    }
    next(err);
  }
});

router.get('/:id/runs', requirePermission('AGENT_READ'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { workspaceId } = ctx(req);
    const runs = await AgentRunModel.find({
      agentId: new Types.ObjectId(req.params.id as string),
      workspaceId: new Types.ObjectId(workspaceId),
    }).sort({ createdAt: -1 }).lean();
    res.json({ data: serialize(runs) });
  } catch (err) { next(err); }
});

router.get('/:id/memory', requirePermission('AGENT_READ'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mem = await agentService.listMemory(req.params.id as string, ctx(req).workspaceId);
    res.json({ data: serialize(mem) });
  } catch (err) { next(err); }
});

router.get('/:id/tools/policies', requirePermission('AGENT_READ'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ data: await policyService.listPolicies(ctx(req).workspaceId) });
  } catch (err) { next(err); }
});

router.put('/:id/tools/policies', requirePermission('AGENT_MANAGE' as never), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { workspaceId, userId } = ctx(req);
    const { toolName, policy } = req.body ?? {};
    if (!toolName || !policy) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'toolName and policy required' } });
    const entry = await policyService.setPolicy(workspaceId, toolName, policy, userId);
    res.json({ data: entry });
  } catch (err) {
    if (err instanceof Error && err.message === 'TOOL_NOT_FOUND') {
      return res.status(404).json({ error: { code: 'TOOL_NOT_FOUND', message: 'Tool not found' } });
    }
    next(err);
  }
});

router.post('/:id/approve', requirePermission('AGENT_MANAGE' as never), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { workspaceId, userId } = ctx(req);
    const { approvalId, decision, reason } = req.body ?? {};
    if (!approvalId || (decision !== 'APPROVE' && decision !== 'REJECT')) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'approvalId and decision (APPROVE|REJECT) required' } });
    }
    const out = await executionService.resolveApproval(approvalId, workspaceId, userId, decision, reason);
    res.json({ data: serialize(out) });
  } catch (err) {
    if (err instanceof Error && err.message === 'APPROVAL_NOT_FOUND') {
      return res.status(404).json({ error: { code: err.message, message: err.message } });
    }
    if (err instanceof Error && err.message === 'APPROVAL_NOT_PENDING') {
      return res.status(409).json({ error: { code: err.message, message: err.message } });
    }
    next(err);
  }
});

export default router;
