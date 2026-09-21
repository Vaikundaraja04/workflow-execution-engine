import mongoose, { Schema, Document, Types } from 'mongoose';

export const MARKETPLACE_STATUS = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
] as const;

export type MarketplaceStatus = (typeof MARKETPLACE_STATUS)[number];

export const PUBLISHER_TYPES = ['INDIVIDUAL', 'ENTERPRISE'] as const;
export type PublisherType = (typeof PUBLISHER_TYPES)[number];

export interface IPublisherProfile extends Document<Types.ObjectId> {
  userId: Types.ObjectId;
  displayName: string;
  description?: string | undefined;
  verified: boolean;
  publisherType: PublisherType;
  website?: string | undefined;
  stats: {
    publishedAgents: number;
    totalInstalls: number;
    averageRating: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const PublisherProfileSchema = new Schema<IPublisherProfile>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  displayName: { type: String, required: true, maxlength: 100 },
  description: { type: String, maxlength: 500 },
  verified: { type: Boolean, default: false },
  publisherType: { type: String, enum: [...PUBLISHER_TYPES], default: 'INDIVIDUAL' },
  website: { type: String, maxlength: 200 },
  stats: {
    publishedAgents: { type: Number, default: 0 },
    totalInstalls: { type: Number, default: 0 },
    averageRating: { type: Number, default: 0 },
  },
}, { timestamps: true, minimize: false });

export const PublisherProfileModel = mongoose.model<IPublisherProfile>('PublisherProfile', PublisherProfileSchema);