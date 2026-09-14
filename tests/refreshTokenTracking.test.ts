import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createApp } from '../src/api/app.js';
import { RefreshTokenModel } from '../src/models/RefreshTokenModel.js';
import { UserModel } from '../src/models/UserModel.js';
import { hashRefreshToken } from '../src/auth/jwt.service.js';

const authConfig = {
  jwtSecret: 'test-jwt-secret-0123456789abcdef',
  accessTtl: '15m',
  refreshTtl: '30d',
};

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  request = supertest(createApp({
    auth: authConfig,
    authRateLimit: { loginLimit: 1000, refreshLimit: 1000 },
  }));
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
}, 30000);

beforeEach(async () => {
  await UserModel.deleteMany({});
  await RefreshTokenModel.deleteMany({});
});

describe('Phase 2E refresh token tracking', () => {
  it('tracks user agent, ip and last use per token', async () => {
    await request
      .post('/api/auth/register')
      .send({ email: 'tracked@example.com', password: 'correct-horse-1' });
    const login = await request
      .post('/api/auth/login')
      .send({ email: 'tracked@example.com', password: 'correct-horse-1' })
      .set('User-Agent', 'tracking-agent');
    expect(login.status).toBe(200);

    const stored = await RefreshTokenModel.findOne({
      tokenHash: hashRefreshToken(login.body.refreshToken),
    });
    expect(stored?.userAgent).toBe('tracking-agent');
    expect(stored?.ipAddress).toBeTruthy();
    expect(stored?.lastUsedAt).toBeInstanceOf(Date);
    const familyId = stored?.familyId as string;

    const rotated = await request
      .post('/api/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .set('User-Agent', 'tracking-agent-2');
    expect(rotated.status).toBe(200);

    const rotatedStored = await RefreshTokenModel.findOne({
      tokenHash: hashRefreshToken(rotated.body.refreshToken),
    });
    expect(rotatedStored?.familyId).toBe(familyId);
    expect(rotatedStored?.userAgent).toBe('tracking-agent-2');
    expect(rotatedStored?.lastUsedAt).toBeInstanceOf(Date);

    const oldStored = await RefreshTokenModel.findOne({
      tokenHash: hashRefreshToken(login.body.refreshToken),
    });
    expect(oldStored?.revoked).toBe(true);
    expect(oldStored?.lastUsedAt).toBeInstanceOf(Date);
  });
});