import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
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

const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

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

interface SessionRow {
  _id: string;
  userId: string;
  ipAddress?: string;
  userAgent?: string;
  browser: string;
  os: string;
  deviceType: string;
  isActive: boolean;
  isCurrent: boolean;
  lastActiveAt: string;
  expiresAt: string;
  createdAt: string;
}

async function registerAndLogin(userAgent: string) {
  const email = `sessions-${new mongoose.Types.ObjectId().toHexString()}@test.dev`;
  const password = 'correct-horse-1';
  const registered = await request.post('/api/auth/register').send({ email, password });
  const defaultWorkspaceId = registered.body.defaultWorkspaceId as string;
  const login = await request.post('/api/auth/login').send({ email, password }).set('User-Agent', userAgent);
  expect(login.status).toBe(200);
  return {
    email,
    password,
    workspaceId: defaultWorkspaceId,
    accessToken: login.body.accessToken as string,
    refreshToken: login.body.refreshToken as string,
  };
}

async function loginAgain(email: string, password: string, userAgent: string) {
  const login = await request.post('/api/auth/login').send({ email, password }).set('User-Agent', userAgent);
  expect(login.status).toBe(200);
  return {
    accessToken: login.body.accessToken as string,
    refreshToken: login.body.refreshToken as string,
  };
}

function listSessions(accessToken: string, workspaceId: string) {
  return request
    .get('/api/v1/sessions')
    .set('Authorization', `Bearer ${accessToken}`)
    .set('X-Workspace-Id', workspaceId);
}

describe('Phase 2E active session manager', () => {
  it('lists one session per device and flags the current one', async () => {
    const first = await registerAndLogin(CHROME_WINDOWS);
    await loginAgain(first.email, first.password, SAFARI_IPHONE);

    const response = await listSessions(first.accessToken, first.workspaceId);
    expect(response.status).toBe(200);

    const sessions = response.body as SessionRow[];
    expect(sessions).toHaveLength(2);

    const current = sessions.filter((session) => session.isCurrent);
    expect(current).toHaveLength(1);
    expect(current[0]?.browser).toBe('Chrome');
    expect(current[0]?.os).toBe('Windows');
    expect(current[0]?.deviceType).toBe('DESKTOP');
    expect(current[0]?.isActive).toBe(true);
    expect(current[0]?.ipAddress).toBeTruthy();
    expect(Number.isNaN(Date.parse(current[0]!.lastActiveAt))).toBe(false);
    expect(Number.isNaN(Date.parse(current[0]!.expiresAt))).toBe(false);

    const other = sessions.find((session) => !session.isCurrent);
    expect(other?.browser).toBe('Safari');
    expect(other?.os).toBe('iOS');
    expect(other?.deviceType).toBe('MOBILE');
  });

  it('revokes a single session and invalidates its refresh token', async () => {
    const first = await registerAndLogin(CHROME_WINDOWS);
    const second = await loginAgain(first.email, first.password, SAFARI_IPHONE);

    const before = (await listSessions(first.accessToken, first.workspaceId)).body as SessionRow[];
    const target = before.find((session) => !session.isCurrent);
    expect(target).toBeDefined();

    const revoke = await request
      .post(`/api/v1/sessions/${target!._id}/revoke`)
      .set('Authorization', `Bearer ${first.accessToken}`)
      .set('X-Workspace-Id', first.workspaceId)
      .send({ reason: 'lost device' });
    expect(revoke.status).toBe(200);
    expect(revoke.body.revoked).toBe(true);

    const after = (await listSessions(first.accessToken, first.workspaceId)).body as SessionRow[];
    expect(after).toHaveLength(1);
    expect(after[0]?.isCurrent).toBe(true);

    const reused = await request.post('/api/auth/refresh').send({ refreshToken: second.refreshToken });
    expect(reused.status).toBe(401);
    expect(reused.body.error.code).toBe('INVALID_REFRESH_TOKEN');

    const stillValid = await request.post('/api/auth/refresh').send({ refreshToken: first.refreshToken });
    expect(stillValid.status).toBe(200);
  });

  it('returns 404 for an unknown session id', async () => {
    const first = await registerAndLogin(CHROME_WINDOWS);
    const response = await request
      .post(`/api/v1/sessions/${new mongoose.Types.ObjectId().toString()}/revoke`)
      .set('Authorization', `Bearer ${first.accessToken}`)
      .set('X-Workspace-Id', first.workspaceId)
      .send({});
    expect(response.status).toBe(404);
  });

  it('revoke-others keeps the current session usable and signs out the rest', async () => {
    const first = await registerAndLogin(CHROME_WINDOWS);
    const second = await loginAgain(first.email, first.password, SAFARI_IPHONE);

    const response = await request
      .post('/api/v1/sessions/revoke-others')
      .set('Authorization', `Bearer ${first.accessToken}`)
      .set('X-Workspace-Id', first.workspaceId)
      .send({});
    expect(response.status).toBe(200);
    expect(response.body.count).toBe(1);

    const after = (await listSessions(first.accessToken, first.workspaceId)).body as SessionRow[];
    expect(after).toHaveLength(1);
    expect(after[0]?.isCurrent).toBe(true);

    const currentStillWorks = await request.post('/api/auth/refresh').send({ refreshToken: first.refreshToken });
    expect(currentStillWorks.status).toBe(200);

    const otherRejected = await request.post('/api/auth/refresh').send({ refreshToken: second.refreshToken });
    expect(otherRejected.status).toBe(401);
  });

  it('only returns sessions owned by the requesting user', async () => {
    const owner = await registerAndLogin(CHROME_WINDOWS);
    await loginAgain(owner.email, owner.password, SAFARI_IPHONE);

    const stranger = await registerAndLogin(SAFARI_IPHONE);
    const response = await listSessions(stranger.accessToken, stranger.workspaceId);
    expect(response.status).toBe(200);

    const sessions = response.body as SessionRow[];
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.isCurrent).toBe(true);

    const ownerRows = (await listSessions(owner.accessToken, owner.workspaceId)).body as SessionRow[];
    expect(ownerRows).toHaveLength(2);
  });
});
