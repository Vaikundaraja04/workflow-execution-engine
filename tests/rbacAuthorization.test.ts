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
import { WorkflowModel } from '../src/models/WorkflowModel.js';
import { WorkflowVersionModel } from '../src/models/WorkflowVersionModel.js';
import { WorkflowExecutionModel } from '../src/models/WorkflowExecutionModel.js';
import { RefreshTokenModel } from '../src/models/RefreshTokenModel.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';
import { setMembershipRole, syncMembershipPermissions } from '../src/services/permissionService.js';
import type { ExecutionEnqueueOptions, ExecutionJobData, ExecutionQueue } from '../src/queues/executionQueue.js';
import type { WorkflowDefinition } from '../src/types/workflow.js';

class RecordingQueue implements ExecutionQueue {
  jobs: Array<{ data: ExecutionJobData; options: ExecutionEnqueueOptions }> = [];

  async enqueue(data: ExecutionJobData, options: ExecutionEnqueueOptions): Promise<void> {
    this.jobs.push({ data, options });
  }

  async close(): Promise<void> {}
}

const authConfig = {
  jwtSecret: 'test-jwt-secret-0123456789abcdef',
  accessTtl: '15m',
  refreshTtl: '30d',
};

const queue = new RecordingQueue();

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;

interface Session {
  id: string;
  token: string;
}

function validDefinition(message = 'rbac') {
  return {
    nodes: [
      { id: 'trigger', type: 'webhook', config: {} },
      { id: 'log', type: 'log', config: { message } },
    ],
    edges: [{ source: 'trigger', target: 'log' }],
  } satisfies WorkflowDefinition;
}

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  request = supertest(createApp({
    executionQueue: queue,
    auth: authConfig,
    authRateLimit: { loginLimit: 1000, refreshLimit: 1000 },
  }));
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
  workflowId: string;
  executionId: string;
  owner: Session;
  admin: Session;
  editor: Session;
  viewer: Session;
  outsider: Session;
}

let fixture: Fixture;

beforeEach(async () => {
  queue.jobs = [];
  await AuditLogModel.deleteMany({});
  await WorkflowExecutionModel.deleteMany({});
  await WorkflowVersionModel.deleteMany({});
  await WorkflowModel.deleteMany({});
  await WorkspaceMemberModel.deleteMany({});
  await WorkspaceModel.deleteMany({});
  await RefreshTokenModel.deleteMany({});
  await UserModel.deleteMany({});

  const owner = await createUser('owner@rbac.test');
  const admin = await createUser('admin@rbac.test');
  const editor = await createUser('editor@rbac.test');
  const viewer = await createUser('viewer@rbac.test');
  const outsider = await createUser('outsider@rbac.test');

  const workspace = await WorkspaceModel.create({
    name: 'Shared',
    slug: `shared-${new Types.ObjectId().toString()}`,
    ownerId: new Types.ObjectId(owner.id),
    status: 'ACTIVE',
  });
  const workspaceId = workspace._id.toString();

  await addMember(workspaceId, owner.id, 'OWNER');
  await addMember(workspaceId, admin.id, 'ADMIN');
  await addMember(workspaceId, editor.id, 'EDITOR');
  await addMember(workspaceId, viewer.id, 'VIEWER');

  const created = await request
    .post('/api/workflows')
    .set(authHeader(owner.token))
    .send({ name: 'Shared workflow', definition: validDefinition(), workspaceId });
  expect(created.status).toBe(201);
  const workflowId = created.body._id as string;
  expect(created.body.workspaceId).toBe(workspaceId);

  const published = await request
    .post(`/api/workflows/${workflowId}/publish`)
    .set(authHeader(owner.token));
  expect(published.status).toBe(201);

  const queued = await request
    .post(`/api/workflows/${workflowId}/executions`)
    .set(authHeader(owner.token))
    .send({ idempotencyKey: 'rbac-1', input: { estimatedCost: 15_000 } });
  expect(queued.status).toBe(202);

  fixture = {
    workspaceId,
    workflowId,
    executionId: queued.body.executionId as string,
    owner,
    admin,
    editor,
    viewer,
    outsider,
  };
});

