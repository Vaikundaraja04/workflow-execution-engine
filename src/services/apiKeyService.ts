import { createHash, randomBytes } from 'node:crypto';
import { Types } from 'mongoose';
import { APIKeyModel } from '../models/APIKeyModel.js';
import type { IAPIKey, APIKeyStatus } from '../models/APIKeyModel.js';
import type { Permission } from '../auth/permissions.js';
import { permissionsForRole } from '../auth/permissions.js';
import type { WorkspaceRole } from '../models/WorkspaceMemberModel.js';

const API_KEY_PREFIX = 'wke_';
const API_KEY_BYTES = 32;

export interface APIKeyView {
  id: string;
  name: string;
  keyPrefix: string;
  status: APIKeyStatus;
  permissions: Permission[];
  lastUsedAt?: string | undefined;
  expiresAt?: string | undefined;
  createdBy: string;
  revokedAt?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface CreatedAPIKey {
  key: APIKeyView;
  rawKey: string;
}

function generateRawKey(): string {
  return API_KEY_PREFIX + randomBytes(API_KEY_BYTES).toString('hex');
}

function hashKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

function getKeyPrefix(rawKey: string): string {
  return rawKey.slice(0, 8);
}

function toAPIKeyView(doc: IAPIKey): APIKeyView {
  return {
    id: doc._id.toString(),
    name: doc.name,
    keyPrefix: doc.keyPrefix,
    status: doc.status,
    permissions: doc.permissions,
    lastUsedAt: doc.lastUsedAt?.toISOString(),
    expiresAt: doc.expiresAt?.toISOString(),
    createdBy: doc.createdBy.toString(),
    revokedAt: doc.revokedAt?.toISOString(),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export async function createAPIKey(
  workspaceId: string,
  userId: string,
  name: string,
  permissions: Permission[],
  expiresAt?: Date,
): Promise<CreatedAPIKey> {
  const rawKey = generateRawKey();
  const keyHash = hashKey(rawKey);
  const keyPrefix = getKeyPrefix(rawKey);

  const doc = await APIKeyModel.create({
    workspaceId: new Types.ObjectId(workspaceId),
    name,
    keyHash,
    keyPrefix,
    status: 'ACTIVE',
    permissions,
    ...(expiresAt ? { expiresAt } : {}),
    createdBy: new Types.ObjectId(userId),
  });

  return { key: toAPIKeyView(doc), rawKey };
}

export async function listAPIKeys(workspaceId: string): Promise<APIKeyView[]> {
  const keys = await APIKeyModel.find({ workspaceId: new Types.ObjectId(workspaceId) })
    .sort({ createdAt: -1 });
  return keys.map(toAPIKeyView);
}

export async function getAPIKey(id: string, workspaceId: string): Promise<APIKeyView> {
  if (!Types.ObjectId.isValid(id)) throw new Error('INVALID_API_KEY_ID');
  const key = await APIKeyModel.findOne({
    _id: new Types.ObjectId(id),
    workspaceId: new Types.ObjectId(workspaceId),
  });
  if (!key) throw new Error('API_KEY_NOT_FOUND');
  return toAPIKeyView(key);
}

export async function updateAPIKey(
  id: string,
  workspaceId: string,
  updates: { name?: string; permissions?: Permission[]; expiresAt?: Date | null },
): Promise<APIKeyView> {
  if (!Types.ObjectId.isValid(id)) throw new Error('INVALID_API_KEY_ID');
  const key = await APIKeyModel.findOneAndUpdate(
    { _id: new Types.ObjectId(id), workspaceId: new Types.ObjectId(workspaceId) },
    { $set: { ...updates } },
    { returnDocument: 'after' },
  );
  if (!key) throw new Error('API_KEY_NOT_FOUND');
  return toAPIKeyView(key);
}

export async function revokeAPIKey(
  id: string,
  workspaceId: string,
  revokedBy: string,
): Promise<void> {
  if (!Types.ObjectId.isValid(id)) throw new Error('INVALID_API_KEY_ID');
  const key = await APIKeyModel.findOneAndUpdate(
    { _id: new Types.ObjectId(id), workspaceId: new Types.ObjectId(workspaceId) },
    {
      $set: {
        status: 'REVOKED',
        revokedAt: new Date(),
        revokedBy: new Types.ObjectId(revokedBy),
      },
    },
    { returnDocument: 'after' },
  );
  if (!key) throw new Error('API_KEY_NOT_FOUND');
}

export async function rotateAPIKey(
  id: string,
  workspaceId: string,
  userId: string,
): Promise<CreatedAPIKey> {
  if (!Types.ObjectId.isValid(id)) throw new Error('INVALID_API_KEY_ID');
  const existing = await APIKeyModel.findOne({
    _id: new Types.ObjectId(id),
    workspaceId: new Types.ObjectId(workspaceId),
  });
  if (!existing) throw new Error('API_KEY_NOT_FOUND');

  const rawKey = generateRawKey();
  const keyHash = hashKey(rawKey);
  const keyPrefix = getKeyPrefix(rawKey);

  const doc = await APIKeyModel.findOneAndUpdate(
    { _id: existing._id },
    {
      $set: {
        keyHash,
        keyPrefix,
        status: 'ACTIVE',
        expiresAt: existing.expiresAt,
        revokedAt: undefined,
        revokedBy: undefined,
      },
    },
    { returnDocument: 'after' },
  );

  if (!doc) throw new Error('API_KEY_NOT_FOUND');
  return { key: toAPIKeyView(doc), rawKey };
}

export type ValidateAPIKeyResult = {
  key: IAPIKey | null;
  reason?: 'EXPIRED' | 'INVALID';
};

export async function validateAPIKey(rawKey: string): Promise<ValidateAPIKeyResult> {
  if (!rawKey.startsWith(API_KEY_PREFIX)) return { key: null, reason: 'INVALID' };
  const keyHash = hashKey(rawKey);
  const key = await APIKeyModel.findOne({ keyHash });
  if (!key) return { key: null, reason: 'INVALID' };
  if (key.status === 'REVOKED') return { key: null, reason: 'INVALID' };
  if (key.status === 'EXPIRED') return { key: null, reason: 'EXPIRED' };
  if (key.expiresAt && key.expiresAt < new Date()) {
    key.status = 'EXPIRED';
    await key.save();
    return { key: null, reason: 'EXPIRED' };
  }
  return { key };
}

export async function recordAPIKeyUsage(id: string): Promise<void> {
  await APIKeyModel.updateOne(
    { _id: new Types.ObjectId(id) },
    { $set: { lastUsedAt: new Date() } },
  );
}

export function filterPermissionsForRole(
  permissions: Permission[],
  role: WorkspaceRole,
): Permission[] {
  const rolePermissions = permissionsForRole(role);
  return permissions.filter(p => rolePermissions.includes(p));
}
