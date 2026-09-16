import { randomBytes } from 'node:crypto';
import { Types } from 'mongoose';
import { Redis } from 'ioredis';
import {
  IdentityProviderModel,
  type IIdentityProvider,
  type IdentityProviderType,
  type IdentityProviderStatus,
  type DomainVerificationStatus,
} from '../models/IdentityProviderModel.js';
import { UserIdentityModel, type IUserIdentity } from '../models/UserIdentityModel.js';
import { UserModel, type IUser } from '../models/UserModel.js';
import { WorkspaceModel } from '../models/WorkspaceModel.js';
import { WorkspaceMemberModel, type WorkspaceRole, type IWorkspaceMember } from '../models/WorkspaceMemberModel.js';
import { permissionsForRole } from '../auth/permissions.js';
import { createAuditLog } from './auditService.js';
import { validateWorkspaceQuota } from './planService.js';
import { OidcProvider, Pkce } from './identity/providers/OidcProvider.js';
import { SamlProvider } from './identity/providers/SamlProvider.js';
import { encryptIdpSecret, decryptIdpSecret } from './identity/crypto.js';
import { issueTokens } from '../auth/auth.service.js';
import type { AuthConfig } from '../auth/jwt.service.js';
import type { SessionContext } from '../auth/auth.service.js';
import { hashPassword } from '../auth/password.service.js';

export interface IdentityProviderView {
  id: string;
  workspaceId: string;
  type: IdentityProviderType;
  name: string;
  status: IdentityProviderStatus;
  issuer: string;
  clientId: string;
  authorizationEndpoint?: string | undefined;
  tokenEndpoint?: string | undefined;
  userinfoEndpoint?: string | undefined;
  jwksUri?: string | undefined;
  scopes: string[];
  domains: string[];
  domainVerificationStatus: DomainVerificationStatus;
  enforceSSO: boolean;
  allowPasswordFallback: boolean;
  roleMapping?: Record<string, unknown> | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface CreateIdentityProviderInput {
  type: IdentityProviderType;
  name: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  authorizationEndpoint?: string | undefined;
  tokenEndpoint?: string | undefined;
  userinfoEndpoint?: string | undefined;
  jwksUri?: string | undefined;
  scopes?: string[] | undefined;
  domains?: string[] | undefined;
  domainVerificationStatus?: DomainVerificationStatus | undefined;
  enforceSSO?: boolean | undefined;
  allowPasswordFallback?: boolean | undefined;
  roleMapping?: Record<string, unknown> | undefined;
}

export interface UpdateIdentityProviderInput {
  name?: string | undefined;
  status?: IdentityProviderStatus | undefined;
  issuer?: string | undefined;
  clientId?: string | undefined;
  clientSecret?: string | undefined;
  authorizationEndpoint?: string | undefined;
  tokenEndpoint?: string | undefined;
  userinfoEndpoint?: string | undefined;
  jwksUri?: string | undefined;
  scopes?: string[] | undefined;
  domains?: string[] | undefined;
  domainVerificationStatus?: DomainVerificationStatus | undefined;
  enforceSSO?: boolean | undefined;
  allowPasswordFallback?: boolean | undefined;
  roleMapping?: Record<string, unknown> | undefined;
}

export interface SSOLoginTransaction {
  workspaceId: string;
  providerId: string;
  nonce: string;
  codeVerifier: string;
  redirectUri?: string | undefined;
  createdAt: number;
}

// In-memory fallback map for state management when Redis is unavailable
const inMemoryStateStore = new Map<string, { transaction: SSOLoginTransaction; expiresAt: number }>();

let redisClient: Redis | null = null;

function getRedisClient(): Redis {
  if (!redisClient) {
    const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
    redisClient = new Redis(url, {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      lazyConnect: false,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 100, 1000)),
    });
    redisClient.on('error', () => {
      // Suppress connection errors during test runs
    });
  }
  return redisClient;
}

