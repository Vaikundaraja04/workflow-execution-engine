import mongoose, { Schema, Document, Types } from 'mongoose';

export type IdentityProviderType = 'OIDC' | 'SAML';
export type IdentityProviderStatus = 'ACTIVE' | 'DISABLED';
export type DomainVerificationStatus = 'VERIFIED' | 'PENDING';

export interface IIdentityProvider extends Document<Types.ObjectId> {
  workspaceId: Types.ObjectId;
  type: IdentityProviderType;
  name: string;
  status: IdentityProviderStatus;
  issuer: string;
  clientId: string;
  clientSecretEncrypted: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  userinfoEndpoint?: string;
  jwksUri?: string;
  scopes: string[];
  domains: string[];
  domainVerificationStatus: DomainVerificationStatus;
  enforceSSO: boolean;
  allowPasswordFallback: boolean;
  roleMapping?: Record<string, unknown>; // Maps provider groups/roles to workspace roles
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const IdentityProviderSchema = new Schema<IIdentityProvider>({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  type: { type: String, enum: ['OIDC', 'SAML'], required: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  status: { type: String, enum: ['ACTIVE', 'DISABLED'], default: 'ACTIVE' },
  issuer: { type: String, required: true, maxlength: 2048 },
  clientId: { type: String, required: true, maxlength: 512 },
  clientSecretEncrypted: { type: String, required: true, select: false }, // Never returned in queries by default
  authorizationEndpoint: { type: String, maxlength: 2048 },
  tokenEndpoint: { type: String, maxlength: 2048 },
  userinfoEndpoint: { type: String, maxlength: 2048 },
  jwksUri: { type: String, maxlength: 2048 },
  scopes: { type: [String], default: ['openid', 'profile', 'email'] },
  domains: { type: [String], default: [] },
  domainVerificationStatus: { type: String, enum: ['VERIFIED', 'PENDING'], default: 'PENDING' },
  enforceSSO: { type: Boolean, default: false },
  allowPasswordFallback: { type: Boolean, default: true },
  roleMapping: { type: Schema.Types.Mixed }, // Flexible mapping of provider claims to workspace roles
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

// Indexes as specified in requirements
IdentityProviderSchema.index({ workspaceId: 1 });
IdentityProviderSchema.index({ workspaceId: 1, type: 1 });
IdentityProviderSchema.index({ domains: 1 });
IdentityProviderSchema.index({ status: 1 });

export const IdentityProviderModel = mongoose.model<IIdentityProvider>('IdentityProvider', IdentityProviderSchema);