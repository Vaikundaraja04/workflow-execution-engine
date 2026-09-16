import { randomBytes, createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { SCIMTokenModel, type ISCIMToken } from '../models/SCIMTokenModel.js';
import { UserModel, type IUser } from '../models/UserModel.js';
import { WorkspaceMemberModel, type IWorkspaceMember, type WorkspaceRole } from '../models/WorkspaceMemberModel.js';
import { permissionsForRole } from '../auth/permissions.js';
import { createAuditLog } from './auditService.js';
import { validateWorkspaceQuota } from './planService.js';
import { hashPassword } from '../auth/password.service.js';

export interface SCIMUserResource {
  schemas: string[];
  id: string;
  userName: string;
  name?: {
    givenName?: string | undefined;
    familyName?: string | undefined;
    formatted?: string | undefined;
  } | undefined;
  emails: Array<{
    value: string;
    primary: boolean;
    type?: string | undefined;
  }>;
  active: boolean;
  roles?: Array<{
    value: string;
    primary?: boolean | undefined;
  }> | undefined;
  meta: {
    resourceType: 'User';
    created: string;
    lastModified: string;
    location: string;
  };
}

export interface SCIMListResponse<T> {
  schemas: string[];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  Resources: T[];
}

export interface SCIMTokenView {
  id: string;
  workspaceId: string;
  prefix: string;
  description?: string | undefined;
  status: 'ACTIVE' | 'REVOKED';
  expiresAt: string;
  lastUsedAt?: string | undefined;
  createdAt: string;
}

export function toSCIMTokenView(doc: ISCIMToken): SCIMTokenView {
  const createdAt = doc.createdAt instanceof Date ? doc.createdAt.toISOString() : new Date(doc.createdAt).toISOString();
  const expiresAt = doc.expiresAt instanceof Date ? doc.expiresAt.toISOString() : new Date(doc.expiresAt).toISOString();
  let lastUsedAt: string | undefined;
  if (doc.lastUsedAt) {
    lastUsedAt = doc.lastUsedAt instanceof Date ? doc.lastUsedAt.toISOString() : new Date(doc.lastUsedAt).toISOString();
  }
  return {
    id: doc._id.toString(),
    workspaceId: doc.workspaceId.toString(),
    prefix: doc.prefix,
    description: doc.description,
    status: doc.status,
    expiresAt,
    lastUsedAt,
    createdAt,
  };
}

export function toSCIMUserResource(user: IUser, member: IWorkspaceMember, baseUrl = ''): SCIMUserResource {
  const created = member.createdAt instanceof Date ? member.createdAt.toISOString() : new Date(member.createdAt).toISOString();
  const lastModified = member.updatedAt instanceof Date ? member.updatedAt.toISOString() : new Date(member.updatedAt).toISOString();
  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
    id: user._id.toString(),
    userName: user.email,
    emails: [
      {
        value: user.email,
        primary: true,
        type: 'work',
      },
    ],
    active: member.status === 'ACTIVE',
    roles: [
      {
        value: member.role,
        primary: true,
      },
    ],
    meta: {
      resourceType: 'User',
      created,
      lastModified,
      location: `${baseUrl}/scim/v2/Users/${user._id.toString()}`,
    },
  };
}

/**
 * Generate a new SCIM API Bearer token for a workspace
 */
export async function createSCIMToken(
  workspaceId: string,
  userId: string,
  description?: string,
  expiresInDays = 365,
): Promise<{ token: string; scimToken: SCIMTokenView }> {
  if (!Types.ObjectId.isValid(workspaceId)) {
    throw new Error('INVALID_WORKSPACE_ID');
  }

  const rawSecret = randomBytes(32).toString('hex');
  const token = `scim_${rawSecret}`;
  const prefix = rawSecret.slice(0, 8);
  const tokenHash = createHash('sha256').update(rawSecret).digest('hex');

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + (expiresInDays || 365));

  const createPayload: Record<string, unknown> = {
    workspaceId: new Types.ObjectId(workspaceId),
    tokenHash,
    prefix,
    status: 'ACTIVE',
    createdBy: new Types.ObjectId(userId),
    expiresAt,
  };
  if (description) {
    createPayload.description = description.trim();
  }

  const doc = (await SCIMTokenModel.create(createPayload)) as ISCIMToken & { _id: Types.ObjectId };

  await createAuditLog({
    action: 'SCIM_TOKEN_CREATED',
    userId,
    workspaceId,
    resource: 'scim_token',
    resourceId: doc._id.toString(),
    metadata: { prefix, description },
  });

  return {
    token,
    scimToken: toSCIMTokenView(doc),
  };
}