export function toProviderView(doc: IIdentityProvider): IdentityProviderView {
  const createdAt = doc.createdAt instanceof Date ? doc.createdAt.toISOString() : new Date(doc.createdAt).toISOString();
  const updatedAt = doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : new Date(doc.updatedAt).toISOString();
  return {
    id: doc._id.toString(),
    workspaceId: doc.workspaceId.toString(),
    type: doc.type,
    name: doc.name,
    status: doc.status,
    issuer: doc.issuer,
    clientId: doc.clientId,
    authorizationEndpoint: doc.authorizationEndpoint,
    tokenEndpoint: doc.tokenEndpoint,
    userinfoEndpoint: doc.userinfoEndpoint,
    jwksUri: doc.jwksUri,
    scopes: doc.scopes || [],
    domains: doc.domains || [],
    domainVerificationStatus: doc.domainVerificationStatus,
    enforceSSO: doc.enforceSSO,
    allowPasswordFallback: doc.allowPasswordFallback,
    roleMapping: doc.roleMapping,
    createdAt,
    updatedAt,
  };
}

export function normalizeDomain(domainOrEmail: string): string {
  const trimmed = domainOrEmail.trim().toLowerCase();
  if (trimmed.includes('@')) {
    const parts = trimmed.split('@');
    return parts[parts.length - 1] ?? trimmed;
  }
  return trimmed;
}

/**
 * Store SSO state & nonce transaction securely in Redis with TTL.
 */
export async function storeLoginTransaction(
  stateOrTx: string | (SSOLoginTransaction & { state: string }),
  transactionOrTtl?: SSOLoginTransaction | number,
  ttlSeconds = 300,
): Promise<void> {
  let state: string;
  let transaction: SSOLoginTransaction;
  let ttl = ttlSeconds;

  if (typeof stateOrTx === 'string') {
    state = stateOrTx;
    transaction = transactionOrTtl as SSOLoginTransaction;
  } else {
    state = stateOrTx.state;
    transaction = stateOrTx;
    if (typeof transactionOrTtl === 'number') {
      ttl = transactionOrTtl;
    }
  }

  const key = `sso:state:${state}`;
  try {
    const redis = getRedisClient();
    await redis.set(key, JSON.stringify(transaction), 'EX', ttl);
  } catch {
    inMemoryStateStore.set(key, {
      transaction,
      expiresAt: Date.now() + ttl * 1000,
    });
  }
}

/**
 * Retrieve and consume (delete) SSO state transaction.
 */
export async function consumeLoginTransaction(state: string): Promise<SSOLoginTransaction | null> {
  const key = `sso:state:${state}`;
  try {
    const redis = getRedisClient();
    const data = await redis.get(key);
    if (data) {
      await redis.del(key);
      return JSON.parse(data) as SSOLoginTransaction;
    }
  } catch {
    // Redis unavailable, fallback to memory
  }

  const inMemory = inMemoryStateStore.get(key);
  if (inMemory) {
    inMemoryStateStore.delete(key);
    if (inMemory.expiresAt > Date.now()) {
      return inMemory.transaction;
    }
  }
  return null;
}

/**
 * Create a new Identity Provider for a workspace.
 */
export async function createIdentityProvider(
  workspaceId: string,
  userId: string,
  input: CreateIdentityProviderInput,
): Promise<IdentityProviderView> {
  if (!Types.ObjectId.isValid(workspaceId)) {
    throw new Error('INVALID_WORKSPACE_ID');
  }

  const workspace = await WorkspaceModel.findById(workspaceId);
  if (!workspace) {
    throw new Error('WORKSPACE_NOT_FOUND');
  }

  // Normalize domains
  const domains = (input.domains ?? []).map(normalizeDomain).filter(Boolean);

  // Encrypt client secret
  const clientSecretEncrypted = encryptIdpSecret(input.clientSecret);

  const createPayload: Record<string, unknown> = {
    workspaceId: new Types.ObjectId(workspaceId),
    type: input.type,
    name: input.name.trim(),
    status: 'ACTIVE',
    issuer: input.issuer.trim(),
    clientId: input.clientId.trim(),
    clientSecretEncrypted,
    scopes: input.scopes && input.scopes.length > 0 ? input.scopes : ['openid', 'profile', 'email'],
    domains,
    domainVerificationStatus: input.domainVerificationStatus ?? 'PENDING',
    enforceSSO: input.enforceSSO ?? false,
    allowPasswordFallback: input.allowPasswordFallback ?? true,
    createdBy: new Types.ObjectId(userId),
  };

  if (input.authorizationEndpoint) createPayload.authorizationEndpoint = input.authorizationEndpoint.trim();
  if (input.tokenEndpoint) createPayload.tokenEndpoint = input.tokenEndpoint.trim();
  if (input.userinfoEndpoint) createPayload.userinfoEndpoint = input.userinfoEndpoint.trim();
  if (input.jwksUri) createPayload.jwksUri = input.jwksUri.trim();
  if (input.roleMapping) createPayload.roleMapping = input.roleMapping;

  const doc = (await IdentityProviderModel.create(createPayload)) as IIdentityProvider & { _id: Types.ObjectId };

  await createAuditLog({
    action: 'SSO_PROVIDER_CREATED',
    userId,
    workspaceId,
    resource: 'identity_provider',
    resourceId: doc._id.toString(),
    metadata: {
      providerId: doc._id.toString(),
      name: doc.name,
      type: doc.type,
      issuer: doc.issuer,
      domains: doc.domains,
    },
  });

  return toProviderView(doc);
}

