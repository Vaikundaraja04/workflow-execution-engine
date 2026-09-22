import { Types } from 'mongoose';
import { MarketplaceReviewModel, REVIEW_ABUSE_REPORT_THRESHOLD } from '../models/MarketplaceReviewModel.js';
import type { ReviewStatus } from '../models/MarketplaceReviewModel.js';
import { MarketplaceLicenseModel } from '../models/MarketplaceLicenseModel.js';
import { RevenueTransactionModel } from '../models/RevenueTransactionModel.js';
import { AgentMarketplaceModel } from '../models/AgentMarketplaceModel.js';
import { WorkflowTemplateMarketplaceModel } from '../models/WorkflowTemplateMarketplaceModel.js';
import type { MarketplaceAssetType } from '../models/MarketplacePricingModel.js';
import { createAuditLog } from './auditService.js';

/**
 * Phase 17.7 - Marketplace reviews and trust.
 *
 * One review per workspace per asset, allowed only after a settled purchase or
 * with an ACTIVE license. Ratings are computed from published reviews only -
 * repeat abuse reports hide a review (audited), platform administrators can
 * hide or restore, and a reviewer is never identified beyond the workspace id.
 */

export interface ReviewInput {
  assetType: MarketplaceAssetType;
  assetId: string;
  workspaceId: string;
  userId: string;
  rating: number;
  review?: string | undefined;
}

export interface ReviewView {
  reviewId: string;
  assetType: MarketplaceAssetType;
  assetId: string;
  workspaceId: string;
  rating: number;
  review: string | null;
  verifiedPurchase: boolean;
  status: ReviewStatus;
  createdAt: string;
}

export interface RatingSummary {
  average: number;
  count: number;
  distribution: Record<number, number>;
}
const RATING_BUCKETS = [1, 2, 3, 4, 5] as const;

function emptyDistribution(): Record<number, number> {
  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  return distribution;
}

