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
import type { WorkspaceRole } from '../src/models/WorkspaceMemberModel.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';

const authConfig = {
  jwtSecret: 'test-jwt-secret-0123456789abcdef',
  accessTtl: '15m',
  refreshTtl: '30d',
};

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;

interface Session {
  id: string;
  email: string;
  token: string;
}

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function createUser(email: string): Promise<Session> {
  const user = await UserModel.create({ email, passwordHash: 'not-used' });
  const id = user._id.toString();
  return { id, email, token: signAccessToken(authConfig, { userId: id, email }) };
}

async function addMember(workspaceId: string, userId: string, role: WorkspaceRole): Promise<void> {
  await WorkspaceMemberModel.create({
    workspaceId: new Types.ObjectId(workspaceId),
    userId: new Types.ObjectId(userId),
    role,
    status: 'ACTIVE',
    permissions: permissionsForRole(role),
  });
}

describe('Phase 7E Enterprise Activity Feed', () => {
  let owner: Session;
  let admin: Session;
  let editor: Session;
  let viewer: Session;
  let outsider: Session;
  let workspaceId: string;

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

  beforeEach(async () => {
    await AuditLogModel.deleteMany({});
    await WorkspaceMemberModel.deleteMany({});
    await WorkspaceModel.deleteMany({});
    await UserModel.deleteMany({});

    owner = await createUser('owner@activity.test');
    admin = await createUser('admin@activity.test');
    editor = await createUser('editor@activity.test');
    viewer = await createUser('viewer@activity.test');
    outsider = await createUser('outsider@activity.test');

    const workspace = await WorkspaceModel.create({
      name: 'Activity Workspace',
      slug: `activity-ws-${new Types.ObjectId().toString()}`,
      ownerId: new Types.ObjectId(owner.id),
      status: 'ACTIVE',
    });
    workspaceId = workspace._id.toString();

    await addMember(workspaceId, owner.id, 'OWNER');
    await addMember(workspaceId, admin.id, 'ADMIN');
    await addMember(workspaceId, editor.id, 'EDITOR');
    await addMember(workspaceId, viewer.id, 'VIEWER');

    // Create sample audit logs for testing activity feed
    await AuditLogModel.create([
      {
        workspaceId: new Types.ObjectId(workspaceId),
        userId: new Types.ObjectId(owner.id),
        action: 'WORKSPACE_CREATED',
        resource: 'Workspace',
        resourceId: workspaceId,
        metadata: { name: 'Activity Workspace' },
        createdAt: new Date('2026-09-01T10:00:00Z'),
      },
      {
        workspaceId: new Types.ObjectId(workspaceId),
        userId: new Types.ObjectId(editor.id),
        action: 'WORKFLOW_CREATED',
        resource: 'Workflow',
        resourceId: 'wf-1',
        metadata: { name: 'Main Pipeline' },
        createdAt: new Date('2026-09-02T12:00:00Z'),
      },
      {
        workspaceId: new Types.ObjectId(workspaceId),
        userId: new Types.ObjectId(editor.id),
        action: 'COMMENT_CREATED',
        resource: 'WorkflowComment',
        resourceId: 'comment-1',
        metadata: { workflowId: 'wf-1' },
        createdAt: new Date('2026-09-03T14:00:00Z'),
      },
      {
        workspaceId: new Types.ObjectId(workspaceId),
        userId: new Types.ObjectId(admin.id),
        action: 'WORKFLOW_LOCKED',
        resource: 'Workflow',
        resourceId: 'wf-1',
        metadata: { ttlSeconds: 60 },
        createdAt: new Date('2026-09-04T16:00:00Z'),
      },
    ]);
  });

  describe('Activity Feed API', () => {
    it('returns paginated activity timeline for workspace admin', async () => {
      const res = await request
        .get('/api/v1/activity')
        .set(authHeader(admin.token))
        .set('x-workspace-id', workspaceId)
        .query({ limit: 10, offset: 0 });

      expect(res.status).toBe(200);
      expect(res.body.activities).toHaveLength(4);
      expect(res.body.total).toBe(4);
      // Verify sorted newest first
      expect(res.body.activities[0].action).toBe('WORKFLOW_LOCKED');
      expect(res.body.activities[3].action).toBe('WORKSPACE_CREATED');
      // Verify user information population
      expect(res.body.activities[0].userEmail).toBe('admin@activity.test');
      expect(res.body.activities[0].userName).toBe('admin');
    });

    it('filters activity by action', async () => {
      const res = await request
        .get('/api/v1/activity')
        .set(authHeader(admin.token))
        .set('x-workspace-id', workspaceId)
        .query({ action: 'COMMENT_CREATED' });

      expect(res.status).toBe(200);
      expect(res.body.activities).toHaveLength(1);
      expect(res.body.activities[0].action).toBe('COMMENT_CREATED');
      expect(res.body.activities[0].resource).toBe('WorkflowComment');
      expect(res.body.total).toBe(1);
    });

    it('filters activity by resource type', async () => {
      const res = await request
        .get('/api/v1/activity')
        .set(authHeader(admin.token))
        .set('x-workspace-id', workspaceId)
        .query({ resource: 'Workflow' });

      expect(res.status).toBe(200);
      expect(res.body.activities).toHaveLength(2);
      expect(res.body.total).toBe(2);
    });

    it('filters activity by user ID', async () => {
      const res = await request
        .get('/api/v1/activity')
        .set(authHeader(admin.token))
        .set('x-workspace-id', workspaceId)
        .query({ userId: editor.id });

      expect(res.status).toBe(200);
      expect(res.body.activities).toHaveLength(2);
      expect(res.body.activities[0].userId).toBe(editor.id);
      expect(res.body.activities[1].userId).toBe(editor.id);
    });

    it('filters activity by date range', async () => {
      const res = await request
        .get('/api/v1/activity')
        .set(authHeader(admin.token))
        .set('x-workspace-id', workspaceId)
        .query({
          startDate: '2026-09-02T00:00:00Z',
          endDate: '2026-09-03T23:59:59Z',
        });

      expect(res.status).toBe(200);
      expect(res.body.activities).toHaveLength(2);
      expect(res.body.activities[0].action).toBe('COMMENT_CREATED');
      expect(res.body.activities[1].action).toBe('WORKFLOW_CREATED');
    });

    it('supports pagination with limit and offset', async () => {
      const res = await request
        .get('/api/v1/activity')
        .set(authHeader(admin.token))
        .set('x-workspace-id', workspaceId)
        .query({ limit: 2, offset: 1 });

      expect(res.status).toBe(200);
      expect(res.body.activities).toHaveLength(2);
      expect(res.body.total).toBe(4);
      expect(res.body.activities[0].action).toBe('COMMENT_CREATED');
      expect(res.body.activities[1].action).toBe('WORKFLOW_CREATED');
    });

    it('forbids members without AUDIT_READ permission (e.g. editor, viewer)', async () => {
      const editorRes = await request
        .get('/api/v1/activity')
        .set(authHeader(editor.token))
        .set('x-workspace-id', workspaceId);

      expect(editorRes.status).toBe(403);

      const viewerRes = await request
        .get('/api/v1/activity')
        .set(authHeader(viewer.token))
        .set('x-workspace-id', workspaceId);

      expect(viewerRes.status).toBe(403);
    });

    it('hides activity feed from non-members', async () => {
      const res = await request
        .get('/api/v1/activity')
        .set(authHeader(outsider.token))
        .set('x-workspace-id', workspaceId);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('WORKSPACE_NOT_FOUND');
    });
  });
});
