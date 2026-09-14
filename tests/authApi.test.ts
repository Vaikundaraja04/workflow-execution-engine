import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createApp } from '../src/api/app.js';
import { UserModel } from '../src/models/UserModel.js';
import { RefreshTokenModel } from '../src/models/RefreshTokenModel.js';
import { WorkflowModel } from '../src/models/WorkflowModel.js';

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
  request = supertest(createApp({ auth: authConfig }));
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
}, 30000);

beforeEach(async () => {
  await UserModel.deleteMany({});
  await RefreshTokenModel.deleteMany({});
  await WorkflowModel.deleteMany({});
});

async function registerUser(email = 'durai@example.com', password = 'correct-horse-1') {
  return request.post('/api/auth/register').send({ email, password });
}

async function loginUser(email = 'durai@example.com', password = 'correct-horse-1') {
  return request.post('/api/auth/login').send({ email, password });
}

describe('Phase 2D authentication', () => {
  it('registers a user and returns a safe response', async () => {
    const res = await registerUser('User@Example.com ');
    expect(res.status).toBe(201);
    expect(res.body.email).toBe('user@example.com');
    expect(typeof res.body.id).toBe('string');
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');

    const stored = await UserModel.findOne({ email: 'user@example.com' }).select('+passwordHash');
    expect(stored?.passwordHash).toBeTruthy();
  });

  it('rejects duplicate registration', async () => {
    await registerUser();
    const res = await registerUser();
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('rejects invalid registration input', async () => {
    const weak = await request.post('/api/auth/register').send({ email: 'a@b.com', password: 'short' });
    expect(weak.status).toBe(400);
    expect(weak.body.error.code).toBe('INVALID_REQUEST');

    const badEmail = await request.post('/api/auth/register').send({ email: 'not-an-email', password: 'correct-horse-1' });
    expect(badEmail.status).toBe(400);
  });

  it('logs in and returns tokens', async () => {
    await registerUser();
    const res = await loginUser();
    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe('string');
    expect(typeof res.body.refreshToken).toBe('string');
  });

  it('rejects a wrong password and an unknown email with the same error', async () => {
    await registerUser();
    const wrongPassword = await loginUser('durai@example.com', 'wrong-password-1');
    const unknownEmail = await loginUser('nobody@example.com', 'correct-horse-1');
    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknownEmail.status).toBe(401);
    expect(unknownEmail.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects requests without a token', async () => {
    const res = await request.get('/api/workflows/507f1f77bcf86cd799439011');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('accepts a valid access token on protected routes', async () => {
    await registerUser();
    const login = await loginUser();
    const res = await request
      .get('/api/workflows/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('WORKFLOW_NOT_FOUND');
  });

  it('rejects malformed and foreign tokens', async () => {
    const malformed = await request
      .get('/api/workflows/507f1f77bcf86cd799439011')
      .set('Authorization', 'Bearer not-a-jwt');
    expect(malformed.status).toBe(401);
    expect(malformed.body.error.code).toBe('INVALID_TOKEN');

    const foreign = jwt.sign(
      { userId: '507f1f77bcf86cd799439011', email: 'a@b.com' },
      'a-different-secret-that-is-32-chars!',
      { algorithm: 'HS256', expiresIn: 60 },
    );
    const foreignRes = await request
      .get('/api/workflows/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${foreign}`);
    expect(foreignRes.status).toBe(401);
    expect(foreignRes.body.error.code).toBe('INVALID_TOKEN');
  });

  it('rejects an expired token', async () => {
    const expired = jwt.sign(
      { userId: '507f1f77bcf86cd799439011', email: 'a@b.com' },
      authConfig.jwtSecret,
      { algorithm: 'HS256', expiresIn: -10 },
    );
    const res = await request
      .get('/api/workflows/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('rotates refresh tokens and invalidates the previous token', async () => {
    await registerUser();
    const login = await loginUser();
    const first = await request.post('/api/auth/refresh').send({ refreshToken: login.body.refreshToken });
    expect(first.status).toBe(200);
    expect(first.body.refreshToken).not.toBe(login.body.refreshToken);

    const replay = await request.post('/api/auth/refresh').send({ refreshToken: login.body.refreshToken });
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('revokes the whole family when a rotated token is replayed', async () => {
    await registerUser();
    const login = await loginUser();
    const first = await request.post('/api/auth/refresh').send({ refreshToken: login.body.refreshToken });
    const second = await request.post('/api/auth/refresh').send({ refreshToken: first.body.refreshToken });
    expect(second.status).toBe(200);

    const replay = await request.post('/api/auth/refresh').send({ refreshToken: login.body.refreshToken });
    expect(replay.status).toBe(401);

    const afterRevoke = await request.post('/api/auth/refresh').send({ refreshToken: second.body.refreshToken });
    expect(afterRevoke.status).toBe(401);
    expect(afterRevoke.body.error.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('rejects an unknown refresh token', async () => {
    const res = await request.post('/api/auth/refresh').send({ refreshToken: 'unknown-token' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('logs out only the current session family', async () => {
    await registerUser();
    const firstSession = await loginUser();
    const secondSession = await loginUser();

    const logout = await request.post('/api/auth/logout').send({ refreshToken: firstSession.body.refreshToken });
    expect(logout.status).toBe(204);

    const revoked = await request.post('/api/auth/refresh').send({ refreshToken: firstSession.body.refreshToken });
    expect(revoked.status).toBe(401);

    const otherSession = await request.post('/api/auth/refresh').send({ refreshToken: secondSession.body.refreshToken });
    expect(otherSession.status).toBe(200);
  });

  it('treats logout as idempotent for unknown tokens', async () => {
    const res = await request.post('/api/auth/logout').send({ refreshToken: 'unknown-token' });
    expect(res.status).toBe(204);
  });
});