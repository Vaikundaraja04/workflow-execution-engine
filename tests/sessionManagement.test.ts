import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createApp } from '../src/api/app.js';
import { RefreshTokenModel } from '../src/models/RefreshTokenModel.js';
import { UserModel } from '../src/models/UserModel.js';

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

async function createSession(email: string) {
  await request.post('/api/auth/register').send({ email, password: 'correct-horse-1' });
  const login = await request.post('/api/auth/login').send({ email, password: 'correct-horse-1' });
  expect(login.status).toBe(200);
  return {
    accessToken: login.body.accessToken as string,
    refreshToken: login.body.refreshToken as string,
  };
}

function sessionIdOf(accessToken: string): string {
  const decoded = jwt.decode(accessToken) as { sessionId?: string } | null;
  return decoded?.sessionId ?? '';
}

describe('Phase 2E session management', () => {
  it('lists current user sessions with the current one marked', async () => {
    const first = await createSession('sessions@example.com');
    const second = await createSession('sessions@example.com');

    const res = await request
      .get('/api/auth/sessions')
      .set('Authorization', `Bearer ${first.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.filter((session: { current: boolean }) => session.current)).toHaveLength(1);

    const currentId = sessionIdOf(first.accessToken);
    const currentEntry = res.body.find((session: { id: string }) => session.id === currentId);
    expect(currentEntry?.current).toBe(true);
    expect(typeof currentEntry?.createdAt).toBe('string');
    expect(typeof currentEntry?.lastUsedAt).toBe('string');
    expect(typeof currentEntry?.expiresAt).toBe('string');
    expect(sessionIdOf(second.accessToken)).not.toBe(currentId);
  });

  it('revokes a selected session family', async () => {
    const first = await createSession('sessions@example.com');
    const second = await createSession('sessions@example.com');

    const revoke = await request
      .delete(`/api/auth/sessions/${sessionIdOf(second.accessToken)}`)
      .set('Authorization', `Bearer ${first.accessToken}`);
    expect(revoke.status).toBe(204);

    const secondRefresh = await request
      .post('/api/auth/refresh')
      .send({ refreshToken: second.refreshToken });
    expect(secondRefresh.status).toBe(401);

    const firstRefresh = await request
      .post('/api/auth/refresh')
      .send({ refreshToken: first.refreshToken });
    expect(firstRefresh.status).toBe(200);
  });

  it('revokes every session family on logout all', async () => {
    const first = await createSession('sessions@example.com');
    const second = await createSession('sessions@example.com');
    expect(sessionIdOf(first.accessToken)).not.toBe(sessionIdOf(second.accessToken));

    const rotated = await request
      .post('/api/auth/refresh')
      .send({ refreshToken: second.refreshToken });
    expect(rotated.status).toBe(200);

    const logoutAll = await request
      .delete('/api/auth/sessions')
      .set('Authorization', `Bearer ${first.accessToken}`);
    expect(logoutAll.status).toBe(204);

    const activeTokens = await RefreshTokenModel.find({ revoked: false });
    expect(activeTokens).toHaveLength(0);

    const firstRefresh = await request
      .post('/api/auth/refresh')
      .send({ refreshToken: first.refreshToken });
    expect(firstRefresh.status).toBe(401);

    const secondRefresh = await request
      .post('/api/auth/refresh')
      .send({ refreshToken: rotated.body.refreshToken });
    expect(secondRefresh.status).toBe(401);
  });
});
