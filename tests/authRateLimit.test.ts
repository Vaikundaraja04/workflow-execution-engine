import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createApp } from '../src/api/app.js';
import type { AuthRateLimitOptions } from '../src/api/middleware/rateLimiter.js';

const authConfig = {
  jwtSecret: 'test-jwt-secret-0123456789abcdef',
  accessTtl: '15m',
  refreshTtl: '30d',
};

function createRequest(rateLimit: Partial<AuthRateLimitOptions>) {
  return supertest(createApp({ auth: authConfig, authRateLimit: rateLimit }));
}
let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
}, 30000);

describe('Phase 2E authentication rate limiting', () => {
  it('limits repeated login attempts per IP', async () => {
    const request = createRequest({ windowMs: 60_000, loginLimit: 3, refreshLimit: 100 });

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const res = await request
        .post('/api/auth/login')
        .send({ email: 'nobody@example.com', password: 'correct-horse-1' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    }

    const limited = await request
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'correct-horse-1' });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
  });

  it('limits repeated refresh attempts per IP', async () => {
    const request = createRequest({ windowMs: 60_000, loginLimit: 100, refreshLimit: 4 });

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const res = await request.post('/api/auth/refresh').send({ refreshToken: 'unknown-token' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_REFRESH_TOKEN');
    }

    const limited = await request.post('/api/auth/refresh').send({ refreshToken: 'unknown-token' });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
  });

  it('does not affect other api traffic', async () => {
    const request = createRequest({ windowMs: 60_000, loginLimit: 2, refreshLimit: 2 });

    await request.post('/api/auth/login').send({ email: 'nobody@example.com', password: 'correct-horse-1' });
    await request.post('/api/auth/login').send({ email: 'nobody@example.com', password: 'correct-horse-1' });
    const limited = await request.post('/api/auth/login').send({ email: 'nobody@example.com', password: 'correct-horse-1' });
    expect(limited.status).toBe(429);

    const health = await request.get('/health');
    expect(health.status).toBe(200);

    const workflows = await request.get('/api/workflows/507f1f77bcf86cd799439011');
    expect(workflows.status).toBe(401);
    expect(workflows.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('keeps login and refresh limits independent', async () => {
    const request = createRequest({ windowMs: 60_000, loginLimit: 1, refreshLimit: 1 });

    await request.post('/api/auth/refresh').send({ refreshToken: 'unknown-token' });
    const refreshLimited = await request.post('/api/auth/refresh').send({ refreshToken: 'unknown-token' });
    expect(refreshLimited.status).toBe(429);

    const login = await request.post('/api/auth/login').send({ email: 'nobody@example.com', password: 'correct-horse-1' });
    expect(login.status).toBe(401);
  });
});