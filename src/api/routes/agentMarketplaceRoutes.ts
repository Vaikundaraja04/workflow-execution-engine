import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { requirePermission } from '../middleware/requirePermission.js';
import {
  agentMarketplaceService,
  type AgentMarketplaceSearchFilters,
} from '../../services/agentMarketplaceService.js';
import { marketplaceIntelligenceService } from '../../services/marketplaceIntelligenceService.js';
import type { WorkspaceRole } from '../../models/WorkspaceMemberModel.js';

const router = Router();

interface MarketplaceContext {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
}

function ctx(req: Request): MarketplaceContext {
  return (req as unknown as { workspaceContext: MarketplaceContext }).workspaceContext;
}

function serialize(doc: unknown): unknown {
  return JSON.parse(JSON.stringify(doc));
}

const NOT_FOUND_CODES = ['LISTING_NOT_FOUND', 'AGENT_NOT_FOUND', 'VERSION_NOT_FOUND', 'AGENT_NOT_INSTALLED'];
const CONFLICT_CODES = ['LISTING_ALREADY_EXISTS', 'AGENT_ALREADY_INSTALLED'];
const INVALID_CODES = ['INVALID_REQUEST', 'INVALID_RATING', 'UNKNOWN_TOOL'];

function handleError(err: unknown, res: Response, next: NextFunction): void {
  if (!(err instanceof Error)) {
    next(err);
    return;
  }
  const code = err.message;
  if (NOT_FOUND_CODES.includes(code)) {
    res.status(404).json({ error: { code, message: code.replaceAll('_', ' ').toLowerCase() } });
    return;
  }
  if (CONFLICT_CODES.includes(code)) {
    res.status(409).json({ error: { code, message: code.replaceAll('_', ' ').toLowerCase() } });
    return;
  }
  if (code === 'AGENT_MARKETPLACE_POLICY_BLOCKED') {
    res.status(403).json({ error: { code, message: 'Agent blocked by workspace AI governance policy' } });
    return;
  }
  if (code === 'REVIEW_REQUIRES_INSTALLATION') {
    res.status(403).json({ error: { code, message: 'An active installation is required to review this agent' } });
    return;
  }
  if (INVALID_CODES.includes(code)) {
    res.status(400).json({ error: { code, message: code.replaceAll('_', ' ').toLowerCase() } });
    return;
  }
  next(err);
}
function parseSearchFilters(req: Request): AgentMarketplaceSearchFilters {
  const filters: AgentMarketplaceSearchFilters = {};
  const q = typeof req.query.q === 'string'
    ? req.query.q
    : typeof req.query.search === 'string'
      ? req.query.search
      : undefined;
  if (q) filters.q = q;
  if (typeof req.query.category === 'string') filters.category = req.query.category;
  if (typeof req.query.tag === 'string') filters.tag = req.query.tag;
  if (typeof req.query.publisherId === 'string') filters.publisherId = req.query.publisherId;
  const minRating = Number(req.query.minRating);
  if (Number.isFinite(minRating) && minRating > 0) filters.minRating = minRating;
  const sortBy = req.query.sortBy;
  if (sortBy === 'rating' || sortBy === 'installs' || sortBy === 'executions' || sortBy === 'recent') {
    filters.sortBy = sortBy;
  }
  const page = Number(req.query.page);
  if (Number.isFinite(page) && page > 0) filters.page = page;
  const limit = Number(req.query.limit);
  if (Number.isFinite(limit) && limit > 0) filters.limit = limit;
  return filters;
}

router.get('/agents', requirePermission('AGENT_MARKETPLACE_READ'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await agentMarketplaceService.searchAgents(ctx(req).workspaceId, parseSearchFilters(req));
    res.json({ data: serialize(result) });
  } catch (err) { handleError(err, res, next); }
});

router.get('/search', requirePermission('AGENT_MARKETPLACE_READ'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await agentMarketplaceService.searchAgents(ctx(req).workspaceId, parseSearchFilters(req));
    res.json({ data: serialize(result) });
  } catch (err) { handleError(err, res, next); }
});

router.get('/agents/:id', requirePermission('AGENT_MARKETPLACE_READ'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const details = await agentMarketplaceService.getAgentDetails(req.params.id as string, ctx(req).workspaceId);
    res.json({ data: serialize(details) });
  } catch (err) { handleError(err, res, next); }
});
router.post('/agents', requirePermission('AGENT_MARKETPLACE_CREATE'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { workspaceId, userId } = ctx(req);
    const listing = await agentMarketplaceService.createListing(workspaceId, userId, (req.body ?? {}) as never);
    res.status(201).json({ data: serialize(listing) });
  } catch (err) { handleError(err, res, next); }
});

router.put('/agents/:id', requirePermission('AGENT_MARKETPLACE_CREATE'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { workspaceId } = ctx(req);
    const listing = await agentMarketplaceService.updateListing(req.params.id as string, workspaceId, (req.body ?? {}) as never);
    res.json({ data: serialize(listing) });
  } catch (err) { handleError(err, res, next); }
});

router.post('/agents/:id/publish', requirePermission('AGENT_MARKETPLACE_CREATE'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { workspaceId, userId, role } = ctx(req);
    const listing = await agentMarketplaceService.publishAgent(req.params.id as string, workspaceId, userId, role);
    res.json({ data: serialize(listing) });
  } catch (err) { handleError(err, res, next); }
});

