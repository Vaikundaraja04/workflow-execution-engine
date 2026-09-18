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
import { WorkflowModel } from '../src/models/WorkflowModel.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';
import { lockService } from '../src/services/lockService.js';

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

describe('Phase 7E Workflow Locks System', () => {
  let owner: Session;
  let admin: Session;
  let editor: Session;
  let viewer: Session;
  let outsider: Session;
  let workspaceId: string;
  let workflowId: string;

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
    await WorkflowModel.deleteMany({});
    await WorkspaceMemberModel.deleteMany({});
    await WorkspaceModel.deleteMany({});
    await UserModel.deleteMany({});

    owner = await createUser('owner@lock.test');
    admin = await createUser('admin@lock.test');
    editor = await createUser('editor@lock.test');
    viewer = await createUser('viewer@lock.test');
    outsider = await createUser('outsider@lock.test');

    const workspace = await WorkspaceModel.create({
      name: 'Lock Workspace',
      slug: `lock-ws-${new Types.ObjectId().toString()}`,
      ownerId: new Types.ObjectId(owner.id),
      status: 'ACTIVE',
    });
    workspaceId = workspace._id.toString();

    await addMember(workspaceId, owner.id, 'OWNER');
    await addMember(workspaceId, admin.id, 'ADMIN');
    await addMember(workspaceId, editor.id, 'EDITOR');
    await addMember(workspaceId, viewer.id, 'VIEWER');

    const workflow = await WorkflowModel.create({
      name: 'Lockable Workflow',
      draftDefinition: { nodes: [], edges: [] },
      status: 'DRAFT',
      ownerId: new Types.ObjectId(owner.id),
      createdBy: new Types.ObjectId(owner.id),
      workspaceId: new Types.ObjectId(workspaceId),
    });
    workflowId = workflow._id.toString();
  });

  describe('Lock Acquisition & Management', () => {
    it('acquires a lock on a workflow', async () => {
      const res = await request
        .post(`/api/v1/locks/workflows/${workflowId}/acquire`)
        .set(authHeader(editor.token))
        .set('x-workspace-id', workspaceId)
        .send({ ttlSeconds: 30 });

      expect(res.status).toBe(200);
      expect(res.body.acquired).toBe(true);
      expect(res.body.lock).toBeDefined();
      expect(res.body.lock.workflowId).toBe(workflowId);
      expect(res.body.lock.userId).toBe(editor.id);
      expect(res.body.lock.userName).toBe('editor');
      expect(res.body.lock.ttlRemainingMs).toBeGreaterThan(0);
    });

    it('prevents another user from acquiring lock when one is held', async () => {
      // Editor acquires lock
      await request
        .post(`/api/v1/locks/workflows/${workflowId}/acquire`)
        .set(authHeader(editor.token))
        .set('x-workspace-id', workspaceId)
        .send({ ttlSeconds: 30 });

      // Admin tries to acquire lock - should get conflict
      const res = await request
        .post(`/api/v1/locks/workflows/${workflowId}/acquire`)
        .set(authHeader(admin.token))
        .set('x-workspace-id', workspaceId)
        .send({ ttlSeconds: 30 });

      expect(res.status).toBe(409);
      expect(res.body.acquired).toBe(false);
      expect(res.body.conflict).toBeDefined();
      expect(res.body.conflict.userId).toBe(editor.id);
    });

    it('allows same user to refresh lock via heartbeat', async () => {
      // Editor acquires lock
      const acquireRes = await request
        .post(`/api/v1/locks/workflows/${workflowId}/acquire`)
        .set(authHeader(editor.token))
        .set('x-workspace-id', workspaceId)
        .send({ ttlSeconds: 10 });

      expect(acquireRes.status).toBe(200);
      const lockToken = acquireRes.body.lock.lockToken;

      // Small delay then send heartbeat
      await new Promise(resolve => setTimeout(resolve, 50));

      const heartbeatRes = await request
        .put(`/api/v1/locks/workflows/${workflowId}/heartbeat`)
        .set(authHeader(editor.token))
        .set('x-workspace-id', workspaceId)
        .send({ lockToken, ttlSeconds: 10 });

      expect(heartbeatRes.status).toBe(200);
      expect(heartbeatRes.body.acquired).toBe(true);
      expect(heartbeatRes.body.lock.ttlRemainingMs).toBeGreaterThan(0);
    });

    it('allows lock owner to release lock', async () => {
      // Editor acquires lock
      const acquireRes = await request
        .post(`/api/v1/locks/workflows/${workflowId}/acquire`)
        .set(authHeader(editor.token))
        .set('x-workspace-id', workspaceId)
        .send({ ttlSeconds: 30 });

      expect(acquireRes.status).toBe(200);
      const lockToken = acquireRes.body.lock.lockToken;

      // Editor releases lock
      const releaseRes = await request
        .delete(`/api/v1/locks/workflows/${workflowId}/release`)
        .set(authHeader(editor.token))
        .set('x-workspace-id', workspaceId)
        .send({ lockToken });

      expect(releaseRes.status).toBe(204);

      // Verify lock is gone
      const getRes = await request
        .get(`/api/v1/locks/workflows/${workflowId}`)
        .set(authHeader(editor.token))
        .set('x-workspace-id', workspaceId);

      expect(getRes.status).toBe(404);
    });

    it('allows admin to force release lock', async () => {
      // Editor acquires lock
      const acquireRes = await request
        .post(`/api/v1/locks/workflows/${workflowId}/acquire`)
        .set(authHeader(editor.token))
        .set('x-workspace-id', workspaceId)
        .send({ ttlSeconds: 30 });

      expect(acquireRes.status).toBe(200);

      // Admin force releases lock (without lock token)
      const releaseRes = await request
        .delete(`/api/v1/locks/workflows/${workflowId}/release`)
        .set(authHeader(admin.token))
        .set('x-workspace-id', workspaceId)
        .send({ force: true });

      expect(releaseRes.status).toBe(204);

      // Verify lock is gone
      const getRes = await request
        .get(`/api/v1/locks/workflows/${workflowId}`)
        .set(authHeader(editor.token))
        .set('x-workspace-id', workspaceId);

      expect(getRes.status).toBe(404);
    });

    it('prevents non-owner from releasing lock without force', async () => {
      // Editor acquires lock
      const acquireRes = await request
        .post(`/api/v1/locks/workflows/${workflowId}/acquire`)
        .set(authHeader(editor.token))
        .set('x-workspace-id', workspaceId)
        .send({ ttlSeconds: 30 });

      expect(acquireRes.status).toBe(200);
      const lockToken = acquireRes.body.lock.lockToken;

      // Admin tries to release lock without force - should fail
      const releaseRes = await request
        .delete(`/api/v1/locks/workflows/${workflowId}/release`)
        .set(authHeader(admin.token))
        .set('x-workspace-id', workspaceId)
        .send({ lockToken });

      expect(releaseRes.status).toBe(403); // PERMISSION_DENIED from service

      // Verify lock still exists
      const getRes = await request
        .get(`/api/v1/locks/workflows/${workflowId}`)
        .set(authHeader(editor.token))
        .set('x-workspace-id', workspaceId);

      expect(getRes.status).toBe(200);
      expect(getRes.body.userId).toBe(editor.id);
    });

    it('handles lock expiration automatically', async () => {
      // Editor acquires lock with short TTL
      const acquireRes = await request
        .post(`/api/v1/locks/workflows/${workflowId}/acquire`)
        .set(authHeader(editor.token))
        .set('x-workspace-id', workspaceId)
        .send({ ttlSeconds: 1 });

      expect(acquireRes.status).toBe(200);

      // Wait for lock to expire (TTL is 1 second, wait 1.5 seconds)
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Verify lock is gone before trying to acquire again
      let getRes = await request
        .get(`/api/v1/locks/workflows/${workflowId}`)
        .set(authHeader(editor.token))
        .set('x-workspace-id', workspaceId);

      expect(getRes.status).toBe(404);

      // Now admin should be able to acquire lock
      const acquireRes2 = await request
        .post(`/api/v1/locks/workflows/${workflowId}/acquire`)
        .set(authHeader(admin.token))
        .set('x-workspace-id', workspaceId)
        .send({ ttlSeconds: 30 });

      expect(acquireRes2.status).toBe(200);
      expect(acquireRes2.body.acquired).toBe(true);
      expect(acquireRes2.body.lock.userId).toBe(admin.id);
    });

    it('returns lock info when getting current lock', async () => {
      // No lock initially
      let getRes = await request
        .get(`/api/v1/locks/workflows/${workflowId}`)
        .set(authHeader(editor.token))
        .set('x-workspace-id', workspaceId);

      expect(getRes.status).toBe(404);

      // Editor acquires lock
      const acquireRes = await request
        .post(`/api/v1/locks/workflows/${workflowId}/acquire`)
        .set(authHeader(editor.token))
        .set('x-workspace-id', workspaceId)
        .send({ ttlSeconds: 30 });

      expect(acquireRes.status).toBe(200);

      // Get lock info
      getRes = await request
        .get(`/api/v1/locks/workflows/${workflowId}`)
        .set(authHeader(editor.token))
        .set('x-workspace-id', workspaceId);

      expect(getRes.status).toBe(200);
      expect(getRes.body.workflowId).toBe(workflowId);
      expect(getRes.body.userId).toBe(editor.id);
      expect(getRes.body.isOwner).toBe(true);
    });

    it('hides lock information from users without workspace access', async () => {
      // Editor acquires lock
      await request
        .post(`/api/v1/locks/workflows/${workflowId}/acquire`)
        .set(authHeader(editor.token))
        .set('x-workspace-id', workspaceId)
        .send({ ttlSeconds: 30 });

      // Outsider tries to get lock - should get 404 to hide existence
      const res = await request
        .get(`/api/v1/locks/workflows/${workflowId}`)
        .set(authHeader(outsider.token))
        .set('x-workspace-id', workspaceId);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('WORKFLOW_NOT_FOUND');
    });
  });
});