/**
 * Update an existing Identity Provider.
 */
export async function updateIdentityProvider(
  workspaceId: string,
  providerId: string,
  userId: string,
  input: UpdateIdentityProviderInput,
): Promise<IdentityProviderView> {
  if (!Types.ObjectId.isValid(workspaceId)) {
    throw new Error('INVALID_WORKSPACE_ID');
  }
  if (!Types.ObjectId.isValid(providerId)) {
    throw new Error('INVALID_PROVIDER_ID');
  }

  const provider = await IdentityProviderModel.findOne({
    _id: new Types.ObjectId(providerId),
    workspaceId: new Types.ObjectId(workspaceId),
  });
  if (!provider) {
    throw new Error('SSO_PROVIDER_NOT_FOUND');
  }

  const updateData: Record<string, unknown> = {};
  if (input.name !== undefined) updateData.name = input.name.trim();
  if (input.status !== undefined) updateData.status = input.status;
  if (input.issuer !== undefined) updateData.issuer = input.issuer.trim();
  if (input.clientId !== undefined) updateData.clientId = input.clientId.trim();
  if (input.clientSecret !== undefined) {
    updateData.clientSecretEncrypted = encryptIdpSecret(input.clientSecret);
  }
  if (input.authorizationEndpoint !== undefined) {
    updateData.authorizationEndpoint = input.authorizationEndpoint.trim();
  }
  if (input.tokenEndpoint !== undefined) {
    updateData.tokenEndpoint = input.tokenEndpoint.trim();
  }
  if (input.userinfoEndpoint !== undefined) {
    updateData.userinfoEndpoint = input.userinfoEndpoint.trim();
  }
  if (input.jwksUri !== undefined) {
    updateData.jwksUri = input.jwksUri.trim();
  }
  if (input.scopes !== undefined) {
    updateData.scopes = input.scopes;
  }
  if (input.domains !== undefined) {
    const normalizedDomains = input.domains.map(normalizeDomain).filter(Boolean);
    if (normalizedDomains.length > 0 && (input.domainVerificationStatus === 'VERIFIED' || provider.domainVerificationStatus === 'VERIFIED')) {
      const conflicting = await IdentityProviderModel.findOne({
        _id: { $ne: provider._id },
        workspaceId: { $ne: new Types.ObjectId(workspaceId) },
        domains: { $in: normalizedDomains },
        domainVerificationStatus: 'VERIFIED',
        status: 'ACTIVE',
      });
      if (conflicting) {
        throw new Error('SSO_DOMAIN_NOT_VERIFIED');
      }
    }
    updateData.domains = normalizedDomains;
  }
  if (input.domainVerificationStatus !== undefined) {
    updateData.domainVerificationStatus = input.domainVerificationStatus;
  }
  if (input.enforceSSO !== undefined) {
    updateData.enforceSSO = input.enforceSSO;
  }
  if (input.allowPasswordFallback !== undefined) {
    updateData.allowPasswordFallback = input.allowPasswordFallback;
  }
  if (input.roleMapping !== undefined) {
    updateData.roleMapping = input.roleMapping;
  }

  const updated = await IdentityProviderModel.findOneAndUpdate(
    { _id: provider._id, workspaceId: new Types.ObjectId(workspaceId) },
    { $set: updateData },
    { returnDocument: 'after' },
  );
  if (!updated) {
    throw new Error('SSO_PROVIDER_NOT_FOUND');
  }

  const enforceSSOChanged = input.enforceSSO !== undefined && input.enforceSSO !== provider.enforceSSO;
  if (enforceSSOChanged) {
    await createAuditLog({
      action: 'SSO_ENFORCEMENT_CHANGED',
      userId,
      workspaceId,
      resource: 'identity_provider',
      resourceId: updated._id.toString(),
      metadata: {
        enforceSSO: updated.enforceSSO,
        allowPasswordFallback: updated.allowPasswordFallback,
      },
    });
  }

  await createAuditLog({
    action: 'SSO_PROVIDER_UPDATED',
    userId,
    workspaceId,
    resource: 'identity_provider',
    resourceId: updated._id.toString(),
    metadata: {
      providerId: updated._id.toString(),
      name: updated.name,
      status: updated.status,
    },
  });

  return toProviderView(updated);
}