/**
 * List SCIM tokens for a workspace
 */
export async function listSCIMTokens(workspaceId: string): Promise<SCIMTokenView[]> {
  if (!Types.ObjectId.isValid(workspaceId)) {
    throw new Error('INVALID_WORKSPACE_ID');
  }
  const tokens = await SCIMTokenModel.find({
    workspaceId: new Types.ObjectId(workspaceId),
  }).sort({ createdAt: -1 });

  return tokens.map(toSCIMTokenView);
}

/**
 * Revoke a SCIM token
 */
export async function revokeSCIMToken(tokenId: string, workspaceId: string, userId: string): Promise<void> {
  if (!Types.ObjectId.isValid(workspaceId)) {
    throw new Error('INVALID_WORKSPACE_ID');
  }
  if (!Types.ObjectId.isValid(tokenId)) {
    throw new Error('SCIM_TOKEN_NOT_FOUND');
  }

  const token = await SCIMTokenModel.findOneAndUpdate(
    { _id: new Types.ObjectId(tokenId), workspaceId: new Types.ObjectId(workspaceId) },
    { $set: { status: 'REVOKED' } },
    { returnDocument: 'after' },
  );

  if (!token) {
    throw new Error('SCIM_TOKEN_NOT_FOUND');
  }

  await createAuditLog({
    action: 'SCIM_TOKEN_REVOKED',
    userId,
    workspaceId,
    resource: 'scim_token',
    resourceId: token._id.toString(),
    metadata: { prefix: token.prefix },
  });
}

/**
 * Authenticates a SCIM request and returns the associated workspaceId
 */
export async function authenticateSCIMToken(rawToken: string): Promise<string> {
  if (!rawToken) {
    throw new Error('SCIM_UNAUTHORIZED');
  }

  const secret = rawToken.startsWith('scim_') ? rawToken.slice(5) : rawToken;
  const tokenHash = createHash('sha256').update(secret).digest('hex');

  const tokenDoc = await SCIMTokenModel.findOne({
    tokenHash,
    status: 'ACTIVE',
    expiresAt: { $gt: new Date() },
  });

  if (!tokenDoc) {
    throw new Error('SCIM_UNAUTHORIZED');
  }

  tokenDoc.lastUsedAt = new Date();
  await tokenDoc.save();

  return tokenDoc.workspaceId.toString();
}

/**
 * Standard SCIM 2.0 ServiceProviderConfig JSON
 */
export function getServiceProviderConfig(): Record<string, unknown> {
  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
    documentationUri: 'https://docs.workflowengine.io/scim',
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 100 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        name: 'OAuth Bearer Token',
        description: 'Authentication Scheme using the OAuth Bearer Standard',
        specUri: 'http://www.rfc-editor.org/info/rfc6750',
        type: 'oauthbearertoken',
        primary: true,
      },
    ],
  };
}

/**
 * List SCIM Users for a workspace with pagination and filtering
 */
export async function listSCIMUsers(
  workspaceId: string,
  options: {
    startIndex?: number | undefined;
    count?: number | undefined;
    filter?: string | undefined;
    baseUrl?: string | undefined;
  } = {},
): Promise<SCIMListResponse<SCIMUserResource>> {
  if (!Types.ObjectId.isValid(workspaceId)) {
    throw new Error('INVALID_WORKSPACE_ID');
  }

  const wsObjectId = new Types.ObjectId(workspaceId);
  const startIndex = Math.max(1, options.startIndex ?? 1);
  const count = Math.min(100, Math.max(1, options.count ?? 100));

  let filterEmail: string | undefined;
  if (options.filter) {
    const match = options.filter.match(/(?:userName|emails\.value|email)\s+eq\s+["']?([^"']+)["']?/i);
    if (match && match[1]) {
      filterEmail = match[1].toLowerCase().trim();
    }
  }

  let userIds: Types.ObjectId[] | undefined;
  if (filterEmail) {
    const matchedUsers = await UserModel.find({ email: filterEmail }).select('_id');
    userIds = matchedUsers.map((u) => u._id);
  }

  const query: Record<string, unknown> = {
    workspaceId: wsObjectId,
  };
  if (userIds !== undefined) {
    query.userId = { $in: userIds };
  }

  const totalResults = await WorkspaceMemberModel.countDocuments(query);
  const members = await WorkspaceMemberModel.find(query)
    .sort({ createdAt: 1 })
    .skip(startIndex - 1)
    .limit(count);

  const memberUserIds = members.map((m) => m.userId);
  const users = await UserModel.find({ _id: { $in: memberUserIds } });
  const userMap = new Map(users.map((u) => [u._id.toString(), u]));

  const resources: SCIMUserResource[] = [];
  for (const member of members) {
    const user = userMap.get(member.userId.toString());
    if (user) {
      resources.push(toSCIMUserResource(user, member, options.baseUrl));
    }
  }

  return {
    schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
    totalResults,
    startIndex,
    itemsPerPage: resources.length,
    Resources: resources,
  };
}

