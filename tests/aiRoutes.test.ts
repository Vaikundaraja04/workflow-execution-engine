import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { createApp } from '../src/api/app.js';
import { signAccessToken } from '../src/auth/jwt.service.js';
import { permissionsForRole } from '../src/auth/permissions.js';
import { UserModel } from '../src/models/UserModel.js';
import { WorkspaceModel } from '../src/models/WorkspaceModel.js';
import { WorkspaceMemberModel } from '../src/models/WorkspaceMemberModel.js';
import type { MembershipStatus, WorkspaceRole } from '../src/models/WorkspaceMemberModel.js';
import { AIConfigurationModel } from '../src/models/AIConfigurationModel.js';
import { AIUsageModel } from '../src/models/AIUsageModel.js';
import { AIProviderFactory } from '../src/services/ai/AIProviderFactory.js';

const authConfig = {
  jwtSecret: 'test-jwt-secret-0123456789abcdef',
  accessTtl: '15m',
  refreshTtl: '30d',
};

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;

interface Session {
  id: string;
  token: string;
}

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  request = supertest(
    createApp({
      auth: authConfig,
      authRateLimit: { loginLimit: 1000, refreshLimit: 1000 },
    }),
  );
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
}, 30000);

async function createUser(email: string): Promise<Session> {
  const user = await UserModel.create({ email, passwordHash: 'not-used' });
  const id = user._id.toString();
  return { id, token: signAccessToken(authConfig, { userId: id, email }) };
}

async function addMember(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
  status: MembershipStatus = 'ACTIVE',
): Promise<void> {
  await WorkspaceMemberModel.create({
    workspaceId: new Types.ObjectId(workspaceId),
    userId: new Types.ObjectId(userId),
    role,
    status,
    permissions: permissionsForRole(role),
  });
}

interface Fixture {
  workspaceId: string;
  owner: Session;
  editor: Session;
  viewer: Session;
}

let fixture: Fixture;

beforeEach(async () => {
  AIProviderFactory.resetMockProvider();
  await AIUsageModel.deleteMany({});
  await AIConfigurationModel.deleteMany({});
  await WorkspaceMemberModel.deleteMany({});
  await WorkspaceModel.deleteMany({});
  await UserModel.deleteMany({});

  const owner = await createUser('owner@ai.test');
  const editor = await createUser('editor@ai.test');
  const viewer = await createUser('viewer@ai.test');

  const workspace = await WorkspaceModel.create({
    name: 'AI Workspace',
    slug: `ai-${new Types.ObjectId().toString()}`,
    ownerId: new Types.ObjectId(owner.id),
    status: 'ACTIVE',
  });
  const workspaceId = workspace._id.toString();

  await addMember(workspaceId, owner.id, 'OWNER');
  await addMember(workspaceId, editor.id, 'EDITOR');
  await addMember(workspaceId, viewer.id, 'VIEWER');

  fixture = { workspaceId, owner, editor, viewer };
});

describe('AI routes mounted under /api/v1/ai', () => {
  it('rejects unauthenticated workflow generation with 401', async () => {
    const response = await request
      .post('/api/v1/ai/workflows/generate')
      .set('X-Workspace-Id', fixture.workspaceId)
      .send({ prompt: 'Create an onboarding workflow' });

    expect(response.status).toBe(401);
  });

  it('denies workflow generation for VIEWER with 403', async () => {
    const response = await request
      .post('/api/v1/ai/workflows/generate')
      .set(authHeader(fixture.viewer.token))
      .set('X-Workspace-Id', fixture.workspaceId)
      .send({ prompt: 'Create an onboarding workflow' });

    expect(response.status).toBe(403);
  });

  it('generates a DRAFT workflow for EDITOR', async () => {
    const response = await request
      .post('/api/v1/ai/workflows/generate')
      .set(authHeader(fixture.editor.token))
      .set('X-Workspace-Id', fixture.workspaceId)
      .send({ prompt: 'Create an employee onboarding workflow' });

    expect(response.status).toBe(200);
    expect(response.body.draftWorkflow.status).toBe('DRAFT');
    expect(response.body.draftWorkflow.isPublished).toBe(false);
    expect(response.body.validation.isValid).toBe(true);
    expect(response.body.suggestedTemplateName).toBeDefined();
  });

  it('rejects non-string prompts with 400', async () => {
    const response = await request
      .post('/api/v1/ai/workflows/generate')
      .set(authHeader(fixture.editor.token))
      .set('X-Workspace-Id', fixture.workspaceId)
      .send({ prompt: 42 });

    expect(response.status).toBe(400);
  });

  it('hides unknown executions from analysis with 404', async () => {
    const response = await request
      .get(`/api/v1/ai/executions/${new Types.ObjectId().toString()}/analyze`)
      .set(authHeader(fixture.editor.token))
      .set('X-Workspace-Id', fixture.workspaceId);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('EXECUTION_NOT_FOUND');
  });

  it('rejects malformed execution ids with 400', async () => {
    const response = await request
      .get('/api/v1/ai/executions/not-an-id/analyze')
      .set(authHeader(fixture.editor.token))
      .set('X-Workspace-Id', fixture.workspaceId);

    expect(response.status).toBe(400);
  });

  it('denies usage reporting for EDITOR with 403', async () => {
    const response = await request
      .get('/api/v1/ai/usage')
      .set(authHeader(fixture.editor.token))
      .set('X-Workspace-Id', fixture.workspaceId);

    expect(response.status).toBe(403);
  });

  it('returns usage records for OWNER', async () => {
    const response = await request
      .get('/api/v1/ai/usage')
      .set(authHeader(fixture.owner.token))
      .set('X-Workspace-Id', fixture.workspaceId);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });
});

describe('AI configuration routes mounted under /api/v1/admin/ai', () => {
  it('denies configuration reads for VIEWER with 403', async () => {
    const response = await request
      .get('/api/v1/admin/ai/config')
      .set(authHeader(fixture.viewer.token))
      .set('X-Workspace-Id', fixture.workspaceId);

    expect(response.status).toBe(403);
  });

  it('returns 404 before a configuration exists', async () => {
    const response = await request
      .get('/api/v1/admin/ai/config')
      .set(authHeader(fixture.owner.token))
      .set('X-Workspace-Id', fixture.workspaceId);

    expect(response.status).toBe(404);
  });

  it('creates and reads back the workspace configuration', async () => {
    const update = await request
      .patch('/api/v1/admin/ai/config')
      .set(authHeader(fixture.owner.token))
      .set('X-Workspace-Id', fixture.workspaceId)
      .send({ provider: 'mock', model: 'mock-model' });

    expect(update.status).toBe(200);
    expect(update.body.provider).toBe('mock');
    expect(update.body.apiKeyEncrypted).toBeUndefined();

    const read = await request
      .get('/api/v1/admin/ai/config')
      .set(authHeader(fixture.owner.token))
      .set('X-Workspace-Id', fixture.workspaceId);

    expect(read.status).toBe(200);
    expect(read.body.model).toBe('mock-model');
  });
});