/**
 * Delete (disable) an Identity Provider.
 */
export async function deleteIdentityProvider(
  workspaceId: string,
  providerId: string,
  userId: string,
): Promise<void> {
  if (!Types.ObjectId.isValid(workspaceId)) {
    throw new Error('INVALID_WORKSPACE_ID');
  }
  if (!Types.ObjectId.isValid(providerId)) {
    throw new Error('INVALID_PROVIDER_ID');
  }

  const provider = await IdentityProviderModel.findOneAndUpdate(
    { _id: new Types.ObjectId(providerId), workspaceId: new Types.ObjectId(workspaceId) },
    { $set: { status: 'DISABLED' } },
    { returnDocument: 'after' },
  );
  if (!provider) {
    throw new Error('SSO_PROVIDER_NOT_FOUND');
  }

  await createAuditLog({
    action: 'SSO_PROVIDER_DISABLED',
    userId,
    workspaceId,
    resource: 'identity_provider',
    resourceId: provider._id.toString(),
    metadata: { providerId: provider._id.toString() },
  });
}

export async function listIdentityProviders(
  workspaceId: string,
): Promise<IdentityProviderView[]> {
  if (!Types.ObjectId.isValid(workspaceId)) {
    throw new Error('INVALID_WORKSPACE_ID');
  }
  const providers = await IdentityProviderModel.find({
    workspaceId: new Types.ObjectId(workspaceId),
  }).sort({ createdAt: -1 });
  return providers.map(toProviderView);
}

export async function getIdentityProvider(
  workspaceId: string,
  providerId: string,
): Promise<IdentityProviderView> {
  if (!Types.ObjectId.isValid(workspaceId)) {
    throw new Error('INVALID_WORKSPACE_ID');
  }
  if (!Types.ObjectId.isValid(providerId)) {
    throw new Error('INVALID_PROVIDER_ID');
  }

  const provider = await IdentityProviderModel.findOne({
    _id: new Types.ObjectId(providerId),
    workspaceId: new Types.ObjectId(workspaceId),
  });
  if (!provider) {
    throw new Error('SSO_PROVIDER_NOT_FOUND');
  }
  return toProviderView(provider);
}

export async function discoverProviders(
  query: { email?: string | undefined; domain?: string | undefined; workspaceId?: string | undefined },
): Promise<IdentityProviderView[]> {
  if (query.email) {
    const provider = await resolveProviderByEmail(query.email);
    return provider ? [toProviderView(provider)] : [];
  }
  if (query.domain) {
    const provider = await resolveProviderByDomain(query.domain);
    return provider ? [toProviderView(provider)] : [];
  }
  if (query.workspaceId) {
    if (!Types.ObjectId.isValid(query.workspaceId)) {
      throw new Error('INVALID_WORKSPACE_ID');
    }
    const providers = await IdentityProviderModel.find({
      workspaceId: new Types.ObjectId(query.workspaceId),
    }).sort({ createdAt: -1 });
    return providers.map(toProviderView);
  }
  throw new Error('INVALID_REQUEST');
}

/**
 * Resolve identity provider by workspace ID
 */
export async function resolveProviderByWorkspace(workspaceId: string): Promise<IIdentityProvider | null> {
  if (!Types.ObjectId.isValid(workspaceId)) return null;
  return IdentityProviderModel.findOne({
    workspaceId: new Types.ObjectId(workspaceId),
    status: 'ACTIVE',
  }).lean();
}

/**
 * Resolve identity provider by verified domain
 */
export async function resolveProviderByDomain(domain: string): Promise<IIdentityProvider | null> {
  if (!domain) return null;
  const normalizedDomain = domain.toLowerCase().trim();
  return IdentityProviderModel.findOne({
    domains: normalizedDomain,
    domainVerificationStatus: 'VERIFIED',
    status: 'ACTIVE',
  }).lean();
}

