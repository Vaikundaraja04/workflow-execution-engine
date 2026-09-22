import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requirePermission, requireMembership, getWorkspaceContext, authorizeRequest } from '../middleware/requirePermission.js';
import { requirePlatformAdmin, isPlatformAdminEmail } from '../middleware/platformAdmin.js';
import { getAuthUser } from '../../auth/auth.middleware.js';
import { agentMarketplaceBillingService } from '../../services/agentMarketplaceBillingService.js';
import { marketplaceRevenueService } from '../../services/marketplaceRevenueService.js';
import { workflowMarketplaceService } from '../../services/workflowMarketplaceService.js';
import type { WorkflowSearchFilters } from '../../services/workflowMarketplaceService.js';
import { marketplaceReviewService } from '../../services/marketplaceReviewService.js';
import { marketplaceRecommendationService } from '../../services/marketplaceRecommendationService.js';
import { marketplaceAnalyticsService } from '../../services/marketplaceAnalyticsService.js';
import { publisherService } from '../../services/publisherService.js';
import { partnerService } from '../../services/partnerService.js';
import type { RevenueTransactionStatus } from '../../models/RevenueTransactionModel.js';
/**
 * Phase 17 - Ecosystem & marketplace revenue API.
 *
 * Purchase, license, workflow marketplace, review, recommendation, publisher
 * portal, partner solution and ecosystem analytics endpoints. Buying, renewing
 * and revoking require AGENT_MARKETPLACE_MANAGE (spending is an owner/admin
 * action); browsing keeps AGENT_MARKETPLACE_READ; workflow publishing requires
 * TEMPLATE_PUBLISH and installs TEMPLATE_INSTALL. Refunds, payouts, review
 * moderation, partner solutions and platform-wide revenue and analytics require
 * a platform administrator. Cross-workspace reads resolve to 404, never 403
 * with data.
 */

const ASSET_TYPES = ['AGENT', 'WORKFLOW'] as const;
const LICENSE_STATUSES = ['ACTIVE', 'EXPIRED', 'REVOKED'] as const;
const TRANSACTION_STATUSES = ['PENDING', 'AVAILABLE', 'PAID_OUT', 'REFUNDED', 'REVERSED'] as const;
const WORKFLOW_LISTING_TYPES = ['PREMIUM_WORKFLOW', 'INDUSTRY_SOLUTION', 'BUNDLE'] as const;
const WORKFLOW_LISTING_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
const WORKFLOW_SORTS = ['recent', 'sales', 'installs', 'price'] as const;
const PARTNER_LISTING_TYPES = ['SOLUTION', 'CONSULTING', 'AGENCY'] as const;
const PARTNER_LISTING_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
const REVIEW_STATUSES = ['PUBLISHED', 'HIDDEN'] as const;
function ctx(req: Request) {
  return getWorkspaceContext(req);
}

function serialize(doc: unknown): unknown {
  return JSON.parse(JSON.stringify(doc));
}

/** Platform administrators operate across tenants; every other caller stays scoped. */
function isPlatformAdmin(req: Request): boolean {
  try {
    return isPlatformAdminEmail(getAuthUser(req).email);
  } catch {
    return false;
  }
}

const badRequest = (message: string) => ({ error: { code: 'INVALID_REQUEST', message } });

/** Publisher-scope revenue reads require marketplace read in the caller workspace. */
async function requireMarketplaceAccess(req: Request): Promise<void> {
  const outcome = await authorizeRequest(req, {}, 'AGENT_MARKETPLACE_READ');
  if (outcome === 'allow') return;
  if (outcome === 'forbidden') throw new Error('FORBIDDEN');
  if (outcome === 'denied') throw new Error('PERMISSION_DENIED');
  throw new Error('WORKSPACE_NOT_FOUND');
}

