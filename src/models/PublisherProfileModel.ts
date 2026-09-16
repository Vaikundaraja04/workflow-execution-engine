import mongoose, { Schema, Document, Types } from 'mongoose';

export const MARKETPLACE_STATUS = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
] as const;

export type MarketplaceStatus = (typeof MARKETPLACE_STATUS)[number];

export interface IPublisherProfile extends Document<Types.ObjectId> {
  userId: Types.ObjectId;
  displayName: string;
  description?: string | undefined;
  verified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const PublisherProfileSchema = new Schema<IPublisherProfile>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  displayName: { type: String, required: true, maxlength: 100 },
  description: { type: String, maxlength: 500 },
  verified: { type: Boolean, default: false },
}, { timestamps: true, minimize: false });

export const PublisherProfileModel = mongoose.model<IPublisherProfile>('PublisherProfile', PublisherProfileSchema);
