import { Schema, model, Document, Types } from 'mongoose';

export enum MarketplaceVisibility {
  PUBLIC = 'PUBLIC',
  MARKETPLACE = 'MARKETPLACE',
  PRIVATE = 'PRIVATE'
}

export enum MarketplaceVerificationStatus {
  UNVERIFIED = 'UNVERIFIED',
  VERIFIED = 'VERIFIED',
  FEATURED = 'FEATURED'
}

export interface MarketplaceListingDocument extends Document<Types.ObjectId> {
  templateId: Types.ObjectId;
  publisherId: Types.ObjectId;
  visibility: MarketplaceVisibility;
  verificationStatus: MarketplaceVerificationStatus;
  rankingScore: number;
  category: string;
  statistics: {
    downloads: number;
    installs: number;
    executions: number;
    rating: number;
    ratingCount: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const MarketplaceListingSchema = new Schema<MarketplaceListingDocument>({
  templateId: {
    type: Schema.Types.ObjectId,
    ref: 'WorkflowTemplate',
    required: true,
  },
  publisherId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  visibility: {
    type: String,
    enum: Object.values(MarketplaceVisibility),
    default: MarketplaceVisibility.MARKETPLACE,
  },
  verificationStatus: {
    type: String,
    enum: Object.values(MarketplaceVerificationStatus),
    default: MarketplaceVerificationStatus.UNVERIFIED,
  },
  rankingScore: {
    type: Number,
    default: 0,
    index: true,
  },
  category: {
    type: String,
    required: true,
    index: true,
  },
  statistics: {
    downloads: { type: Number, default: 0 },
    installs: { type: Number, default: 0 },
    executions: { type: Number, default: 0 },
    rating: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
  },
}, {
  timestamps: true,
});

// Indexes for common queries
MarketplaceListingSchema.index({ verificationStatus: 1, category: 1 });
MarketplaceListingSchema.index({ rankingScore: -1 });
MarketplaceListingSchema.index({ 'statistics.downloads': -1 });

export const MarketplaceListingModel = model<MarketplaceListingDocument>('MarketplaceListing', MarketplaceListingSchema);