function numberQuery(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringQuery(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

function tagQuery(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const tags = value.split(',').map((tag) => tag.trim()).filter(Boolean);
  return tags.length > 0 ? tags : undefined;
}
function parseWith<S extends z.ZodTypeAny>(
  schema: S,
  body: unknown,
): { ok: true; value: z.infer<S> } | { ok: false; message: string } {
  const parsed = schema.safeParse(body ?? {});
  if (parsed.success) return { ok: true, value: parsed.data };
  const issue = parsed.error.issues[0];
  const path = issue && issue.path.length > 0 ? issue.path.join('.') + ': ' : '';
  return { ok: false, message: path + (issue ? issue.message : 'Invalid request body') };
}
const purchaseSchema = z.object({
  paymentId: z.string().trim().min(1).max(191).optional(),
  provider: z.string().trim().min(1).max(32).optional(),
  currency: z.string().trim().min(3).max(8).optional(),
  workspaceId: z.string().trim().min(1).optional(),
}).strict();

const activateSchema = z.object({
  workspaceId: z.string().trim().min(1).optional(),
}).strict();

const renewSchema = z.object({
  paymentId: z.string().trim().min(1).max(191),
  workspaceId: z.string().trim().min(1).optional(),
}).strict();

const pricingSchema = z.object({
  pricingModel: z.enum(['FREE', 'ONE_TIME_PURCHASE', 'SUBSCRIPTION', 'ENTERPRISE_LICENSE'] as const),
  price: z.coerce.number().int().nonnegative().max(10000000).optional(),
  currency: z.string().trim().min(3).max(8).optional(),
  billingCycle: z.enum(['NONE', 'MONTHLY', 'YEARLY'] as const).optional(),
  revenueSharePercentage: z.coerce.number().min(0).max(100).optional(),
  seats: z.coerce.number().int().positive().nullable().optional(),
  termMonths: z.coerce.number().int().positive().nullable().optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED'] as const).optional(),
}).strict();
const revokeSchema = z.object({
  buyerWorkspaceId: z.string().trim().min(1),
  reason: z.string().trim().max(500).optional(),
  workspaceId: z.string().trim().min(1).optional(),
}).strict();

const refundSchema = z.object({
  transactionId: z.string().trim().min(1).max(64),
  amount: z.coerce.number().int().positive().optional(),
  reason: z.string().trim().max(500).optional(),
}).strict();

const payoutSchema = z.object({
  sellerWorkspaceId: z.string().trim().min(1),
}).strict();

const publishWorkflowSchema = z.object({
  templateId: z.string().trim().min(1),
  listingType: z.enum(WORKFLOW_LISTING_TYPES).optional(),
  pricingModel: z.enum(['FREE', 'ONE_TIME_PURCHASE', 'SUBSCRIPTION', 'ENTERPRISE_LICENSE'] as const),
  price: z.coerce.number().int().nonnegative().max(10000000).optional(),
  currency: z.string().trim().min(3).max(8).optional(),
  billingCycle: z.enum(['NONE', 'MONTHLY', 'YEARLY'] as const).optional(),
  revenueSharePercentage: z.coerce.number().min(0).max(100).optional(),
  bundleTemplateIds: z.array(z.string().trim().min(1)).max(50).optional(),
  industryTags: z.array(z.string().trim().min(1).max(64)).max(12).optional(),
  status: z.enum(WORKFLOW_LISTING_STATUSES).optional(),
}).strict();
const installWorkflowSchema = z.object({
  paymentId: z.string().trim().min(1).max(191).optional(),
  workflowName: z.string().trim().min(1).max(160).optional(),
  workspaceId: z.string().trim().min(1).optional(),
}).strict();

const reviewSchema = z.object({
  assetType: z.enum(ASSET_TYPES),
  assetId: z.string().trim().min(1),
  rating: z.coerce.number().int().min(1).max(5),
  review: z.string().trim().max(2000).optional(),
}).strict();

const moderateReviewSchema = z.object({
  status: z.enum(REVIEW_STATUSES),
  reason: z.string().trim().max(500).optional(),
}).strict();

const solutionSchema = z.object({
  listingType: z.enum(PARTNER_LISTING_TYPES).optional(),
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(3).max(4000),
  templateId: z.string().trim().min(1).nullable().optional(),
  solutionId: z.string().trim().min(1).max(120).nullable().optional(),
  industryTags: z.array(z.string().trim().min(1).max(64)).max(12).optional(),
  commissionRatePercent: z.coerce.number().min(0).max(50).optional(),
  status: z.enum(PARTNER_LISTING_STATUSES).optional(),
}).strict();

const solutionStatusSchema = z.object({
  status: z.enum(PARTNER_LISTING_STATUSES),
}).strict();
/** Agent marketplace commerce: pricing, purchase and the license lifecycle. */
export function createMarketplaceEcosystemRouter(): Router {
  const router = Router();

  router.put('/agents/:id/pricing', requirePermission('AGENT_MARKETPLACE_CREATE'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId, userId } = ctx(req);
      const parsed = parseWith(pricingSchema, req.body);
      if (!parsed.ok) return res.status(400).json(badRequest(parsed.message));
      const pricing = await agentMarketplaceBillingService.setPricing({
        listingId: req.params.id as string,
        userId,
        callerWorkspaceId: workspaceId,
        pricingModel: parsed.value.pricingModel,
        ...(parsed.value.price !== undefined ? { price: parsed.value.price } : {}),
        ...(parsed.value.currency !== undefined ? { currency: parsed.value.currency } : {}),
        ...(parsed.value.billingCycle !== undefined ? { billingCycle: parsed.value.billingCycle } : {}),
        ...(parsed.value.revenueSharePercentage !== undefined ? { revenueSharePercentage: parsed.value.revenueSharePercentage } : {}),
        ...(parsed.value.seats !== undefined ? { seats: parsed.value.seats } : {}),
        ...(parsed.value.termMonths !== undefined ? { termMonths: parsed.value.termMonths } : {}),
        ...(parsed.value.status !== undefined ? { status: parsed.value.status } : {}),
      });
      res.json({ data: serialize(pricing) });
    } catch (err) { next(err); }
  });
  router.get('/agents/:id/pricing', requirePermission('AGENT_MARKETPLACE_READ'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pricing = await agentMarketplaceBillingService.getPricing(req.params.id as string);
      res.json({ data: serialize(pricing) });
    } catch (err) { next(err); }
  });

  router.post('/agents/:id/purchase', requirePermission('AGENT_MARKETPLACE_MANAGE', { useBodyWorkspace: true }), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId, userId } = ctx(req);
      const parsed = parseWith(purchaseSchema, req.body);
      if (!parsed.ok) return res.status(400).json(badRequest(parsed.message));
      const listingId = req.params.id as string;
      if (parsed.value.paymentId) {
        const result = await agentMarketplaceBillingService.completePurchase({
          listingId,
          workspaceId,
          userId,
          paymentId: parsed.value.paymentId,
        });
        return res.json({ data: serialize(result) });
      }
      const session = await agentMarketplaceBillingService.createPurchaseSession({
        listingId,
        workspaceId,
        userId,
        ...(parsed.value.provider !== undefined ? { provider: parsed.value.provider } : {}),
        ...(parsed.value.currency !== undefined ? { currency: parsed.value.currency } : {}),
      });
      res.status(201).json({ data: serialize(session) });
    } catch (err) { next(err); }
  });
  router.post('/agents/:id/activate', requirePermission('AGENT_MARKETPLACE_MANAGE', { useBodyWorkspace: true }), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId, userId } = ctx(req);
      const parsed = parseWith(activateSchema, req.body);
      if (!parsed.ok) return res.status(400).json(badRequest(parsed.message));
      const license = await agentMarketplaceBillingService.activateLicense({
        listingId: req.params.id as string,
        workspaceId,
        userId,
      });
      res.status(201).json({ data: serialize(license) });
    } catch (err) { next(err); }
  });

  router.post('/agents/:id/renew', requirePermission('AGENT_MARKETPLACE_MANAGE', { useBodyWorkspace: true }), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId, userId } = ctx(req);
      const parsed = parseWith(renewSchema, req.body);
      if (!parsed.ok) return res.status(400).json(badRequest(parsed.message));
      const result = await agentMarketplaceBillingService.renewSubscription({
        listingId: req.params.id as string,
        workspaceId,
        userId,
        paymentId: parsed.value.paymentId,
      });
      res.json({ data: serialize(result) });
    } catch (err) { next(err); }
  });
  router.post('/agents/:id/revoke', requirePermission('AGENT_MARKETPLACE_MANAGE', { useBodyWorkspace: true }), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId, userId } = ctx(req);
      const parsed = parseWith(revokeSchema, req.body);
      if (!parsed.ok) return res.status(400).json(badRequest(parsed.message));
      const result = await agentMarketplaceBillingService.revokeAccess({
        listingId: req.params.id as string,
        buyerWorkspaceId: parsed.value.buyerWorkspaceId,
        userId,
        callerWorkspaceId: workspaceId,
        platformAdmin: isPlatformAdmin(req),
        ...(parsed.value.reason !== undefined ? { reason: parsed.value.reason } : {}),
      });
      res.json({ data: serialize(result) });
    } catch (err) { next(err); }
  });

  router.get('/licenses', requirePermission('AGENT_MARKETPLACE_READ'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId } = ctx(req);
      const filters: { assetType?: string | undefined; status?: string | undefined } = {};
      const assetType = oneOf(req.query.assetType, ASSET_TYPES);
      const status = oneOf(req.query.status, LICENSE_STATUSES);
      if (assetType) filters.assetType = assetType;
      if (status) filters.status = status;
      res.json({ data: serialize(await agentMarketplaceBillingService.listLicenses(workspaceId, filters)) });
    } catch (err) { next(err); }
  });
  router.get('/revenue', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const days = numberQuery(req.query.days);
      const options = days !== undefined ? { days } : {};
      if (req.query.scope === 'platform') {
        if (!isPlatformAdmin(req)) throw new Error('FORBIDDEN');
        res.json({ data: serialize(await marketplaceRevenueService.platformRevenue(options)) });
        return;
      }
      await requireMarketplaceAccess(req);
      res.json({ data: serialize(await marketplaceRevenueService.publisherRevenue(ctx(req).workspaceId, options)) });
    } catch (err) { next(err); }
  });
  router.get('/revenue/transactions', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const filters: {
        sellerWorkspaceId?: string | undefined;
        buyerWorkspaceId?: string | undefined;
        status?: RevenueTransactionStatus | undefined;
        limit?: number | undefined;
      } = {};
      if (isPlatformAdmin(req)) {
        const seller = stringQuery(req.query.sellerWorkspaceId);
        const buyer = stringQuery(req.query.buyerWorkspaceId);
        if (seller) filters.sellerWorkspaceId = seller;
        if (buyer) filters.buyerWorkspaceId = buyer;
      } else {
        await requireMarketplaceAccess(req);
        filters.sellerWorkspaceId = ctx(req).workspaceId;
      }
      const status = oneOf(req.query.status, TRANSACTION_STATUSES);
      const limit = numberQuery(req.query.limit);
      if (status) filters.status = status;
      if (limit !== undefined) filters.limit = limit;
      res.json({ data: serialize(await marketplaceRevenueService.listTransactions(filters)) });
    } catch (err) { next(err); }
  });
  router.post('/revenue/refund', requirePlatformAdmin(), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = parseWith(refundSchema, req.body);
      if (!parsed.ok) return res.status(400).json(badRequest(parsed.message));
      const refund = await marketplaceRevenueService.refundTransaction(
        parsed.value.transactionId,
        {
          ...(parsed.value.amount !== undefined ? { amount: parsed.value.amount } : {}),
          ...(parsed.value.reason !== undefined ? { reason: parsed.value.reason } : {}),
        },
        getAuthUser(req).userId,
      );
      res.json({ data: serialize(refund) });
    } catch (err) { next(err); }
  });

  router.post('/revenue/payouts', requirePlatformAdmin(), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = parseWith(payoutSchema, req.body);
      if (!parsed.ok) return res.status(400).json(badRequest(parsed.message));
      const payout = await marketplaceRevenueService.recordPayout(parsed.value.sellerWorkspaceId, getAuthUser(req).userId);
      res.status(201).json({ data: serialize(payout) });
    } catch (err) { next(err); }
  });
  router.get('/workflows', requireMembership(), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const filters: WorkflowSearchFilters = {};
      const q = stringQuery(req.query.q) ?? stringQuery(req.query.search);
      if (q) filters.q = q;
      const listingType = oneOf(req.query.listingType, WORKFLOW_LISTING_TYPES);
      if (listingType) filters.listingType = listingType;
      const tags = tagQuery(req.query.industryTags) ?? tagQuery(req.query.tag) ?? tagQuery(req.query.industry);
      if (tags) filters.industryTags = tags;
      const minPrice = numberQuery(req.query.minPrice);
      if (minPrice !== undefined) filters.minPrice = minPrice;
      const maxPrice = numberQuery(req.query.maxPrice);
      if (maxPrice !== undefined) filters.maxPrice = maxPrice;
      const sortBy = oneOf(req.query.sortBy, WORKFLOW_SORTS);
      if (sortBy) filters.sortBy = sortBy;
      const page = numberQuery(req.query.page);
      if (page !== undefined) filters.page = page;
      const limit = numberQuery(req.query.limit);
      if (limit !== undefined) filters.limit = limit;
      res.json({ data: serialize(await workflowMarketplaceService.listWorkflows(filters)) });
    } catch (err) { next(err); }
  });
  router.post('/workflows/publish', requirePermission('TEMPLATE_PUBLISH'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId, userId } = ctx(req);
      const parsed = parseWith(publishWorkflowSchema, req.body);
      if (!parsed.ok) return res.status(400).json(badRequest(parsed.message));
      const listing = await workflowMarketplaceService.publishWorkflow({
        ...parsed.value,
        workspaceId,
        userId,
      });
      res.status(listing.marketplaceVersion === 1 ? 201 : 200).json({ data: serialize(listing) });
    } catch (err) { next(err); }
  });

  router.get('/workflows/:id', requireMembership(), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId } = ctx(req);
      const listing = await workflowMarketplaceService.getWorkflow(req.params.id as string, workspaceId);
      res.json({ data: serialize(listing) });
    } catch (err) { next(err); }
  });
  router.post('/workflows/:id/purchase', requirePermission('TEMPLATE_INSTALL', { useBodyWorkspace: true }), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId, userId } = ctx(req);
      const parsed = parseWith(purchaseSchema, req.body);
      if (!parsed.ok) return res.status(400).json(badRequest(parsed.message));
      const listingId = req.params.id as string;
      if (parsed.value.paymentId) {
        const result = await workflowMarketplaceService.completePurchase({
          listingId,
          workspaceId,
          userId,
          paymentId: parsed.value.paymentId,
        });
        return res.json({ data: serialize(result) });
      }
      const session = await workflowMarketplaceService.createPurchaseSession({
        listingId,
        workspaceId,
        userId,
        ...(parsed.value.provider !== undefined ? { provider: parsed.value.provider } : {}),
        ...(parsed.value.currency !== undefined ? { currency: parsed.value.currency } : {}),
      });
      res.status(201).json({ data: serialize(session) });
    } catch (err) { next(err); }
  });

  router.post('/workflows/:id/install', requirePermission('TEMPLATE_INSTALL', { useBodyWorkspace: true }), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId, userId } = ctx(req);
      const parsed = parseWith(installWorkflowSchema, req.body);
      if (!parsed.ok) return res.status(400).json(badRequest(parsed.message));
      const result = await workflowMarketplaceService.installWorkflow({
        listingId: req.params.id as string,
        workspaceId,
        userId,
        ...(parsed.value.paymentId !== undefined ? { paymentId: parsed.value.paymentId } : {}),
        ...(parsed.value.workflowName !== undefined ? { workflowName: parsed.value.workflowName } : {}),
      });
      res.status(201).json({ data: serialize(result) });
    } catch (err) { next(err); }
  });
  router.post('/workflows/:id/renew', requirePermission('TEMPLATE_INSTALL', { useBodyWorkspace: true }), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId, userId } = ctx(req);
      const parsed = parseWith(renewSchema, req.body);
      if (!parsed.ok) return res.status(400).json(badRequest(parsed.message));
      const result = await workflowMarketplaceService.renewSubscription({
        listingId: req.params.id as string,
        workspaceId,
        userId,
        paymentId: parsed.value.paymentId,
      });
      res.json({ data: serialize(result) });
    } catch (err) { next(err); }
  });

  router.get('/reviews', requireMembership(), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const assetType = oneOf(req.query.assetType, ASSET_TYPES);
      const assetId = stringQuery(req.query.assetId);
      if (!assetType || !assetId) {
        return res.status(400).json(badRequest('assetType and assetId are required'));
      }
      const page = numberQuery(req.query.page);
      const limit = numberQuery(req.query.limit);
      const result = await marketplaceReviewService.listReviews({
        assetType,
        assetId,
        ...(page !== undefined ? { page } : {}),
        ...(limit !== undefined ? { limit } : {}),
      });
      res.json({ data: serialize(result) });
    } catch (err) { next(err); }
  });
  router.post('/reviews', requireMembership(), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId, userId } = ctx(req);
      const parsed = parseWith(reviewSchema, req.body);
      if (!parsed.ok) return res.status(400).json(badRequest(parsed.message));
      const review = await marketplaceReviewService.createReview({
        assetType: parsed.value.assetType,
        assetId: parsed.value.assetId,
        workspaceId,
        userId,
        rating: parsed.value.rating,
        ...(parsed.value.review !== undefined ? { review: parsed.value.review } : {}),
      });
      res.status(201).json({ data: serialize(review) });
    } catch (err) { next(err); }
  });

  router.post('/reviews/:id/report', requireMembership(), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await marketplaceReviewService.reportAbuse(req.params.id as string, ctx(req).userId);
      res.json({ data: serialize(result) });
    } catch (err) { next(err); }
  });
  router.post('/reviews/:id/moderate', requirePlatformAdmin(), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = parseWith(moderateReviewSchema, req.body);
      if (!parsed.ok) return res.status(400).json(badRequest(parsed.message));
      const review = await marketplaceReviewService.moderateReview(
        req.params.id as string,
        {
          status: parsed.value.status,
          ...(parsed.value.reason !== undefined ? { reason: parsed.value.reason } : {}),
        },
        getAuthUser(req).userId,
      );
      res.json({ data: serialize(review) });
    } catch (err) { next(err); }
  });

  router.get('/recommendations', requirePermission('AGENT_MARKETPLACE_READ'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId, userId, role } = ctx(req);
      const limit = numberQuery(req.query.limit);
      const rawCopy = req.query.includeAiCopy;
      const includeAiCopy = rawCopy === undefined ? undefined : !(rawCopy === 'false' || rawCopy === '0');
      const result = await marketplaceRecommendationService.getRecommendations({
        workspaceId,
        userId,
        role,
        ...(limit !== undefined ? { limit } : {}),
        ...(includeAiCopy !== undefined ? { includeAiCopy } : {}),
      });
      res.json({ data: serialize(result) });
    } catch (err) { next(err); }
  });
  router.get('/publisher/dashboard', requireMembership(), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId } = ctx(req);
      const days = numberQuery(req.query.days);
      const dashboard = await publisherService.getDashboard(workspaceId, days !== undefined ? { days } : {});
      res.json({ data: serialize(dashboard) });
    } catch (err) { next(err); }
  });

  return router;
}
/**
 * Partner solutions: published and archived by platform administrators only,
 * discoverable as published listings by workspace members.
 */