/**
 * Get SCIM User by ID
 */
export async function getSCIMUser(
  workspaceId: string,
  userId: string,
  baseUrl = '',
): Promise<SCIMUserResource> {
  if (!Types.ObjectId.isValid(workspaceId)) {
    throw new Error('INVALID_WORKSPACE_ID');
  }
  if (!Types.ObjectId.isValid(userId)) {
    throw new Error('SCIM_USER_NOT_FOUND');
  }

  const user = await UserModel.findById(userId);
  if (!user) {
    throw new Error('SCIM_USER_NOT_FOUND');
  }

  const member = await WorkspaceMemberModel.findOne({
    workspaceId: new Types.ObjectId(workspaceId),
    userId: user._id,
  });

  if (!member) {
    throw new Error('SCIM_USER_NOT_FOUND');
  }

  return toSCIMUserResource(user, member, baseUrl);
}

/**
 * Provision new SCIM User in workspace
 */
export async function createSCIMUser(
  workspaceId: string,
  payload: {
    userName?: string | undefined;
    emails?: Array<{ value: string; primary?: boolean | undefined }> | undefined;
    active?: boolean | undefined;
    roles?: Array<{ value: string; primary?: boolean | undefined }> | undefined;
    name?: { givenName?: string | undefined; familyName?: string | undefined } | undefined;
  },
  baseUrl = '',
): Promise<SCIMUserResource> {
  if (!Types.ObjectId.isValid(workspaceId)) {
    throw new Error('INVALID_WORKSPACE_ID');
  }

  const emailRaw = payload.userName || payload.emails?.find((e) => e.primary)?.value || payload.emails?.[0]?.value;
  if (!emailRaw || typeof emailRaw !== 'string') {
    throw new Error('INVALID_REQUEST');
  }

  const email = emailRaw.toLowerCase().trim();
  const wsObjectId = new Types.ObjectId(workspaceId);

  let user = await UserModel.findOne({ email });
  if (!user) {
    const dummyPassword = randomBytes(32).toString('hex');
    const passwordHash = await hashPassword(dummyPassword);
    user = await UserModel.create({
      email,
      passwordHash,
      defaultWorkspaceId: wsObjectId,
    });
  }

  // Check if member already exists
  const existingMember = await WorkspaceMemberModel.findOne({
    workspaceId: wsObjectId,
    userId: user._id,
  });

  if (existingMember && existingMember.status === 'ACTIVE') {
    throw new Error('SCIM_CONFLICT');
  }

  // Determine role
  let role: WorkspaceRole = 'VIEWER';
  if (payload.roles && payload.roles.length > 0) {
    const requested = payload.roles[0]?.value?.toUpperCase();
    if (requested === 'ADMIN') role = 'ADMIN';
    else if (requested === 'EDITOR') role = 'EDITOR';
    else if (requested === 'VIEWER') role = 'VIEWER';
    // Clamped: never allow OWNER via SCIM
    else if (requested === 'OWNER') role = 'ADMIN';
  }

  const isActive = payload.active !== false;

  let member: IWorkspaceMember;
  if (existingMember) {
    if (isActive) {
      await validateWorkspaceQuota(workspaceId, 'members');
    }
    existingMember.status = isActive ? 'ACTIVE' : 'REMOVED';
    existingMember.role = role;
    existingMember.permissions = isActive ? permissionsForRole(role) : [];
    member = await existingMember.save();
  } else {
    if (isActive) {
      await validateWorkspaceQuota(workspaceId, 'members');
    }
    member = await WorkspaceMemberModel.create({
      workspaceId: wsObjectId,
      userId: user._id,
      role,
      status: isActive ? 'ACTIVE' : 'REMOVED',
      permissions: isActive ? permissionsForRole(role) : [],
    });
  }

  await createAuditLog({
    action: 'SCIM_USER_PROVISIONED',
    workspaceId,
    userId: user._id.toString(),
    resource: 'scim_user',
    resourceId: user._id.toString(),
    metadata: { email, role, active: isActive },
  });

  return toSCIMUserResource(user, member, baseUrl);
}

/**
 * Update SCIM User (supports PATCH Operations and direct attributes)
 */