/**
 * Resolve identity provider by email (extracts domain and looks up provider)
 */
export async function resolveProviderByEmail(email: string): Promise<IIdentityProvider | null> {
  if (!email) return null;
  const parts = email.toLowerCase().trim().split('@');
  if (parts.length !== 2 || !parts[1]) return null;
  return resolveProviderByDomain(parts[1]);
}

/**
 * Start SSO login flow - returns authorization URL and state
 */
export async function startSSOLogin(
  providerId: string,
  redirectUri?: string | undefined,
): Promise<{ authorizationUrl: string; state: string }> {
  if (!Types.ObjectId.isValid(providerId)) {
    throw new Error('INVALID_PROVIDER_ID');
  }

  const provider = await IdentityProviderModel.findById(providerId).select('+clientSecretEncrypted');
  if (!provider) {
    throw new Error('SSO_PROVIDER_NOT_FOUND');
  }
  if (provider.status !== 'ACTIVE') {
    throw new Error('SSO_PROVIDER_DISABLED');
  }

  if (provider.type !== 'OIDC' && provider.type !== 'SAML') {
    throw new Error('Unsupported provider type');
  }

  if (!provider.authorizationEndpoint) {
    throw new Error('SSO_PROVIDER_NOT_FOUND');
  }

  const state = randomBytes(32).toString('hex');
  const nonce = randomBytes(32).toString('hex');
  const codeVerifier = await Pkce.generateVerifier();
  const codeChallenge = await Pkce.challengeFromVerifier(codeVerifier);

  await storeLoginTransaction(state, {
    workspaceId: provider.workspaceId.toString(),
    providerId: provider._id.toString(),
    nonce,
    codeVerifier,
    redirectUri,
    createdAt: Date.now(),
  });

  if (provider.type === 'OIDC') {
    const clientSecret = decryptIdpSecret(provider.clientSecretEncrypted);
    const oidc = new OidcProvider({
      issuer: provider.issuer,
      clientId: provider.clientId,
      clientSecret,
      authorizationEndpoint: provider.authorizationEndpoint,
      tokenEndpoint: provider.tokenEndpoint || '',
      userinfoEndpoint: provider.userinfoEndpoint,
      jwksUri: provider.jwksUri,
      scopes: provider.scopes,
    });

    const authorizationUrl = await oidc.getAuthorizationUrl(state, nonce, redirectUri, codeChallenge);
    return { authorizationUrl, state };
  } else {
    // SAML
    const saml = new SamlProvider({
      issuer: provider.issuer,
      clientId: provider.clientId,
      authorizationEndpoint: provider.authorizationEndpoint,
      tokenEndpoint: provider.tokenEndpoint || '',
      userinfoEndpoint: provider.userinfoEndpoint,
      jwksUri: provider.jwksUri,
      scopes: provider.scopes,
    });

    const authorizationUrl = await saml.getAuthorizationUrl(state, nonce, redirectUri);
    return { authorizationUrl, state };
  }
}

/**
 * Handle SSO callback from identity provider
 */