export function createPartnerSolutionRouter(): Router {
  const router = Router();

  router.get('/solutions', requireMembership(), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = isPlatformAdmin(req) ? oneOf(req.query.status, PARTNER_LISTING_STATUSES) : undefined;
      const listingType = oneOf(req.query.listingType, PARTNER_LISTING_TYPES);
      const partnerId = stringQuery(req.query.partnerId);
      const limit = numberQuery(req.query.limit);
      const solutions = await partnerService.listSolutions({
        ...(status !== undefined ? { status } : {}),
        ...(listingType !== undefined ? { listingType } : {}),
        ...(partnerId !== undefined ? { partnerId } : {}),
        ...(limit !== undefined ? { limit } : {}),
      });
      res.json({ data: solutions });
    } catch (err) { next(err); }
  });

  router.post('/:partnerId/solutions', requirePlatformAdmin(), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = parseWith(solutionSchema, req.body);
      if (!parsed.ok) return res.status(400).json(badRequest(parsed.message));
      const solution = await partnerService.createSolution(
        req.params.partnerId as string,
        parsed.value,
        getAuthUser(req).userId,
      );
      res.status(201).json({ data: solution });
    } catch (err) { next(err); }
  });

  router.patch('/solutions/:solutionId', requirePlatformAdmin(), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = parseWith(solutionStatusSchema, req.body);
      if (!parsed.ok) return res.status(400).json(badRequest(parsed.message));
      const solution = await partnerService.updateSolutionStatus(
        req.params.solutionId as string,
        parsed.value.status,
        getAuthUser(req).userId,
      );
      res.json({ data: solution });
    } catch (err) { next(err); }
  });

  return router;
}
/** Platform-wide ecosystem analytics: one audited report across tenants. */
export function createEcosystemAnalyticsRouter(): Router {
  const router = Router();

  router.get('/marketplace', requirePlatformAdmin(), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const days = numberQuery(req.query.days);
      const months = numberQuery(req.query.months);
      const limit = numberQuery(req.query.limit);
      const report = await marketplaceAnalyticsService.report({
        ...(days !== undefined ? { days } : {}),
        ...(months !== undefined ? { months } : {}),
        ...(limit !== undefined ? { limit } : {}),
        actorUserId: getAuthUser(req).userId,
      });
      res.json({ data: serialize(report) });
    } catch (err) { next(err); }
  });

  return router;
}