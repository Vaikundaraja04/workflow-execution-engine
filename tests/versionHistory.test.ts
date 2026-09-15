import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createApp } from '../src/api/app.js';
import { permissionsForRole } from '../src/auth/permissions.js';
import { signAccessToken } from '../src/auth/jwt.service.js';
import { UserModel } from '../src/models/UserModel.js';
import { WorkspaceModel } from '../src/models/WorkspaceModel.js';
import { WorkspaceMemberModel } from '../src/models/WorkspaceMemberModel.js';
import type { WorkspaceRole } from '../src/models/WorkspaceMemberModel.js';
import { WorkflowModel } from '../src/models/WorkflowModel.js';
import { WorkflowVersionModel } from '../src/models/WorkflowVersionModel.js';
import type { WorkflowDefinition } from '../src/types/workflow.js';

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

let owner: Session;
let viewer: Session;
let outsider: Session;
let workspaceId: string;
let workflowId: string;

function authHeader(token: string) {
  return { Authorization: 'Bearer ' + token };
}

function definitionV1() {
  return {
    nodes: [
      { id: 'trigger', type: 'webhook', config: {} },
      { id: 'log', type: 'log', config: { message: 'version one' } },
    ],
    edges: [{ source: 'trigger', target: 'log' }],
  } satisfies WorkflowDefinition;
}

function definitionV2() {
  return {
    nodes: [
      { id: 'trigger', type: 'webhook', config: {} },
      { id: 'log', type: 'log', config: { message: 'version two' } },
      { id: 'extra', type: 'log', config: { message: 'extra' } },
    ],
    edges: [
      { source: 'trigger', target: 'log' },
      { source: 'log', target: 'extra' },
    ],
  } satisfies WorkflowDefinition;
}

async function createUser(email: string): Promise<Session> {
  const user = await UserModel.create({ email, passwordHash: 'not-used' });
  const id = user._id.toString();
  return { id, token: signAccessToken(authConfig, { userId: id, email }) };
}

async function addMember(userId: string, role: WorkspaceRole): Promise<void> {
  await WorkspaceMemberModel.create({
    workspaceId: new Types.ObjectId(workspaceId),
    userId: new Types.ObjectId(userId),
    role,
    status: 'ACTIVE',
    permissions: permissionsForRole(role),
  });
}

beforeAll(async () => {
  const platformArgs = process.platform === 'win32' || process.env.MONGOMS_SYSTEM_BINARY
    ? []
    : ['--nounixsocket'];
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, args: platformArgs } });
  await mongoose.connect(replSet.getUri());
  request = supertest(createApp({ auth: authConfig }));
  owner = await createUser('version-owner@example.com');
  viewer = await createUser('version-viewer@example.com');
  outsider = await createUser('version-outsider@example.com');
}, 180_000);

afterAll(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
}, 30_000);

beforeEach(async () => {
  await WorkflowVersionModel.deleteMany({});
  await WorkflowModel.deleteMany({});
  await WorkspaceMemberModel.deleteMany({});
  await WorkspaceModel.deleteMany({});

  const workspace = await WorkspaceModel.create({
    name: 'Version workspace',
    slug: 'version-' + new Types.ObjectId().toString(),
    ownerId: new Types.ObjectId(owner.id),
    status: 'ACTIVE',
  });
  workspaceId = workspace._id.toString();
  await addMember(owner.id, 'OWNER');
  await addMember(viewer.id, 'VIEWER');

  const created = await request
    .post('/api/workflows')
    .set(authHeader(owner.token))
    .send({ name: 'Versioned workflow', definition: definitionV1(), workspaceId });
  expect(created.status).toBe(201);
  workflowId = created.body._id as string;

  const publishedV1 = await request
    .post('/api/workflows/' + workflowId + '/publish')
    .set(authHeader(owner.token))
    .send({ changeSummary: 'initial version' });
  expect(publishedV1.status).toBe(201);

  const updated = await request
    .put('/api/workflows/' + workflowId + '/draft')
    .set(authHeader(owner.token))
    .send({ definition: definitionV2() });
  expect(updated.status).toBe(200);

  const publishedV2 = await request
    .post('/api/workflows/' + workflowId + '/publish')
    .set(authHeader(owner.token))
    .send({ changeSummary: 'second version' });
  expect(publishedV2.status).toBe(201);
});

