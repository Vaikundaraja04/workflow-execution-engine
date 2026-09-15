import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { APIKeyModel } from '../src/models/APIKeyModel.js';
import {
  createAPIKey,
  listAPIKeys,
  getAPIKey,
  updateAPIKey,
  revokeAPIKey,
  rotateAPIKey,
  validateAPIKey,
  filterPermissionsForRole,
} from '../src/services/apiKeyService.js';
import { permissionsForRole } from '../src/auth/permissions.js';
import type { WorkspaceRole } from '../src/models/WorkspaceMemberModel.js';

let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

beforeEach(async () => {
  await APIKeyModel.deleteMany({});
});

describe('API Key Service', () => {
  const workspaceId = new mongoose.Types.ObjectId().toString();
  const userId = new mongoose.Types.ObjectId().toString();

  it('creates an API key with hashed storage', async () => {
    const { key, rawKey } = await createAPIKey(workspaceId, userId, 'Test Key', ['WORKFLOW_READ']);
    expect(rawKey).toMatch(/^wke_/);
    expect(key.keyPrefix).toBe(rawKey.slice(0, 8));
    expect(key.status).toBe('ACTIVE');
    expect(key.permissions).toEqual(['WORKFLOW_READ']);

    const stored = await APIKeyModel.findById(key.id);
    expect(stored).toBeTruthy();
    expect(stored?.keyHash).not.toBe(rawKey);
    expect(stored?.keyHash).toHaveLength(64);
  });

  it('lists API keys for a workspace', async () => {
    await createAPIKey(workspaceId, userId, 'Key 1', []);
    await createAPIKey(workspaceId, userId, 'Key 2', []);
    const keys = await listAPIKeys(workspaceId);
    expect(keys).toHaveLength(2);
    expect(keys[0]?.name).toBe('Key 2');
    expect(keys[1]?.name).toBe('Key 1');
  });

  it('gets a single API key', async () => {
    const { key } = await createAPIKey(workspaceId, userId, 'Test', []);
    const fetched = await getAPIKey(key.id, workspaceId);
    expect(fetched.id).toBe(key.id);
    expect(fetched.name).toBe('Test');
  });

  it('throws on invalid key id', async () => {
    await expect(getAPIKey('invalid', workspaceId)).rejects.toThrow('INVALID_API_KEY_ID');
  });

  it('throws on key not found', async () => {
    const id = new mongoose.Types.ObjectId().toString();
    await expect(getAPIKey(id, workspaceId)).rejects.toThrow('API_KEY_NOT_FOUND');
  });

  it('updates an API key', async () => {
    const { key } = await createAPIKey(workspaceId, userId, 'Original', []);
    const updated = await updateAPIKey(key.id, workspaceId, { name: 'Updated' });
    expect(updated.name).toBe('Updated');
  });

  it('revokes an API key immediately', async () => {
    const { key } = await createAPIKey(workspaceId, userId, 'To Revoke', []);
    await revokeAPIKey(key.id, workspaceId, userId);
    const stored = await APIKeyModel.findById(key.id);
    expect(stored!.status).toBe('REVOKED');
    expect(stored!.revokedAt).toBeTruthy();
    expect(stored!.revokedBy!.toString()).toBe(userId);
  });

  it('rotates an API key', async () => {
    const { key } = await createAPIKey(workspaceId, userId, 'To Rotate', ['WORKFLOW_READ']);
    const { key: rotated, rawKey } = await rotateAPIKey(key.id, workspaceId, userId);
    expect(rotated.id).toBe(key.id);
    expect(rotated.status).toBe('ACTIVE');
    expect(rawKey).toMatch(/^wke_/);
    expect(rotated.keyPrefix).toBe(rawKey.slice(0, 8));
  });

  it('validates a correct API key', async () => {
    const { rawKey } = await createAPIKey(workspaceId, userId, 'Valid', []);
    const validated = await validateAPIKey(rawKey);
    expect(validated).toBeTruthy();
    expect(validated!.status).toBe('ACTIVE');
  });

  it('rejects an invalid API key', async () => {
    const validated = await validateAPIKey('wke_invalidkey123');
    expect(validated).toBeNull();
  });

  it('rejects a revoked API key', async () => {
    const { key, rawKey } = await createAPIKey(workspaceId, userId, 'Revoked', []);
    await revokeAPIKey(key.id, workspaceId, userId);
    const validated = await validateAPIKey(rawKey);
    expect(validated).toBeNull();
  });

  it('rejects an expired API key', async () => {
    const past = new Date(Date.now() - 1000);
    const { rawKey } = await createAPIKey(workspaceId, userId, 'Expired', [], past);
    const validated = await validateAPIKey(rawKey);
    expect(validated).toBeNull();
  });

  it('marks key as expired when past expiration', async () => {
    const past = new Date(Date.now() - 1000);
    const { key, rawKey } = await createAPIKey(workspaceId, userId, 'Expiring', [], past);
    await validateAPIKey(rawKey);
    const stored = await APIKeyModel.findById(key.id);
    expect(stored!.status).toBe('EXPIRED');
  });

  it('filters permissions for role correctly', () => {
    const allPerms = permissionsForRole('OWNER');
    const filtered = filterPermissionsForRole(allPerms, 'VIEWER');
    expect(filtered).toEqual(['WORKFLOW_READ']);
  });

  it('returns empty array for no matching permissions', () => {
    const filtered = filterPermissionsForRole(['WORKFLOW_CREATE'], 'VIEWER');
    expect(filtered).toEqual([]);
  });

  it('enforces workspace isolation', async () => {
    const otherWorkspace = new mongoose.Types.ObjectId().toString();
    const { key } = await createAPIKey(workspaceId, userId, 'Isolated', []);
    await expect(getAPIKey(key.id, otherWorkspace)).rejects.toThrow('API_KEY_NOT_FOUND');
  });
});
