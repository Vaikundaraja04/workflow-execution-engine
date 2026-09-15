import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createApp } from '../src/api/app.js';
import { UserModel } from '../src/models/UserModel.js';
import { RefreshTokenModel } from '../src/models/RefreshTokenModel.js';
import { WorkspaceModel } from '../src/models/WorkspaceModel.js';
import { WorkspaceMemberModel } from '../src/models/WorkspaceMemberModel.js';

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
  await WorkspaceMemberModel.deleteMany({});
  await WorkspaceModel.deleteMany({});
  await UserModel.deleteMany({});
  await RefreshTokenModel.deleteMany({});
});

async function createSession(email: string) {
  const register = await request
    .post('/api/auth/register')
    .send({ email, password: 'correct-horse-1' });
  expect(register.status).toBe(201);
  const login = await request
    .post('/api/auth/login')
    .send({ email, password: 'correct-horse-1' });
  expect(login.status).toBe(200);
  return {
    userId: register.body.id as string,
    token: login.body.accessToken as string,
    defaultWorkspaceId: login.body.defaultWorkspaceId as string,
  };
}

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}
describe('Phase 3A workspaces', () => {
  it('auto-creates a personal workspace with OWNER membership at registration', async () => {
    const session = await createSession('owner@example.com');
    expect(typeof session.defaultWorkspaceId).toBe('string');

    const workspace = await WorkspaceModel.findById(session.defaultWorkspaceId);
    expect(workspace?.name).toBe('Personal');
    expect(workspace?.status).toBe('ACTIVE');

    const membership = await WorkspaceMemberModel.findOne({
      workspaceId: session.defaultWorkspaceId,
      userId: session.userId,
    });
    expect(membership?.role).toBe('OWNER');
    expect(membership?.status).toBe('ACTIVE');
  });

  it('lists my workspaces with roles through the API', async () => {
    const session = await createSession('list@test.com');
    const res = await request
      .get('/api/workspaces')
      .set(authHeader(session.token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(session.defaultWorkspaceId);
    expect(res.body[0].role).toBe('OWNER');
    expect(res.body[0].name).toBe('Personal');
  });

  it('creates and retrieves an additional workspace as its OWNER', async () => {
    const session = await createSession('creator@example.com');
    const created = await request
      .post('/api/workspaces')
      .set(authHeader(session.token))
      .send({ name: 'Production' });
    expect(created.status).toBe(201);
    expect(created.body.role).toBe('OWNER');
    expect(created.body.name).toBe('Production');
    expect(typeof created.body.slug).toBe('string');

    const got = await request
      .get(`/api/workspaces/${created.body.id}`)
      .set(authHeader(session.token));
    expect(got.status).toBe(200);
    expect(got.body.id).toBe(created.body.id);

    const list = await request
      .get('/api/workspaces')
      .set(authHeader(session.token));
    expect(list.body.map((entry: { name: string }) => entry.name).sort())
      .toEqual(['Personal', 'Production']);
  });

  it('lets the OWNER rename their workspace', async () => {
    const session = await createSession('editor@example.com');
    const updated = await request
      .patch(`/api/workspaces/${session.defaultWorkspaceId}`)
      .set(authHeader(session.token))
      .send({ name: 'Team Dev' });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe('Team Dev');
  });
  it('rejects invalid workspace bodies and unknown fields', async () => {
    const session = await createSession('strict@example.com');
    const emptyName = await request
      .post('/api/workspaces')
      .set(authHeader(session.token))
      .send({ name: '' });
    expect(emptyName.status).toBe(400);

    const unknown = await request
      .post('/api/workspaces')
      .set(authHeader(session.token))
      .send({ name: 'Team', unexpected: true });
    expect(unknown.status).toBe(400);
  });

  it('isolates workspaces between users (404, no leakage)', async () => {
    const owner = await createSession('ws-owner@example.com');
    const other = await createSession('ws-other@example.com');

    const otherRead = await request
      .get(`/api/workspaces/${owner.defaultWorkspaceId}`)
      .set(authHeader(other.token));
    expect(otherRead.status).toBe(404);
    expect(otherRead.body.error.code).toBe('WORKSPACE_NOT_FOUND');

    const otherUpdate = await request
      .patch(`/api/workspaces/${owner.defaultWorkspaceId}`)
      .set(authHeader(other.token))
      .send({ name: 'Hijacked' });
    expect(otherUpdate.status).toBe(404);
  });
});