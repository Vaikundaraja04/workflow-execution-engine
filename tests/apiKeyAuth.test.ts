import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { APIKeyModel } from '../src/models/APIKeyModel.js';
import { createAPIKey, validateAPIKey } from '../src/services/apiKeyService.js';
import { createRequireAPIKey, getAPIKeyContext } from '../src/auth/apiKeyAuth.middleware.js';
import type { Request } from 'express';

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

describe('API Key Auth Middleware', () => {
  const workspaceId = new mongoose.Types.ObjectId().toString();
  const userId = new mongoose.Types.ObjectId().toString();

  function makeRequest(authHeader?: string, xApiKey?: string): Request {
    const headers: Record<string, string | undefined> = {};
    if (authHeader !== undefined) headers.authorization = authHeader;
    if (xApiKey !== undefined) headers['x-api-key'] = xApiKey;
    return {
      headers,
    } as unknown as Request;
  }

  it('authenticates a valid API key', async () => {
    const { rawKey } = await createAPIKey(workspaceId, userId, 'Test', ['WORKFLOW_READ']);
    const req = makeRequest(`Bearer ${rawKey}`);
    const middleware = createRequireAPIKey();
    let nextCalled = false;
    let nextError: string | Error | undefined;
    await new Promise<void>((resolve) => {
      middleware(req, {} as never, (err?: Error | string | undefined) => {
        nextCalled = true;
        nextError = err;
        resolve();
      });
    });
    expect(nextCalled).toBe(true);
    expect(nextError).toBeUndefined();
    const ctx = getAPIKeyContext(req);
    expect(ctx.workspaceId).toBe(workspaceId);
    expect(ctx.permissions).toEqual(['WORKFLOW_READ']);
  });

  it('authenticates a valid API key via X-API-Key header', async () => {
    const { rawKey } = await createAPIKey(workspaceId, userId, 'Test', ['WORKFLOW_READ']);
    const req = makeRequest(undefined, rawKey);
    const middleware = createRequireAPIKey();
    let nextCalled = false;
    let nextError: string | Error | undefined;
    await new Promise<void>((resolve) => {
      middleware(req, {} as never, (err?: Error | string | undefined) => {
        nextCalled = true;
        nextError = err;
        resolve();
      });
    });
    expect(nextCalled).toBe(true);
    expect(nextError).toBeUndefined();
    const ctx = getAPIKeyContext(req);
    expect(ctx.workspaceId).toBe(workspaceId);
    expect(ctx.permissions).toEqual(['WORKFLOW_READ']);
  });

  it('rejects missing authorization header', async () => {
    const req = makeRequest();
    const middleware = createRequireAPIKey();
    let nextError: string | Error | undefined;
    await new Promise<void>((resolve) => {
      middleware(req, {} as never, (err?: Error | string | undefined) => {
        nextError = err;
        resolve();
      });
    });
    expect((nextError as Error)?.message).toBe('UNAUTHENTICATED');
  });

  it('rejects invalid API key format', async () => {
    const req = makeRequest('Bearer invalid_key');
    const middleware = createRequireAPIKey();
    let nextError: string | Error | undefined;
    await new Promise<void>((resolve) => {
      middleware(req, {} as never, (err?: Error | string | undefined) => {
        nextError = err;
        resolve();
      });
    });
    expect((nextError as Error)?.message).toBe('INVALID_API_KEY');
  });

  it('rejects revoked API key', async () => {
    const { key, rawKey } = await createAPIKey(workspaceId, userId, 'Revoked', []);
    await APIKeyModel.findByIdAndUpdate(key.id, { status: 'REVOKED' });
    const req = makeRequest(`Bearer ${rawKey}`);
    const middleware = createRequireAPIKey();
    let nextError: string | Error | undefined;
    await new Promise<void>((resolve) => {
      middleware(req, {} as never, (err?: Error | string | undefined) => {
        nextError = err;
        resolve();
      });
    });
    expect((nextError as Error)?.message).toBe('INVALID_API_KEY');
  });

  it('rejects expired API key', async () => {
    const past = new Date(Date.now() - 1000);
    const { rawKey } = await createAPIKey(workspaceId, userId, 'Expired', [], past);
    const req = makeRequest(`Bearer ${rawKey}`);
    const middleware = createRequireAPIKey();
    let nextError: string | Error | undefined;
    await new Promise<void>((resolve) => {
      middleware(req, {} as never, (err?: Error | string | undefined) => {
        nextError = err;
        resolve();
      });
    });
    expect((nextError as Error)?.message).toBe('API_KEY_EXPIRED');
  });

  it('updates lastUsedAt on successful auth', async () => {
    const { rawKey } = await createAPIKey(workspaceId, userId, 'Usage', []);
    const req = makeRequest(`Bearer ${rawKey}`);
    const middleware = createRequireAPIKey();
    await new Promise<void>((resolve) => {
      middleware(req, {} as never, (err?: Error | string | undefined) => resolve());
    });
    await new Promise(resolve => setTimeout(resolve, 100));
    const key = await APIKeyModel.findOne({ keyPrefix: rawKey.slice(0, 8) });
    expect(key!.lastUsedAt).toBeTruthy();
  });
});