describe('Phase 3B RBAC authorization', () => {
  describe('OWNER', () => {
    it('has full access to workflows and executions in the workspace', async () => {
      const read = await request.get(`/api/workflows/${fixture.workflowId}`).set(authHeader(fixture.owner.token));
      expect(read.status).toBe(200);

      const validate = await request
        .post(`/api/workflows/${fixture.workflowId}/validate`)
        .set(authHeader(fixture.owner.token));
      expect(validate.status).toBe(200);
      expect(validate.body.valid).toBe(true);

      const update = await request
        .put(`/api/workflows/${fixture.workflowId}/draft`)
        .set(authHeader(fixture.owner.token))
        .send({ name: 'Renamed by owner' });
      expect(update.status).toBe(200);

      const publish = await request
        .post(`/api/workflows/${fixture.workflowId}/publish`)
        .set(authHeader(fixture.owner.token));
      expect(publish.status).toBe(201);

      const versions = await request
        .get(`/api/workflows/${fixture.workflowId}/versions`)
        .set(authHeader(fixture.owner.token));
      expect(versions.status).toBe(200);

      const execute = await request
        .post(`/api/workflows/${fixture.workflowId}/executions`)
        .set(authHeader(fixture.owner.token))
        .send({ idempotencyKey: 'owner-second', input: {} });
      expect(execute.status).toBe(202);

      const history = await request
        .get(`/api/workflows/${fixture.workflowId}/executions`)
        .set(authHeader(fixture.owner.token));
      expect(history.status).toBe(200);
      expect(history.body).toHaveLength(2);
    });
  });

  describe('ADMIN', () => {
    it('reads, updates, publishes and executes workflows like the owner', async () => {
      const read = await request.get(`/api/workflows/${fixture.workflowId}`).set(authHeader(fixture.admin.token));
      expect(read.status).toBe(200);

      const update = await request
        .put(`/api/workflows/${fixture.workflowId}/draft`)
        .set(authHeader(fixture.admin.token))
        .send({ name: 'Renamed by admin' });
      expect(update.status).toBe(200);

      const publish = await request
        .post(`/api/workflows/${fixture.workflowId}/publish`)
        .set(authHeader(fixture.admin.token));
      expect(publish.status).toBe(201);

      const execute = await request
        .post(`/api/workflows/${fixture.workflowId}/executions`)
        .set(authHeader(fixture.admin.token))
        .send({ idempotencyKey: 'admin-1', input: {} });
      expect(execute.status).toBe(202);

      const workspace = await request
        .get(`/api/workspaces/${fixture.workspaceId}`)
        .set(authHeader(fixture.admin.token));
      expect(workspace.status).toBe(200);
    });

    it('cannot perform owner-only workspace actions', async () => {
      const rename = await request
        .patch(`/api/workspaces/${fixture.workspaceId}`)
        .set(authHeader(fixture.admin.token))
        .send({ name: 'Renamed by admin' });
      expect(rename.status).toBe(403);
      expect(rename.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('EDITOR', () => {
    it('reads, updates and executes workflows in the workspace', async () => {
      const read = await request.get(`/api/workflows/${fixture.workflowId}`).set(authHeader(fixture.editor.token));
      expect(read.status).toBe(200);

      const update = await request
        .put(`/api/workflows/${fixture.workflowId}/draft`)
        .set(authHeader(fixture.editor.token))
        .send({ name: 'Renamed by editor' });
      expect(update.status).toBe(200);

      const execute = await request
        .post(`/api/workflows/${fixture.workflowId}/executions`)
        .set(authHeader(fixture.editor.token))
        .send({ idempotencyKey: 'editor-1', input: {} });
      expect(execute.status).toBe(202);
    });

    it('creates a workflow in the workspace that other members can read', async () => {
      const created = await request
        .post('/api/workflows')
        .set(authHeader(fixture.editor.token))
        .send({ name: 'Editor workflow', definition: validDefinition('editor'), workspaceId: fixture.workspaceId });
      expect(created.status).toBe(201);
      expect(created.body.workspaceId).toBe(fixture.workspaceId);

      const ownerRead = await request
        .get(`/api/workflows/${created.body._id}`)
        .set(authHeader(fixture.owner.token));
      expect(ownerRead.status).toBe(200);

      const viewerRead = await request
        .get(`/api/workflows/${created.body._id}`)
        .set(authHeader(fixture.viewer.token));
      expect(viewerRead.status).toBe(200);
    });

    it('cannot manage the workspace itself', async () => {
      const rename = await request
        .patch(`/api/workspaces/${fixture.workspaceId}`)
        .set(authHeader(fixture.editor.token))
        .send({ name: 'Renamed by editor' });
      expect(rename.status).toBe(403);
      expect(rename.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('VIEWER', () => {
    it('reads workflows, versions and executions', async () => {
      const read = await request.get(`/api/workflows/${fixture.workflowId}`).set(authHeader(fixture.viewer.token));
      expect(read.status).toBe(200);

      const versions = await request
        .get(`/api/workflows/${fixture.workflowId}/versions`)
        .set(authHeader(fixture.viewer.token));
      expect(versions.status).toBe(200);

      const history = await request
        .get(`/api/workflows/${fixture.workflowId}/executions`)
        .set(authHeader(fixture.viewer.token));
      expect(history.status).toBe(200);

      const execution = await request
        .get(`/api/executions/${fixture.executionId}`)
        .set(authHeader(fixture.viewer.token));
      expect(execution.status).toBe(200);
    });

    it('cannot create, update, validate, publish or execute', async () => {
      const create = await request
        .post('/api/workflows')
        .set(authHeader(fixture.viewer.token))
        .send({ name: 'Viewer workflow', definition: validDefinition(), workspaceId: fixture.workspaceId });
      expect(create.status).toBe(403);
      expect(create.body.error.code).toBe('FORBIDDEN');

      const update = await request
        .put(`/api/workflows/${fixture.workflowId}/draft`)
        .set(authHeader(fixture.viewer.token))
        .send({ name: 'Renamed by viewer' });
      expect(update.status).toBe(403);
      expect(update.body.error.code).toBe('FORBIDDEN');

      const validate = await request
        .post(`/api/workflows/${fixture.workflowId}/validate`)
        .set(authHeader(fixture.viewer.token));
      expect(validate.status).toBe(403);

      const publish = await request
        .post(`/api/workflows/${fixture.workflowId}/publish`)
        .set(authHeader(fixture.viewer.token));
      expect(publish.status).toBe(403);

      const execute = await request
        .post(`/api/workflows/${fixture.workflowId}/executions`)
        .set(authHeader(fixture.viewer.token))
        .send({ idempotencyKey: 'viewer-1', input: {} });
      expect(execute.status).toBe(403);
      expect(execute.body.error.code).toBe('FORBIDDEN');
      expect(queue.jobs).toHaveLength(1);
    });
  });

  describe('cross workspace isolation', () => {
    it('hides workflows, executions and workspaces from non-members', async () => {
      const read = await request.get(`/api/workflows/${fixture.workflowId}`).set(authHeader(fixture.outsider.token));
      expect(read.status).toBe(404);
      expect(read.body.error.code).toBe('WORKFLOW_NOT_FOUND');

      const update = await request
        .put(`/api/workflows/${fixture.workflowId}/draft`)
        .set(authHeader(fixture.outsider.token))
        .send({ name: 'Hijacked' });
      expect(update.status).toBe(404);
      expect(update.body.error.code).toBe('WORKFLOW_NOT_FOUND');

      const execute = await request
        .post(`/api/workflows/${fixture.workflowId}/executions`)
        .set(authHeader(fixture.outsider.token))
        .send({ idempotencyKey: 'outsider-1', input: {} });
      expect(execute.status).toBe(404);
      expect(queue.jobs).toHaveLength(1);

      const execution = await request
        .get(`/api/executions/${fixture.executionId}`)
        .set(authHeader(fixture.outsider.token));
      expect(execution.status).toBe(404);
      expect(execution.body.error.code).toBe('EXECUTION_NOT_FOUND');

      const workspace = await request
        .get(`/api/workspaces/${fixture.workspaceId}`)
        .set(authHeader(fixture.outsider.token));
      expect(workspace.status).toBe(404);
      expect(workspace.body.error.code).toBe('WORKSPACE_NOT_FOUND');

      const rename = await request
        .patch(`/api/workspaces/${fixture.workspaceId}`)
        .set(authHeader(fixture.outsider.token))
        .send({ name: 'Hijacked' });
      expect(rename.status).toBe(404);
    });

    it('does not let a body workspaceId bypass authorization', async () => {
      const spoof = await request
        .post('/api/workflows')
        .set(authHeader(fixture.outsider.token))
        .send({ name: 'Spoof', definition: validDefinition(), workspaceId: fixture.workspaceId });
      expect(spoof.status).toBe(404);
      expect(spoof.body.error.code).toBe('WORKSPACE_NOT_FOUND');

      const viewerAttempt = await request
        .post('/api/workflows')
        .set(authHeader(fixture.viewer.token))
        .send({ name: 'Spoof', definition: validDefinition(), workspaceId: fixture.workspaceId });
      expect(viewerAttempt.status).toBe(403);
      expect(viewerAttempt.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('membership validation', () => {
    it('denies an invited member with PERMISSION_DENIED', async () => {
      const invited = await createUser('invited@rbac.test');
      await addMember(fixture.workspaceId, invited.id, 'EDITOR', 'INVITED');

      const read = await request.get(`/api/workflows/${fixture.workflowId}`).set(authHeader(invited.token));
      expect(read.status).toBe(403);
      expect(read.body.error.code).toBe('PERMISSION_DENIED');
    });

    it('treats a removed member as a non-member', async () => {
      const removed = await createUser('removed@rbac.test');
      await addMember(fixture.workspaceId, removed.id, 'EDITOR', 'REMOVED');

      const read = await request.get(`/api/workflows/${fixture.workflowId}`).set(authHeader(removed.token));
      expect(read.status).toBe(404);
      expect(read.body.error.code).toBe('WORKFLOW_NOT_FOUND');
    });

    it('blocks every member while the workspace is suspended', async () => {
      await WorkspaceModel.updateOne(
        { _id: new Types.ObjectId(fixture.workspaceId) },
        { $set: { status: 'SUSPENDED' } },
      );

      const ownerRead = await request.get(`/api/workflows/${fixture.workflowId}`).set(authHeader(fixture.owner.token));
      expect(ownerRead.status).toBe(403);
      expect(ownerRead.body.error.code).toBe('PERMISSION_DENIED');

      const viewerRead = await request.get(`/api/workflows/${fixture.workflowId}`).set(authHeader(fixture.viewer.token));
      expect(viewerRead.status).toBe(403);
    });
  });

  describe('role changes and membership permissions', () => {
    it('applies a role change on the next request', async () => {
      const promoted = await setMembershipRole(fixture.workspaceId, fixture.viewer.id, 'EDITOR');
      expect(promoted?.permissions).toContain('WORKFLOW_EXECUTE');

      const execute = await request
        .post(`/api/workflows/${fixture.workflowId}/executions`)
        .set(authHeader(fixture.viewer.token))
        .send({ idempotencyKey: 'promoted-1', input: {} });
      expect(execute.status).toBe(202);

      await setMembershipRole(fixture.workspaceId, fixture.editor.id, 'VIEWER');
      const update = await request
        .put(`/api/workflows/${fixture.workflowId}/draft`)
        .set(authHeader(fixture.editor.token))
        .send({ name: 'Nope' });
      expect(update.status).toBe(403);
      expect(update.body.error.code).toBe('FORBIDDEN');
    });

    it('stores the resolved permission set on the membership', async () => {
      const editorMember = await WorkspaceMemberModel.findOne({
        workspaceId: fixture.workspaceId,
        userId: fixture.editor.id,
      });
      expect(editorMember).not.toBeNull();
      expect([...(editorMember?.permissions ?? [])].sort()).toEqual([...permissionsForRole('EDITOR')].sort());

      const viewerMember = await WorkspaceMemberModel.findOne({
        workspaceId: fixture.workspaceId,
        userId: fixture.viewer.id,
      });
      expect(viewerMember?.permissions).toEqual(['WORKFLOW_READ']);

      const memberId = editorMember ? editorMember._id : new Types.ObjectId();
      const synced = await syncMembershipPermissions(memberId);
      expect(synced).toEqual(permissionsForRole('EDITOR'));
    });

    it('keeps legacy owner-scoped rows reachable only by their owner', async () => {
      const legacy = await WorkflowModel.create({
        name: 'Legacy workflow',
        draftDefinition: validDefinition('legacy'),
        status: 'DRAFT',
        latestVersionNumber: 0,
        ownerId: new Types.ObjectId(fixture.owner.id),
      });
      const legacyId = legacy._id.toString();

      const ownerRead = await request.get(`/api/workflows/${legacyId}`).set(authHeader(fixture.owner.token));
      expect(ownerRead.status).toBe(200);

      const editorRead = await request.get(`/api/workflows/${legacyId}`).set(authHeader(fixture.editor.token));
      expect(editorRead.status).toBe(404);
      expect(editorRead.body.error.code).toBe('WORKFLOW_NOT_FOUND');
    });
  });
});
