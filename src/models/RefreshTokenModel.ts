import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IRefreshToken extends Document<Types.ObjectId> {
  userId: Types.ObjectId;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  revoked: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const RefreshTokenSchema = new Schema<IRefreshToken>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  tokenHash: { type: String, required: true, unique: true },
  familyId: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  revoked: { type: Boolean, required: true, default: false },
}, { timestamps: true });

RefreshTokenSchema.index({ userId: 1 });
RefreshTokenSchema.index({ familyId: 1 });

export const RefreshTokenModel = mongoose.model<IRefreshToken>('RefreshToken', RefreshTokenSchema);