function viewFor(row: {
  _id: Types.ObjectId;
  assetType: MarketplaceAssetType;
  assetId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  rating: number;
  review: string | null;
  verifiedPurchase: boolean;
  status: ReviewStatus;
  createdAt: Date;
}): ReviewView {
  return {
    reviewId: row._id.toString(),
    assetType: row.assetType,
    assetId: row.assetId.toString(),
    workspaceId: row.workspaceId.toString(),
    rating: row.rating,
    review: row.review,
    verifiedPurchase: row.verifiedPurchase,
    status: row.status,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

export class MarketplaceReviewService {
  private async resolvePublisherId(assetType: MarketplaceAssetType, assetId: Types.ObjectId): Promise<Types.ObjectId> {
    if (assetType === 'AGENT') {
      const listing = await AgentMarketplaceModel.findById(assetId).select('publisherId').lean();
      if (!listing) throw new Error('LISTING_NOT_FOUND');
      return listing.publisherId;
    }
    const listing = await WorkflowTemplateMarketplaceModel.findOne({ templateId: assetId }).select('publisherId').lean();
    if (!listing) throw new Error('WORKFLOW_LISTING_NOT_FOUND');
    return listing.publisherId;
  }
  /** True when the workspace bought the asset: an ACTIVE license or a settled payment. */
  private async hasVerifiedAccess(assetType: MarketplaceAssetType, assetId: Types.ObjectId, workspaceId: Types.ObjectId) {
    const license = await MarketplaceLicenseModel.findOne({ workspaceId, assetType, assetId }).lean();
    if (license && license.status === 'ACTIVE' && (!license.expiresAt || license.expiresAt.getTime() > Date.now())) {
      return { allowed: true, verifiedPurchase: license.paymentId !== null };
    }
    const purchase = await RevenueTransactionModel.exists({
      buyerWorkspaceId: workspaceId,
      assetType,
      assetId,
      status: { $in: ['AVAILABLE', 'PAID_OUT'] },
    });
    return { allowed: purchase !== null, verifiedPurchase: purchase !== null };
  }

  /** One review per workspace per asset, gated by a verified purchase or license. */
  async createReview(input: ReviewInput): Promise<ReviewView> {
    if (!Types.ObjectId.isValid(input.assetId)) {
      throw new Error(input.assetType === 'AGENT' ? 'LISTING_NOT_FOUND' : 'WORKFLOW_LISTING_NOT_FOUND');
    }
    const assetId = new Types.ObjectId(input.assetId);
    const workspaceId = new Types.ObjectId(input.workspaceId);
    const rating = Math.floor(input.rating);
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) throw new Error('INVALID_RATING');

    const publisherId = await this.resolvePublisherId(input.assetType, assetId);
    const existing = await MarketplaceReviewModel.findOne({ assetType: input.assetType, assetId, workspaceId });
    if (existing) throw new Error('REVIEW_ALREADY_EXISTS');
    const access = await this.hasVerifiedAccess(input.assetType, assetId, workspaceId);
    if (!access.allowed) throw new Error('REVIEW_NOT_ALLOWED');

    const review = await MarketplaceReviewModel.create({
      assetType: input.assetType,
      assetId,
      workspaceId,
      userId: new Types.ObjectId(input.userId),
      publisherId,
      rating,
      review: input.review?.trim() ? input.review.trim() : null,
      verifiedPurchase: access.verifiedPurchase,
      status: 'PUBLISHED',
      abuseReports: [],
      hiddenReason: null,
    });

    await createAuditLog({
      action: 'MARKETPLACE_REVIEW_CREATED',
      userId: input.userId,
      workspaceId,
      resource: 'marketplace_review',
      resourceId: review._id.toString(),
      metadata: {
        assetType: input.assetType,
        assetId: assetId.toString(),
        rating,
        verifiedPurchase: access.verifiedPurchase,
      },
    });

    return viewFor(review);
  }
  /** Published reviews for one asset with the rating summary. */
  async listReviews(input: {
    assetType: MarketplaceAssetType;
    assetId: string;
    page?: number | undefined;
    limit?: number | undefined;
  }) {
    if (!Types.ObjectId.isValid(input.assetId)) {
      throw new Error(input.assetType === 'AGENT' ? 'LISTING_NOT_FOUND' : 'WORKFLOW_LISTING_NOT_FOUND');
    }
    const assetId = new Types.ObjectId(input.assetId);
    const page = Number.isFinite(input.page) && input.page && input.page > 0 ? Math.floor(input.page) : 1;
    const limit = Number.isFinite(input.limit) && input.limit && input.limit > 0 ? Math.min(50, Math.floor(input.limit)) : 20;

    const query = { assetType: input.assetType, assetId, status: 'PUBLISHED' as const };
    const [total, rows, distribution] = await Promise.all([
      MarketplaceReviewModel.countDocuments(query),
      MarketplaceReviewModel.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      MarketplaceReviewModel.aggregate<{ _id: number; count: number }>([
        { $match: query },
        { $group: { _id: '$rating', count: { $sum: 1 } } },
      ]),
    ]);

    const counts = emptyDistribution();
    let sum = 0;
    let count = 0;
    for (const bucket of distribution) {
      counts[bucket._id] = bucket.count;
      count += bucket.count;
      sum += bucket._id * bucket.count;
    }
    const summary: RatingSummary = {
      average: count > 0 ? Math.round((sum / count) * 10) / 10 : 0,
      count,
      distribution: counts,
    };

    return { items: rows.map((row) => viewFor(row)), summary, page, limit, total, generatedAt: new Date().toISOString() };
  }
  /** Report a review; when reports reach the threshold it is hidden and audited. */
  async reportAbuse(reviewId: string, reporterUserId: string) {
    if (!Types.ObjectId.isValid(reviewId)) throw new Error('REVIEW_NOT_FOUND');
    const review = await MarketplaceReviewModel.findById(reviewId);
    if (!review) throw new Error('REVIEW_NOT_FOUND');

    const reporter = new Types.ObjectId(reporterUserId);
    if (!review.userId.equals(reporter) && !review.abuseReports.some((entry) => entry.equals(reporter))) {
      review.abuseReports.push(reporter);
    }
    const hidden = review.abuseReports.length >= REVIEW_ABUSE_REPORT_THRESHOLD && review.status === 'PUBLISHED';
    if (hidden) {
      review.status = 'HIDDEN';
      review.hiddenReason = 'Reported by multiple buyers';
    }
    await review.save();

    if (hidden) {
      await createAuditLog({
        action: 'MARKETPLACE_REVIEW_HIDDEN',
        userId: reporterUserId,
        resource: 'marketplace_review',
        resourceId: review._id.toString(),
        metadata: {
          assetType: review.assetType,
          assetId: review.assetId.toString(),
          reports: review.abuseReports.length,
          reason: review.hiddenReason,
          automatic: true,
        },
      });
    }

    return { reviewId: review._id.toString(), reports: review.abuseReports.length, status: review.status };
  }
  /** Platform admin moderation: hide or restore a review (audited). */
  async moderateReview(reviewId: string, input: { status: ReviewStatus; reason?: string | undefined }, actorUserId: string) {
    if (!Types.ObjectId.isValid(reviewId)) throw new Error('REVIEW_NOT_FOUND');
    const review = await MarketplaceReviewModel.findById(reviewId);
    if (!review) throw new Error('REVIEW_NOT_FOUND');

    review.status = input.status;
    review.hiddenReason = input.status === 'HIDDEN' ? (input.reason ?? 'Hidden by platform moderator') : null;
    await review.save();

    await createAuditLog({
      action: 'MARKETPLACE_REVIEW_HIDDEN',
      userId: actorUserId,
      resource: 'marketplace_review',
      resourceId: review._id.toString(),
      metadata: {
        assetType: review.assetType,
        assetId: review.assetId.toString(),
        status: input.status,
        reason: review.hiddenReason,
        automatic: false,
      },
    });

    return viewFor(review);
  }

  /** Per-asset rating summary for a publisher's portfolio. */
  async publisherRatingSummary(publisherId: Types.ObjectId) {
    const rows = await MarketplaceReviewModel.aggregate<{ _id: Types.ObjectId; average: number; count: number }>([
      { $match: { publisherId, status: 'PUBLISHED' } },
      { $group: { _id: '$assetId', average: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]);
    const map = new Map<string, { average: number; count: number }>();
    for (const row of rows) {
      map.set(row._id.toString(), { average: Math.round(row.average * 10) / 10, count: row.count });
    }
    return map;
  }
}

export const marketplaceReviewService = new MarketplaceReviewService();