describe('Phase 3D workflow version history', () => {
  it('lists version history oldest first with publish metadata', async () => {
    const listed = await request
      .get('/api/workflows/' + workflowId + '/versions')
      .set(authHeader(owner.token));

    expect(listed.status).toBe(200);
    expect(listed.body.map((version: { versionNumber: number }) => version.versionNumber))
      .toEqual([1, 2]);
    expect(listed.body[0].status).toBe('PUBLISHED');
    expect(listed.body[0].changeSummary).toBe('initial version');
    expect(listed.body[1].changeSummary).toBe('second version');
    expect(listed.body[0].createdBy).toBe(owner.id);
    expect(listed.body[0].definitionHash).toMatch(/^[0-9a-f]{64}$/);
    expect(listed.body[0].definition).toEqual(definitionV1());

    const byNumber = await request
      .get('/api/workflows/' + workflowId + '/versions/1')
      .set(authHeader(owner.token));
    expect(byNumber.status).toBe(200);
    expect(byNumber.body.versionNumber).toBe(1);
    expect(byNumber.body.definition).toEqual(definitionV1());

    const byId = await request
      .get('/api/workflows/' + workflowId + '/versions/' + listed.body[1].id)
      .set(authHeader(owner.token));
    expect(byId.status).toBe(200);
    expect(byId.body.versionNumber).toBe(2);
  });

  it('restores an earlier version as a new immutable version', async () => {
    const listed = await request
      .get('/api/workflows/' + workflowId + '/versions')
      .set(authHeader(owner.token));
    const firstVersionId = listed.body[0].id as string;

    const restored = await request
      .post('/api/workflows/' + workflowId + '/versions/1/restore')
      .set(authHeader(owner.token))
      .send({ changeSummary: 'roll back to version one' });

    expect(restored.status).toBe(201);
    expect(restored.body.versionNumber).toBe(3);
    expect(restored.body.sourceVersionId).toBe(firstVersionId);
    expect(restored.body.changeSummary).toBe('roll back to version one');
    expect(restored.body.definition).toEqual(definitionV1());
    expect(restored.body.status).toBe('PUBLISHED');

    const workflow = await WorkflowModel.findById(workflowId);
    expect(workflow?.latestVersionNumber).toBe(3);
    expect(workflow?.publishedVersionId?.toString()).toBe(restored.body.id as string);
    expect(workflow?.draftDefinition).toEqual(definitionV1());

    const byReference = await request
      .post('/api/workflows/' + workflowId + '/versions/' + firstVersionId + '/restore')
      .set(authHeader(owner.token))
      .send({});
    expect(byReference.status).toBe(201);
    expect(byReference.body.versionNumber).toBe(4);
    expect(byReference.body.changeSummary).toBe('Restored from version 1');

    const history = await request
      .get('/api/workflows/' + workflowId + '/versions')
      .set(authHeader(owner.token));
    expect(history.body.map((version: { versionNumber: number }) => version.versionNumber))
      .toEqual([1, 2, 3, 4]);
  });

  it('compares two versions structurally', async () => {
    const compared = await request
      .post('/api/workflows/' + workflowId + '/compare')
      .set(authHeader(owner.token))
      .send({ from: 1, to: 2 });

    expect(compared.status).toBe(200);
    expect(compared.body.identical).toBe(false);
    expect(compared.body.from.versionNumber).toBe(1);
    expect(compared.body.to.versionNumber).toBe(2);
    expect(compared.body.nodes.added).toEqual(['extra']);
    expect(compared.body.nodes.removed).toEqual([]);
    expect(compared.body.nodes.changed).toEqual([{
      id: 'log',
      fields: [{ field: 'config.message', from: 'version one', to: 'version two' }],
    }]);
    expect(compared.body.edges.added).toEqual(['log->extra']);
    expect(compared.body.edges.removed).toEqual([]);

    const identical = await request
      .post('/api/workflows/' + workflowId + '/compare')
      .set(authHeader(owner.token))
      .send({ from: '1', to: '1' });
    expect(identical.status).toBe(200);
    expect(identical.body.identical).toBe(true);
    expect(identical.body.nodes).toEqual({ added: [], removed: [], changed: [] });
  });

  it('requires authentication, permissions, and workspace membership', async () => {
    const anonymous = await request.get('/api/workflows/' + workflowId + '/versions');
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error.code).toBe('UNAUTHENTICATED');

    const viewerRead = await request
      .get('/api/workflows/' + workflowId + '/versions')
      .set(authHeader(viewer.token));
    expect(viewerRead.status).toBe(200);

    const viewerCompare = await request
      .post('/api/workflows/' + workflowId + '/compare')
      .set(authHeader(viewer.token))
      .send({ from: 1, to: 2 });
    expect(viewerCompare.status).toBe(200);

    const viewerRestore = await request
      .post('/api/workflows/' + workflowId + '/versions/1/restore')
      .set(authHeader(viewer.token))
      .send({});
    expect(viewerRestore.status).toBe(403);
    expect(viewerRestore.body.error.code).toBe('FORBIDDEN');

    const outsiderRead = await request
      .get('/api/workflows/' + workflowId + '/versions')
      .set(authHeader(outsider.token));
    expect(outsiderRead.status).toBe(404);
    expect(outsiderRead.body.error.code).toBe('WORKFLOW_NOT_FOUND');

    const outsiderRestore = await request
      .post('/api/workflows/' + workflowId + '/versions/1/restore')
      .set(authHeader(outsider.token))
      .send({});
    expect(outsiderRestore.status).toBe(404);
    expect(outsiderRestore.body.error.code).toBe('WORKFLOW_NOT_FOUND');
  });

  it('validates references and request bodies consistently', async () => {
    const missingVersion = await request
      .get('/api/workflows/' + workflowId + '/versions/99')
      .set(authHeader(owner.token));
    expect(missingVersion.status).toBe(404);
    expect(missingVersion.body.error.code).toBe('VERSION_NOT_FOUND');

    const malformedVersion = await request
      .get('/api/workflows/' + workflowId + '/versions/not-a-version')
      .set(authHeader(owner.token));
    expect(malformedVersion.status).toBe(404);
    expect(malformedVersion.body.error.code).toBe('VERSION_NOT_FOUND');

    const badCompare = await request
      .post('/api/workflows/' + workflowId + '/compare')
      .set(authHeader(owner.token))
      .send({ from: 1 });
    expect(badCompare.status).toBe(400);
    expect(badCompare.body.error.code).toBe('INVALID_REQUEST');

    const unknownCompare = await request
      .post('/api/workflows/' + workflowId + '/compare')
      .set(authHeader(owner.token))
      .send({ from: 1, to: 99 });
    expect(unknownCompare.status).toBe(404);
    expect(unknownCompare.body.error.code).toBe('VERSION_NOT_FOUND');

    const badRestore = await request
      .post('/api/workflows/' + workflowId + '/versions/1/restore')
      .set(authHeader(owner.token))
      .send({ changeSummary: '' });
    expect(badRestore.status).toBe(400);
    expect(badRestore.body.error.code).toBe('INVALID_REQUEST');

    const invalidWorkflow = await request
      .get('/api/workflows/not-an-id/versions')
      .set(authHeader(owner.token));
    expect(invalidWorkflow.status).toBe(400);
    expect(invalidWorkflow.body.error.code).toBe('INVALID_WORKFLOW_ID');

    const unknownWorkflow = await request
      .get('/api/workflows/507f1f77bcf86cd799439011/versions')
      .set(authHeader(owner.token));
    expect(unknownWorkflow.status).toBe(404);
    expect(unknownWorkflow.body.error.code).toBe('WORKFLOW_NOT_FOUND');
  });
});