router.post('/agents/:id/archive', requirePermission('AGENT_MARKETPLACE_MANAGE'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { workspaceId, userId } = ctx(req);
    const listing = await agentMarketplaceService.archiveAgent(req.params.id as string, workspaceId, userId);
    res.json({ data: serialize(listing) });
  } catch (err) { handleError(err, res, next); }
});

router.get('/agents/:id/versions', requirePermission('AGENT_MARKETPLACE_READ'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const versions = await agentMarketplaceService.listVersions(req.params.id as string, ctx(req).workspaceId);
    res.json({ data: serialize(versions) });
  } catch (err) { handleError(err, res, next); }
});
router.get('/agents/:id/versions/compare', requirePermission('AGENT_MARKETPLACE_READ'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const from = Number(req.query.from);
    const to = Number(req.query.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'from and to version numbers are required' } });
    }
    const comparison = await agentMarketplaceService.compareVersions(req.params.id as string, ctx(req).workspaceId, from, to);
    res.json({ data: comparison });
  } catch (err) { handleError(err, res, next); }
});

router.post('/agents/:id/rollback', requirePermission('AGENT_MARKETPLACE_MANAGE'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { workspaceId, userId } = ctx(req);
    const versionNumber = Number((req.body ?? {}).version);
    if (!Number.isFinite(versionNumber) || versionNumber < 1) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'version is required' } });
    }
    const version = await agentMarketplaceService.rollbackToVersion(req.params.id as string, workspaceId, userId, versionNumber);
    res.status(201).json({ data: serialize(version) });
  } catch (err) { handleError(err, res, next); }
});

router.post('/agents/:id/install', requirePermission('AGENT_INSTALL'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { workspaceId, userId, role } = ctx(req);
    const configuration = ((req.body ?? {}).configuration ?? req.body ?? {}) as never;
    const result = await agentMarketplaceService.installAgent(req.params.id as string, workspaceId, userId, configuration, role);
    res.status(201).json({ data: serialize(result) });
  } catch (err) { handleError(err, res, next); }
});

router.delete('/agents/:id/install', requirePermission('AGENT_INSTALL'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { workspaceId, userId } = ctx(req);
    const result = await agentMarketplaceService.uninstallAgent(req.params.id as string, workspaceId, userId);
    res.json({ data: serialize(result) });
  } catch (err) { handleError(err, res, next); }
});
router.post('/agents/:id/reviews', requirePermission('AGENT_INSTALL'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { workspaceId, userId } = ctx(req);
    const body = (req.body ?? {}) as { rating?: unknown; review?: unknown };
    const result = await agentMarketplaceService.rateAgent(
      req.params.id as string,
      workspaceId,
      userId,
      Number(body.rating),
      typeof body.review === 'string' ? body.review : undefined,
    );
    res.status(201).json({ data: serialize(result) });
  } catch (err) { handleError(err, res, next); }
});

router.get('/agents/:id/reviews', requirePermission('AGENT_MARKETPLACE_READ'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Number(req.query.page);
    const limit = Number(req.query.limit);
    const result = await agentMarketplaceService.listReviews(
      req.params.id as string,
      ctx(req).workspaceId,
      Number.isFinite(page) && page > 0 ? page : 1,
      Number.isFinite(limit) && limit > 0 ? limit : 20,
    );
    res.json({ data: serialize(result) });
  } catch (err) { handleError(err, res, next); }
});

router.get('/agents/:id/stats', requirePermission('AGENT_MARKETPLACE_READ'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await agentMarketplaceService.getStats(req.params.id as string, ctx(req).workspaceId);
    res.json({ data: serialize(stats) });
  } catch (err) { handleError(err, res, next); }
});

router.get('/analytics', requirePermission('AGENT_MARKETPLACE_READ'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { workspaceId, userId } = ctx(req);
    const timeframe = req.query.timeframe === '7d' || req.query.timeframe === '90d' ? req.query.timeframe : '30d';
    const analytics = await marketplaceIntelligenceService.getAnalytics(workspaceId, userId, timeframe);
    res.json({ data: serialize(analytics) });
  } catch (err) { handleError(err, res, next); }
});

router.get('/recommendations', requirePermission('AGENT_MARKETPLACE_READ'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { workspaceId, userId, role } = ctx(req);
    const limit = Number(req.query.limit);
    const recommendations = await marketplaceIntelligenceService.getRecommendations(
      workspaceId,
      userId,
      role,
      Number.isFinite(limit) && limit > 0 ? limit : 5,
    );
    res.json({ data: serialize(recommendations) });
  } catch (err) { handleError(err, res, next); }
});

router.get('/health', requirePermission('AGENT_MARKETPLACE_READ'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { workspaceId, userId } = ctx(req);
    const listingId = typeof req.query.listingId === 'string' ? req.query.listingId : undefined;
    const health = await marketplaceIntelligenceService.getHealth(workspaceId, userId, listingId);
    res.json({ data: serialize(health) });
  } catch (err) { handleError(err, res, next); }
});

router.get('/lifecycle', requirePermission('AGENT_MARKETPLACE_READ'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { workspaceId, userId } = ctx(req);
    const lifecycle = await marketplaceIntelligenceService.getLifecycle(workspaceId, userId);
    res.json({ data: serialize(lifecycle) });
  } catch (err) { handleError(err, res, next); }
});

export default router;