export async function updateSCIMUser(
  workspaceId: string,
  userId: string,
  payload: {
    Operations?: Array<{ op: string; path?: string | undefined; value?: unknown }> | undefined;
    active?: boolean | undefined;
    roles?: Array<{ value: string; primary?: boolean | undefined }> | undefined;
    name?: { givenName?: string | undefined; familyName?: string | undefined } | undefined;
  },
  baseUrl = '',
): Promise<SCIMUserResource> {
  if (!Types.ObjectId.isValid(workspaceId)) {
    throw new Error('INVALID_WORKSPACE_ID');
  }
  if (!Types.ObjectId.isValid(userId)) {
    throw new Error('SCIM_USER_NOT_FOUND');
  }

  const user = await UserModel.findById(userId);
  if (!user) {
    throw new Error('SCIM_USER_NOT_FOUND');
  }

  const member = await WorkspaceMemberModel.findOne({
    workspaceId: new Types.ObjectId(workspaceId),
    userId: user._id,
  });

  if (!member) {
    throw new Error('SCIM_USER_NOT_FOUND');
  }

  let nextActive: boolean | undefined;
  let nextRole: WorkspaceRole | undefined;

  if (payload.active !== undefined) {
    nextActive = payload.active;
  }
  if (payload.roles && payload.roles.length > 0) {
    const requested = payload.roles[0]?.value?.toUpperCase();
    if (requested === 'ADMIN') nextRole = 'ADMIN';
    else if (requested === 'EDITOR') nextRole = 'EDITOR';
    else if (requested === 'VIEWER') nextRole = 'VIEWER';
    else if (requested === 'OWNER') nextRole = 'ADMIN'; // clamped
  }

  // Handle SCIM PATCH Operations array
  if (Array.isArray(payload.Operations)) {
    for (const op of payload.Operations) {
      const opType = op.op?.toLowerCase();
      if (opType === 'replace' || opType === 'add') {
        const path = op.path?.toLowerCase();
        if (path === 'active') {
          nextActive = Boolean(op.value);
        } else if (path === 'roles' && Array.isArray(op.value)) {
          const firstVal = (op.value as Array<{ value?: string }>)[0]?.value?.toUpperCase();
          if (firstVal === 'ADMIN') nextRole = 'ADMIN';
          else if (firstVal === 'EDITOR') nextRole = 'EDITOR';
          else if (firstVal === 'VIEWER') nextRole = 'VIEWER';
        } else if (typeof op.value === 'object' && op.value !== null) {
          const valObj = op.value as Record<string, unknown>;
          if (valObj.active !== undefined) {
            nextActive = Boolean(valObj.active);
          }
        }
      }
    }
  }

  // Prevent changing OWNER status or removing OWNER
  if (member.role === 'OWNER' && nextActive === false) {
    throw new Error('OWNER_ROLE_IMMUTABLE');
  }

  if (nextActive !== undefined) {
    member.status = nextActive ? 'ACTIVE' : 'REMOVED';
    member.permissions = nextActive ? permissionsForRole(member.role) : [];
  }

  if (nextRole !== undefined && member.role !== 'OWNER') {
    member.role = nextRole;
    if (member.status === 'ACTIVE') {
      member.permissions = permissionsForRole(nextRole);
    }
  }

  await member.save();

  await createAuditLog({
    action: 'SCIM_USER_UPDATED',
    workspaceId,
    userId: user._id.toString(),
    resource: 'scim_user',
    resourceId: user._id.toString(),
    metadata: { active: member.status === 'ACTIVE', role: member.role },
  });

  return toSCIMUserResource(user, member, baseUrl);
}

/**
 * Deprovision (remove) SCIM User from workspace
 */
export async function deleteSCIMUser(workspaceId: string, userId: string): Promise<void> {
  if (!Types.ObjectId.isValid(workspaceId)) {
    throw new Error('INVALID_WORKSPACE_ID');
  }
  if (!Types.ObjectId.isValid(userId)) {
    throw new Error('SCIM_USER_NOT_FOUND');
  }

  const member = await WorkspaceMemberModel.findOne({
    workspaceId: new Types.ObjectId(workspaceId),
    userId: new Types.ObjectId(userId),
  });

  if (!member) {
    throw new Error('SCIM_USER_NOT_FOUND');
  }

  if (member.role === 'OWNER') {
    throw new Error('OWNER_ROLE_IMMUTABLE');
  }

  member.status = 'REMOVED';
  member.permissions = [];
  await member.save();

  await createAuditLog({
    action: 'SCIM_USER_DEPROVISIONED',
    workspaceId,
    userId,
    resource: 'scim_user',
    resourceId: userId,
  });
}