import mongoose, { Schema, Document, Types } from 'mongoose';

export type ProviderType = 'OIDC' | 'SAML';

export interface IUserIdentity extends Document<Types.ObjectId> {
  userId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  providerId: Types.ObjectId;
  providerType: ProviderType;
  providerSubject: string;
  email: string;
  emailVerified: boolean;
  profile?: Schema.Types.Mixed;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const UserIdentitySchema = new Schema<IUserIdentity>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  providerId: { type: Schema.Types.ObjectId, ref: 'IdentityProvider', required: true },
  providerType: { type: String, enum: ['OIDC', 'SAML'], required: true },
  providerSubject: { type: String, required: true, maxlength: 512 },
  email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
  emailVerified: { type: Boolean, default: false },
  profile: { type: Schema.Types.Mixed },
  lastLoginAt: { type: Date },
}, { timestamps: true });

UserIdentitySchema.index({ providerId: 1, providerSubject: 1 }, { unique: true });
UserIdentitySchema.index({ workspaceId: 1, providerId: 1, email: 1 }, { unique: true });
UserIdentitySchema.index({ userId: 1, providerId: 1 });

export const UserIdentityModel = mongoose.model<IUserIdentity>('UserIdentity', UserIdentitySchema);