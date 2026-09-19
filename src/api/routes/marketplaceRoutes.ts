import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { getAuthUser } from '../../auth/auth.middleware.js';
import { marketplaceService } from '../../services/marketplaceService.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { MarketplaceVerificationStatus } from '../../models/MarketplaceListingModel.js';

const publishSchema = z.object({
  templateId: z.string().trim().min(1),
});

const reviewSchema = z.object({
  templateId: z.string().trim().min(1).optional(),
  rating: z.number().int().min(1).max(5),
  review: z.string().trim().max(1000).optional(),
});

const rejectSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

const approveSchema = z.object({
  feature: z.boolean().optional().default(false),
});

export function createMarketplaceRouter(): Router {
  const router = Router();

  // GET /api/v1/marketplace/templates - List and search marketplace templates
  router.get('/templates', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const category = req.query.category as string | undefined;
      const verificationStatus = req.query.verificationStatus as MarketplaceVerificationStatus | undefined;
      const searchText = (req.query.q as string) || (req.query.search as string) || undefined;
      const minRating = req.query.minRating ? parseFloat(req.query.minRating as string) : undefined;

      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const sortBy = req.query.sortBy as 'rankingScore' | 'statistics.downloads' | 'createdAt' | undefined;
      const sortOrder = req.query.sortOrder as 'asc' | 'desc' | undefined;

      const result = await marketplaceService.getTemplates(
        {
          category,
          verificationStatus,
          searchText,
          minRating,
        },
        {
          page,
          limit,
          sortBy,
          sortOrder,
        }
      );

      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/marketplace/templates/:id - Get template details
  router.get('/templates/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string | undefined;
      if (!id || !Types.ObjectId.isValid(id)) {
        return res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid listing ID' } });
      }

      const listing = await marketplaceService.getTemplateById(id);
      res.json(listing);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/marketplace/publish - Publish a template to marketplace
  router.post(
    '/publish',
    requirePermission('TEMPLATE_PUBLISH', { useBodyWorkspace: true }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { userId } = getAuthUser(req);
        const parsed = publishSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request body' } });
        }

        const listing = await marketplaceService.publishTemplate(parsed.data.templateId, userId);
        res.status(201).json(listing);
      } catch (err) {
        next(err);
      }
    }
  );

  // POST /api/v1/marketplace/review or /api/v1/marketplace/templates/:id/review
  router.post('/review', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = getAuthUser(req);
      const parsed = reviewSchema.safeParse(req.body);
      if (!parsed.success || !parsed.data.templateId) {
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'templateId and rating (1-5) are required' } });
      }

      const listing = await marketplaceService.addReview(
        parsed.data.templateId,
        userId,
        parsed.data.rating,
        parsed.data.review
      );

      res.json(listing);
    } catch (err) {
      next(err);
    }
  });

  router.post('/templates/:id/review', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string | undefined;
      if (!id || !Types.ObjectId.isValid(id)) {
        return res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid listing ID' } });
      }
      const { userId } = getAuthUser(req);
      const parsed = reviewSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Rating (1-5) is required' } });
      }

      const listing = await marketplaceService.addReview(
        id,
        userId,
        parsed.data.rating,
        parsed.data.review
      );

      res.json(listing);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/marketplace/templates/:id/approve - Approve listing (admin only)
  router.post(
    '/templates/:id/approve',
    requirePermission('TEMPLATE_MANAGE', { useBodyWorkspace: true }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = req.params.id as string | undefined;
        if (!id || !Types.ObjectId.isValid(id)) {
          return res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid listing ID' } });
        }
        const { userId } = getAuthUser(req);
        const parsed = approveSchema.safeParse(req.body);
        const feature = parsed.success ? parsed.data.feature : false;

        const listing = await marketplaceService.approveTemplate(id, userId, feature);
        res.json(listing);
      } catch (err) {
        next(err);
      }
    }
  );

  // POST /api/v1/marketplace/templates/:id/reject - Reject listing (admin only)
  router.post(
    '/templates/:id/reject',
    requirePermission('TEMPLATE_MANAGE', { useBodyWorkspace: true }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = req.params.id as string | undefined;
        if (!id || !Types.ObjectId.isValid(id)) {
          return res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid listing ID' } });
        }
        const { userId } = getAuthUser(req);
        const parsed = rejectSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Rejection reason is required' } });
        }

        const listing = await marketplaceService.rejectTemplate(id, userId, parsed.data.reason);
        res.json(listing);
      } catch (err) {
        next(err);
      }
    }
  );

  // POST /api/v1/marketplace/templates/:id/download - Increment download
  router.post('/templates/:id/download', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string | undefined;
      if (!id || !Types.ObjectId.isValid(id)) {
        return res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid listing ID' } });
      }
      const listing = await marketplaceService.incrementDownload(id);
      res.json(listing);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export default createMarketplaceRouter;