export async function handleSSOCallback(
  providerId: string,
  code: string,
  state: string,
  authConfig: AuthConfig,
  context: SessionContext = {},
  redirectUri?: string | undefined,
): Promise<{
  accessToken: string;
  refreshToken: string;
  userId: string;
  email: string;
  workspaceId: string;
  isNewUser: boolean;
  isNewIdentityLink: boolean;
}> {
  if (!Types.ObjectId.isValid(providerId)) {
    throw new Error('INVALID_PROVIDER_ID');
  }

  // 1. Consume state from Redis (one-time use)
  const transaction = await consumeLoginTransaction(state);
  if (!transaction) {
    await createAuditLog({
      action: 'SSO_LOGIN_FAILED',
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { reason: 'invalid_or_expired_state', providerId },
    });
    throw new Error('SSO_STATE_INVALID');
  }

  // 2. Validate that state binds to this providerId
  if (transaction.providerId !== providerId) {
    await createAuditLog({
      action: 'SSO_LOGIN_FAILED',
      workspaceId: transaction.workspaceId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { reason: 'provider_mismatch', stateProviderId: transaction.providerId, requestedProviderId: providerId },
    });
    throw new Error('SSO_CALLBACK_INVALID');
  }

  // 3. Load provider document including encrypted secret
  const provider = await IdentityProviderModel.findById(providerId).select('+clientSecretEncrypted');
  if (!provider || provider.status !== 'ACTIVE') {
    throw new Error('SSO_PROVIDER_NOT_FOUND');
  }

  // 4. Decrypt client secret
  let clientSecret = '';
  if (provider.clientSecretEncrypted) {
    clientSecret = decryptIdpSecret(provider.clientSecretEncrypted);
  }

  // 5. Initialize provider instance & exchange code
  if (provider.type === 'OIDC') {
    const oidc = new OidcProvider({
      issuer: provider.issuer,
      clientId: provider.clientId,
      clientSecret,
      authorizationEndpoint: provider.authorizationEndpoint || '',
      tokenEndpoint: provider.tokenEndpoint || '',
      userinfoEndpoint: provider.userinfoEndpoint,
      jwksUri: provider.jwksUri,
      scopes: provider.scopes,
    });

    const effectiveRedirectUri = redirectUri || transaction.redirectUri;
    let tokenResult;
    try {
      tokenResult = await oidc.handleCallback({
        code,
        state,
        redirectUri: effectiveRedirectUri,
        codeVerifier: transaction.codeVerifier,
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await createAuditLog({
        action: 'SSO_LOGIN_FAILED',
        workspaceId: provider.workspaceId.toString(),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: { reason: 'token_exchange_failed', error: errMsg, providerId },
      });
      throw new Error('SSO_CALLBACK_INVALID');
    }

    if (!tokenResult.accessToken && !tokenResult.idToken) {
      await createAuditLog({
        action: 'SSO_LOGIN_FAILED',
        workspaceId: provider.workspaceId.toString(),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: { reason: 'no_tokens_received', providerId: provider._id.toString() },
      });
      throw new Error('SSO_CALLBACK_INVALID');
    }

    // 6. Validate ID Token if present (audience, issuer, expiration, nonce)
    let claims: Record<string, unknown> = {};
    if (tokenResult.idToken) {
      try {
        claims = await oidc.validateIdToken(tokenResult.idToken, transaction.nonce);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await createAuditLog({
          action: 'SSO_LOGIN_FAILED',
          workspaceId: provider.workspaceId.toString(),
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          metadata: { reason: 'id_token_validation_failed', error: errMsg, providerId },
        });
        throw new Error('SSO_CALLBACK_INVALID');
      }
    }

    // 7. Fetch userinfo if access token is present
    let userinfo: Record<string, unknown> = {};
    if (tokenResult.accessToken && provider.userinfoEndpoint) {
      try {
        userinfo = await oidc.getUserInfo(tokenResult.accessToken);
      } catch {
        // Non-fatal if claims already contained essential info
      }
    }

    const mergedProfile = { ...userinfo, ...claims };
    const emailRaw = (mergedProfile.email as string) || (claims.email as string) || (userinfo.email as string);
    if (!emailRaw) {
      await createAuditLog({
        action: 'SSO_LOGIN_FAILED',
        workspaceId: provider.workspaceId.toString(),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: { reason: 'missing_email_in_claims', providerId },
      });
      throw new Error('SSO_CALLBACK_INVALID');
    }

    const email = emailRaw.toLowerCase().trim();
    const providerSubject = (claims.sub as string) || (mergedProfile.sub as string) || (mergedProfile.id as string) || email;

    // Check domain verification if provider has domains configured
    if (provider.domains && provider.domains.length > 0) {
      const emailDomain = email.split('@')[1];
      if (!emailDomain || !provider.domains.includes(emailDomain)) {
        throw new Error('SSO_DOMAIN_NOT_VERIFIED');
      }
    }

    // 8. Find or create User record
    let user = await UserModel.findOne({ email });
    let isNewUser = false;
    if (!user) {
      const dummyPassword = randomBytes(32).toString('hex');
      const passwordHash = await hashPassword(dummyPassword);
      user = await UserModel.create({
        email,
        passwordHash,
        defaultWorkspaceId: provider.workspaceId,
      });
      isNewUser = true;

      await createAuditLog({
        action: 'AUTH_REGISTERED',
        userId: user._id,
        workspaceId: provider.workspaceId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: { email, viaSSO: true },
      });
    }

    // 9. Identity Linking
    const existingIdentity = await UserIdentityModel.findOne({
      providerId: provider._id,
      providerSubject,
    });

    let isNewIdentityLink = false;
    if (existingIdentity) {
      if (existingIdentity.userId.toString() !== user._id.toString()) {
        await createAuditLog({
          action: 'SSO_LOGIN_FAILED',
          workspaceId: provider.workspaceId.toString(),
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          metadata: {
            reason: 'identity_conflict',
            providerId,
            existingUserId: existingIdentity.userId.toString(),
            claimedUserId: user._id.toString(),
          },
        });
        throw new Error('SSO_IDENTITY_CONFLICT');
      }
      existingIdentity.lastLoginAt = new Date();
      existingIdentity.emailVerified = true;
      await existingIdentity.save();
    } else {
      await UserIdentityModel.create({
        userId: user._id,
        workspaceId: provider.workspaceId,
        providerId: provider._id,
        providerType: provider.type,
        providerSubject,
        email,
        emailVerified: true,
        profile: {
          name: mergedProfile.name,
          given_name: mergedProfile.given_name,
          family_name: mergedProfile.family_name,
        },
        lastLoginAt: new Date(),
      });
      isNewIdentityLink = true;

      await createAuditLog({
        action: 'SSO_IDENTITY_LINKED',
        userId: user._id,
        workspaceId: provider.workspaceId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: {
          providerId: provider._id.toString(),
          providerSubject,
          email,
        },
      });
    }

    // 10. Workspace Membership & Role Mapping
    const mappedRole = applyRoleMapping(mergedProfile, provider.roleMapping);
    let membership = await WorkspaceMemberModel.findOne({
      workspaceId: provider.workspaceId,
      userId: user._id,
    });

    if (!membership) {
      await validateWorkspaceQuota(provider.workspaceId.toString(), 'members');
      membership = await WorkspaceMemberModel.create({
        workspaceId: provider.workspaceId,
        userId: user._id,
        role: mappedRole,
        permissions: permissionsForRole(mappedRole),
        status: 'ACTIVE',
      });
      await createAuditLog({
        action: 'WORKSPACE_MEMBER_JOINED',
        userId: user._id,
        workspaceId: provider.workspaceId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: { role: mappedRole, viaSSO: true },
      });
    } else if (membership.status !== 'ACTIVE') {
      membership.status = 'ACTIVE';
      membership.permissions = permissionsForRole(membership.role);
      await membership.save();
    }

    // 11. Issue Application Access & Refresh Tokens
    const tokens = await issueTokens(authConfig, user._id, user.email, context);

    await createAuditLog({
      action: 'SSO_LOGIN_SUCCESS',
      userId: user._id,
      workspaceId: provider.workspaceId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: {
        providerId: provider._id.toString(),
        isNewUser,
        isNewIdentityLink,
      },
    });

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      userId: user._id.toString(),
      email: user.email,
      workspaceId: provider.workspaceId.toString(),
      isNewUser,
      isNewIdentityLink,
    };
  } else {
    // SAML provider - throw not implemented
    throw new Error('SAML_PROTOCOL_NOT_IMPLEMENTED');
  }
}

/**
 * Apply role mapping from provider claims to workspace roles
 */
export function applyRoleMapping(
  profile: Record<string, unknown>,
  roleMapping?: Record<string, unknown> | undefined,
): WorkspaceRole {
  if (!roleMapping || typeof roleMapping !== 'object') {
    return 'VIEWER';
  }

  const groupsOrRoles: string[] = [];
  if (Array.isArray(profile.groups)) {
    groupsOrRoles.push(...profile.groups.filter((g): g is string => typeof g === 'string'));
  }
  if (Array.isArray(profile.roles)) {
    groupsOrRoles.push(...profile.roles.filter((r): r is string => typeof r === 'string'));
  }
  if (typeof profile.role === 'string') {
    groupsOrRoles.push(profile.role);
  }
  if (typeof profile.group === 'string') {
    groupsOrRoles.push(profile.group);
  }

  for (const item of groupsOrRoles) {
    const targetRole = roleMapping[item];
    if (typeof targetRole === 'string') {
      const normalized = targetRole.toUpperCase();
      if (normalized === 'ADMIN') return 'ADMIN';
      if (normalized === 'EDITOR') return 'EDITOR';
      if (normalized === 'VIEWER') return 'VIEWER';
      // Clamping: never allow automated OWNER assignment via SCIM/SSO
      if (normalized === 'OWNER') return 'ADMIN';
    }
  }

  return 'VIEWER';
}