import { Types } from 'mongoose';
import { MarketplaceListingModel, MarketplaceVisibility, MarketplaceVerificationStatus } from '../models/MarketplaceListingModel.js';
import { WorkflowTemplateModel } from '../models/WorkflowTemplateModel.js';
import { UserModel } from '../models/UserModel.js';
import { createAuditLog } from './auditService.js';

export class MarketplaceService {
  /**
   * Get marketplace listings with filters and pagination
   * @param filters - Filter criteria
   * @param pagination - Pagination options
   * @returns Array of marketplace listings with populated template data
   */
  async getTemplates(
    filters: {
      category?: string | undefined;
      verificationStatus?: MarketplaceVerificationStatus | undefined;
      searchText?: string | undefined;
      minRating?: number | undefined;
    } = {},
    pagination: {
      page?: number | undefined;
      limit?: number | undefined;
      sortBy?: 'rankingScore' | 'statistics.downloads' | 'createdAt' | undefined;
      sortOrder?: 'asc' | 'desc' | undefined;
    } = {}
  ) {
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 20;
    const skip = (page - 1) * limit;

    const sortOptions: Record<string, 1 | -1> = {};
    const sortBy = pagination.sortBy ?? 'rankingScore';
    const sortOrder = pagination.sortOrder ?? 'desc';
    sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Build match query
    const matchQuery: any = {
      visibility: MarketplaceVisibility.MARKETPLACE,
    };

    if (filters.category) {
      matchQuery.category = filters.category;
    }

    if (filters.verificationStatus) {
      matchQuery.verificationStatus = filters.verificationStatus;
    }

    if (filters.searchText) {
      matchQuery.$text = { $search: filters.searchText };
    }

    if (filters.minRating !== undefined) {
      matchQuery['statistics.rating'] = { $gte: filters.minRating };
    }

    const listings = await MarketplaceListingModel.aggregate([
      { $match: matchQuery },
      {
        $lookup: {
          from: 'workflowtemplates',
          localField: 'templateId',
          foreignField: '_id',
          as: 'template',
        },
      },
      { $unwind: '$template' },
      {
        $lookup: {
          from: 'users',
          localField: 'publisherId',
          foreignField: '_id',
          as: 'publisher',
        },
      },
      { $unwind: '$publisher' },
      {
        $project: {
          _id: 1,
          templateId: 1,
          publisherId: 1,
          visibility: 1,
          verificationStatus: 1,
          rankingScore: 1,
          category: 1,
          statistics: 1,
          createdAt: 1,
          updatedAt: 1,
          template: {
            _id: 1,
            name: 1,
            description: 1,
            category: 1,
            visibility: 1,
            status: 1,
            publisherId: 1,
            statistics: 1,
            rating: 1,
            createdAt: 1,
            updatedAt: 1,
          },
          publisher: {
            _id: 1,
            firstName: 1,
            lastName: 1,
            email: 1,
            organization: 1,
          },
        },
      },
      { $sort: sortOptions },
      { $skip: skip },
      { $limit: limit },
    ]);

    // Get total count for pagination
    const totalCount = await MarketplaceListingModel.countDocuments(matchQuery);

    return {
      listings,
      pagination: {
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit),
        totalCount,
      },
    };
  }

  /**
   * Get a single marketplace listing by ID with populated data
   * @param listingId - The marketplace listing ID
   * @returns The marketplace listing with populated template and publisher data
   */
  async getTemplateById(listingId: Types.ObjectId | string) {
    const listingIdObj = typeof listingId === 'string' ? new Types.ObjectId(listingId) : listingId;

    const listing = await MarketplaceListingModel.aggregate([
      { $match: { _id: listingIdObj } },
      {
        $lookup: {
          from: 'workflowtemplates',
          localField: 'templateId',
          foreignField: '_id',
          as: 'template',
        },
      },
      { $unwind: '$template' },
      {
        $lookup: {
          from: 'users',
          localField: 'publisherId',
          foreignField: '_id',
          as: 'publisher',
        },
      },
      { $unwind: '$publisher' },
      {
        $project: {
          _id: 1,
          templateId: 1,
          publisherId: 1,
          visibility: 1,
          verificationStatus: 1,
          rankingScore: 1,
          category: 1,
          statistics: 1,
          createdAt: 1,
          updatedAt: 1,
          template: {
            _id: 1,
            name: 1,
            description: 1,
            category: 1,
            visibility: 1,
            status: 1,
            marketplaceStatus: 1,
            publisherId: 1,
            workflowDefinition: 1,
            latestVersion: 1,
            versionCount: 1,
            tags: 1,
            metadata: 1,
            statistics: 1,
            rating: 1,
            ratingsList: 1,
            createdAt: 1,
            updatedAt: 1,
          },
          publisher: {
            _id: 1,
            firstName: 1,
            lastName: 1,
            email: 1,
            organization: 1,
            createdAt: 1,
          },
        },
      },
    ]);

    if (!listing || listing.length === 0) {
      throw new Error('LISTING_NOT_FOUND');
    }

    return listing[0];
  }

  /**
   * Publish a template to the marketplace
   * @param templateId - The template ID to publish
   * @param userId - The user ID publishing the template
   * @returns The created marketplace listing
   */
  async publishTemplate(templateId: Types.ObjectId | string, userId: Types.ObjectId | string) {
    const templateIdObj = typeof templateId === 'string' ? new Types.ObjectId(templateId) : templateId;
    const userIdObj = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;

    // Verify template exists and user has permission
    const template = await WorkflowTemplateModel.findById(templateIdObj);
    if (!template) {
      throw new Error('TEMPLATE_NOT_FOUND');
    }

    // Check if user is the creator or has publish permission
    if (template.createdBy.toString() !== userIdObj.toString()) {
      // In a real implementation, we would check permissions here
      // For now, we'll allow the creator to publish
      throw new Error('TEMPLATE_PUBLISH_ERROR');
    }

    // Check if already published
    const existingListing = await MarketplaceListingModel.findOne({ templateId: templateIdObj });
    if (existingListing) {
      throw new Error('TEMPLATE_PUBLISH_ERROR');
    }

    // Create marketplace listing
    const listing = await MarketplaceListingModel.create({
      templateId: templateIdObj,
      publisherId: userIdObj,
      visibility: MarketplaceVisibility.MARKETPLACE,
      verificationStatus: MarketplaceVerificationStatus.UNVERIFIED,
      rankingScore: 0,
      category: template.category,
      statistics: {
        downloads: 0,
        installs: 0,
        executions: 0,
        rating: 0,
        ratingCount: 0,
      },
    });

    // Update template marketplace status
    template.marketplaceStatus = 'SUBMITTED';
    await template.save();

    // Create audit log
    await createAuditLog({
      action: 'TEMPLATE_PUBLISHED',
      workspaceId: template.workspaceId,
      resource: 'marketplaceListing',
      resourceId: listing._id.toString(),
      userId: userIdObj,
      metadata: {
        templateId: templateIdObj.toString(),
        verificationStatus: listing.verificationStatus,
      },
    });

    return listing;
  }

  /**
   * Approve a marketplace listing (admin only)
   * @param listingId - The marketplace listing ID
   * @param adminId - The admin user ID
   * @param feature - Whether to feature the template
   * @returns The updated marketplace listing
   */
  async approveTemplate(
    listingId: Types.ObjectId | string,
    adminId: Types.ObjectId | string,
    feature: boolean = false
  ) {
    const listingIdObj = typeof listingId === 'string' ? new Types.ObjectId(listingId) : listingId;
    const adminIdObj = typeof adminId === 'string' ? new Types.ObjectId(adminId) : adminId;

    const listing = await MarketplaceListingModel.findById(listingIdObj);
    if (!listing) {
      throw new Error('LISTING_NOT_FOUND');
    }

    listing.verificationStatus = feature ? MarketplaceVerificationStatus.FEATURED : MarketplaceVerificationStatus.VERIFIED;
    await listing.save();

    // Update template marketplace status
    const template = await WorkflowTemplateModel.findById(listing.templateId);
    if (template) {
      template.marketplaceStatus = 'APPROVED';
      await template.save();
    }

    // Create audit log
    await createAuditLog({
      action: feature ? 'TEMPLATE_FEATURED' : 'TEMPLATE_VERIFIED',
      workspaceId: template?.workspaceId,
      resource: 'marketplaceListing',
      resourceId: listing._id.toString(),
      userId: adminIdObj,
      metadata: {
        templateId: listing.templateId.toString(),
        verificationStatus: listing.verificationStatus,
        featured: feature,
      },
    });

    return listing;
  }

  /**
   * Reject a marketplace listing (admin only)
   * @param listingId - The marketplace listing ID
   * @param adminId - The admin user ID
   * @param reason - Reason for rejection
   * @returns The updated marketplace listing
   */
  async rejectTemplate(
    listingId: Types.ObjectId | string,
    adminId: Types.ObjectId | string,
    reason: string
  ) {
    const listingIdObj = typeof listingId === 'string' ? new Types.ObjectId(listingId) : listingId;
    const adminIdObj = typeof adminId === 'string' ? new Types.ObjectId(adminId) : adminId;

    const listing = await MarketplaceListingModel.findById(listingIdObj);
    if (!listing) {
      throw new Error('LISTING_NOT_FOUND');
    }

    listing.verificationStatus = MarketplaceVerificationStatus.UNVERIFIED;
    // In a real implementation, we might want to keep track of rejections
    await listing.save();

    // Update template marketplace status
    const template = await WorkflowTemplateModel.findById(listing.templateId);
    if (template) {
      template.marketplaceStatus = 'REJECTED';
      await template.save();
    }

    // Create audit log
    await createAuditLog({
      action: 'TEMPLATE_REJECTED',
      workspaceId: template?.workspaceId,
      resource: 'marketplaceListing',
      resourceId: listing._id.toString(),
      userId: adminIdObj,
      metadata: {
        templateId: listing.templateId.toString(),
        reason,
      },
    });

    return listing;
  }

  /**
   * Add a review to a marketplace listing
   * @param listingId - The marketplace listing ID
   * @param userId - The user ID leaving the review
   * @param rating - Rating from 1 to 5
   * @param review - Optional review text
   * @returns The updated marketplace listing
   */
  async addReview(
    listingId: Types.ObjectId | string,
    userId: Types.ObjectId | string,
    rating: number,
    review?: string
  ) {
    const listingIdObj = typeof listingId === 'string' ? new Types.ObjectId(listingId) : listingId;
    const userIdObj = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;

    if (rating < 1 || rating > 5) {
      throw new Error('INVALID_RATING');
    }

    const listing = await MarketplaceListingModel.findById(listingIdObj);
    if (!listing) {
      throw new Error('LISTING_NOT_FOUND');
    }

    // Verify user has installed/used the template (simplified check)
    // In a real implementation, we would check execution history or installation records

    // Update rating statistics
    const newRatingCount = listing.statistics.ratingCount + 1;
    const newRating =
      (listing.statistics.rating * listing.statistics.ratingCount + rating) /
      newRatingCount;

    listing.statistics.rating = newRating;
    listing.statistics.ratingCount = newRatingCount;

    // Add to ratings list (simplified - in production we'd use a separate collection)
    // For now, we'll just update the aggregate rating

    // Recalculate ranking score
    listing.rankingScore = this.calculateRankingScore(listing);

    await listing.save();

    // Update template rating
    const template = await WorkflowTemplateModel.findById(listing.templateId);
    if (template) {
      template.rating.average = newRating;
      template.rating.count = newRatingCount;
      await template.save();
    }

    // Create audit log
    await createAuditLog({
      action: 'TEMPLATE_REVIEWED',
      workspaceId: template?.workspaceId,
      resource: 'marketplaceListing',
      resourceId: listing._id.toString(),
      userId: userIdObj,
      metadata: {
        templateId: listing.templateId.toString(),
        rating,
        review: !!review,
      },
    });

    return listing;
  }

  /**
   * Increment download count for a listing
   * @param listingId - The marketplace listing ID
   * @returns The updated marketplace listing
   */
  async incrementDownload(listingId: Types.ObjectId | string) {
    const listingIdObj = typeof listingId === 'string' ? new Types.ObjectId(listingId) : listingId;

    const listing = await MarketplaceListingModel.findById(listingIdObj);
    if (!listing) {
      throw new Error('LISTING_NOT_FOUND');
    }

    listing.statistics.downloads += 1;
    listing.rankingScore = this.calculateRankingScore(listing);
    await listing.save();

    // Update template download count
    const template = await WorkflowTemplateModel.findById(listing.templateId);
    if (template) {
      template.statistics.downloads += 1;
      await template.save();
    }

    return listing;
  }

  /**
   * Calculate ranking score for a marketplace listing
   * @param listing - The marketplace listing
   * @returns Ranking score (higher is better)
   */
  private calculateRankingScore(listing: any): number {
    // Simple ranking algorithm based on:
    // - Recency (newer gets higher score)
    // - Downloads (more downloads = higher score)
    // - Rating (higher rating = higher score)
    // - Verification status (verified/featured gets boost)

    const now = new Date();
    const daysOld = (now.getTime() - listing.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    const recencyScore = Math.max(0, 100 - daysOld); // Newer listings get higher score

    const downloadScore = Math.min(listing.statistics.downloads / 10, 100); // Cap at 100 downloads for max score
    const ratingScore = listing.statistics.rating * 20; // 0-5 rating -> 0-100 score

    let verificationBoost = 0;
    switch (listing.verificationStatus) {
      case MarketplaceVerificationStatus.VERIFIED:
        verificationBoost = 20;
        break;
      case MarketplaceVerificationStatus.FEATURED:
        verificationBoost = 40;
        break;
      default:
        verificationBoost = 0;
    }

    // Weighted combination
    const score =
      recencyScore * 0.3 +
      downloadScore * 0.3 +
      ratingScore * 0.2 +
      verificationBoost * 0.2;

    return Math.round(score * 10) / 10; // Round to 1 decimal place
  }

  /**
   * Recalculate ranking scores for all listings (periodic job)
   */
  async recalculateAllRankingScores() {
    const listings = await MarketplaceListingModel.find({});
    for (const listing of listings) {
      listing.rankingScore = this.calculateRankingScore(listing);
      await listing.save();
    }
  }
}

// Export a singleton instance
export const marketplaceService = new MarketplaceService();