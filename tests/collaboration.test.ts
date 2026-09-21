import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
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
  email: string;
  token: string;
}

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function validDefinition(message = 'collab') {
  return {
    nodes: [
      { id: 'trigger', type: 'webhook', config: {} },
      { id: 'log', type: 'log', config: { message } },
    ],
    edges: [{ source: 'trigger', target: 'log' }],
  } satisfies WorkflowDefinition;
}

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

async function createUser(email: string): Promise<Session> {
  const user = await UserModel.create({ email, passwordHash: 'not-used' });
  const id = user._id.toString();
  return { id, email, token: signAccessToken(authConfig, { userId: id, email }) };
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

let owner: Session;
let admin: Session;
let editor: Session;
let viewer: Session;
let outsider: Session;
let workspaceId: string;
let workflowId: string;

beforeEach(async () => {
  await AuditLogModel.deleteMany({});
  await WorkflowExecutionModel.deleteMany({});
  await WorkflowVersionModel.deleteMany({});
  await WorkflowModel.deleteMany({});
  await WorkspaceMemberModel.deleteMany({});
  await WorkspaceModel.deleteMany({});
  await RefreshTokenModel.deleteMany({});
  await UserModel.deleteMany({});

  owner = await createUser('owner@collab.test');
  admin = await createUser('admin@collab.test');
  editor = await createUser('editor@collab.test');
  viewer = await createUser('viewer@collab.test');
  outsider = await createUser('outsider@collab.test');

  const workspace = await WorkspaceModel.create({
    name: 'Shared',
    slug: `shared-${new Types.ObjectId().toString()}`,
    ownerId: new Types.ObjectId(owner.id),
    status: 'ACTIVE',
  });
  workspaceId = workspace._id.toString();
  await addMember(workspaceId, owner.id, 'OWNER');
  await addMember(workspaceId, admin.id, 'ADMIN');
  await addMember(workspaceId, editor.id, 'EDITOR');
  await addMember(workspaceId, viewer.id, 'VIEWER');

  const workflow = await WorkflowModel.create({
    name: 'Shared workflow',
    draftDefinition: validDefinition(),
    status: 'PUBLISHED',
    latestVersionNumber: 1,
    ownerId: new Types.ObjectId(owner.id),
    createdBy: new Types.ObjectId(owner.id),
    workspaceId: new Types.ObjectId(workspaceId),
  });
  workflowId = workflow._id.toString();
});

function transferPath(id = workflowId): string {
  return `/api/workflows/${id}/transfer`;
}

describe('Phase 3C workflow collaboration', () => {
  describe('ownership transfer', () => {
    it('moves workspace ownership to the target member', async () => {
      const res = await request
        .post(transferPath())
        .set(authHeader(owner.token))
        .send({ userId: editor.id });
      expect(res.status).toBe(200);
      expect(res.body.previousOwnerId).toBe(owner.id);
      expect(res.body.newOwnerId).toBe(editor.id);
      expect(res.body.previousOwnerRole).toBe('EDITOR');
      expect(res.body.newOwnerRole).toBe('OWNER');

      const workspace = await WorkspaceModel.findById(workspaceId);
      expect(workspace?.ownerId.toString()).toBe(editor.id);

      const workflow = await WorkflowModel.findById(workflowId);
      expect(workflow?.ownerId.toString()).toBe(editor.id);
      expect(workflow?.createdBy?.toString()).toBe(owner.id);

      const oldOwner = await WorkspaceMemberModel.findOne({
        workspaceId: new Types.ObjectId(workspaceId),
        userId: new Types.ObjectId(owner.id),
      });
      expect(oldOwner?.role).toBe('EDITOR');
      expect(oldOwner?.permissions).toEqual(permissionsForRole('EDITOR'));

      const newOwner = await WorkspaceMemberModel.findOne({
        workspaceId: new Types.ObjectId(workspaceId),
        userId: new Types.ObjectId(editor.id),
      });
      expect(newOwner?.role).toBe('OWNER');
      expect(newOwner?.permissions).toEqual(permissionsForRole('OWNER'));

      const owners = await WorkspaceMemberModel.countDocuments({
        workspaceId: new Types.ObjectId(workspaceId),
        role: 'OWNER',
      });
      expect(owners).toBe(1);

      const audit = await AuditLogModel.findOne({ action: 'WORKFLOW_TRANSFERRED' });
      expect(audit?.workspaceId?.toString()).toBe(workspaceId);
      expect(audit?.resourceId).toBe(workflowId);
    });

    it('retries a transient database lock failure without losing a write', async () => {
      const transient = Object.assign(
        new Error("Unable to acquire IX lock on '{Collection : test.workspaces}' within 5ms. opId: 1, op: conn1, connId: 1."),
        { name: 'MongoServerError', errorLabels: ['TransientTransactionError'] },
      );
      const workspaceWrite = vi
        .spyOn(WorkspaceModel, 'updateOne')
        .mockImplementationOnce(() => { throw transient; });

      const res = await request
        .post(transferPath())
        .set(authHeader(owner.token))
        .send({ userId: editor.id });

      expect(res.status).toBe(200);
      expect(res.body.previousOwnerId).toBe(owner.id);
      expect(res.body.newOwnerId).toBe(editor.id);
      expect(workspaceWrite).toHaveBeenCalledTimes(2);
      workspaceWrite.mockRestore();

      const previousOwner = await WorkspaceMemberModel.findOne({
        workspaceId: new Types.ObjectId(workspaceId),
        userId: new Types.ObjectId(owner.id),
      });
      expect(previousOwner?.role).toBe('EDITOR');
      expect(previousOwner?.permissions).toEqual(permissionsForRole('EDITOR'));

      const newOwner = await WorkspaceMemberModel.findOne({
        workspaceId: new Types.ObjectId(workspaceId),
        userId: new Types.ObjectId(editor.id),
      });
      expect(newOwner?.role).toBe('OWNER');
      expect(newOwner?.permissions).toEqual(permissionsForRole('OWNER'));

      const owners = await WorkspaceMemberModel.countDocuments({
        workspaceId: new Types.ObjectId(workspaceId),
        role: 'OWNER',
      });
      expect(owners).toBe(1);

      const workspace = await WorkspaceModel.findById(workspaceId);
      expect(workspace?.ownerId.toString()).toBe(editor.id);

      const workflow = await WorkflowModel.findById(workflowId);
      expect(workflow?.ownerId.toString()).toBe(editor.id);
    });

    it('moves owner-only powers to the new owner', async () => {
      const transfer = await request
        .post(transferPath())
        .set(authHeader(owner.token))
        .send({ userId: editor.id });
      expect(transfer.status).toBe(200);

      const oldOwnerRename = await request
        .patch(`/api/workspaces/${workspaceId}`)
        .set(authHeader(owner.token))
        .send({ name: 'Old owner rename' });
      expect(oldOwnerRename.status).toBe(403);

      const newOwnerRename = await request
        .patch(`/api/workspaces/${workspaceId}`)
        .set(authHeader(editor.token))
        .send({ name: 'New owner rename' });
      expect(newOwnerRename.status).toBe(200);
      expect(newOwnerRename.body.name).toBe('New owner rename');

      const previousOwnerRead = await request
        .get(`/api/workflows/${workflowId}`)
        .set(authHeader(owner.token));
      expect(previousOwnerRead.status).toBe(200);

      const transferBack = await request
        .post(transferPath())
        .set(authHeader(editor.token))
        .send({ memberId: owner.id });
      expect(transferBack.status).toBe(200);
      expect(transferBack.body.newOwnerId).toBe(owner.id);
      expect(transferBack.body.previousOwnerRole).toBe('EDITOR');
    });
  });

  describe('transfer guards', () => {
    it('forbids admins, editors and viewers from transferring', async () => {
      for (const actor of [admin, editor, viewer]) {
        const res = await request
          .post(transferPath())
          .set(authHeader(actor.token))
          .send({ userId: editor.id });
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
    });

    it('hides the workflow from non-members', async () => {
      const res = await request
        .post(transferPath())
        .set(authHeader(outsider.token))
        .send({ userId: outsider.id });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('WORKFLOW_NOT_FOUND');
    });

    it('rejects an invited or unknown transfer target', async () => {
      const invited = await createUser('invited@collab.test');
      await addMember(workspaceId, invited.id, 'EDITOR', 'INVITED');
      const invitedTransfer = await request
        .post(transferPath())
        .set(authHeader(owner.token))
        .send({ userId: invited.id });
      expect(invitedTransfer.status).toBe(400);
      expect(invitedTransfer.body.error.code).toBe('INVALID_TRANSFER_TARGET');

      const stranger = await createUser('stranger@collab.test');
      const strangerTransfer = await request
        .post(transferPath())
        .set(authHeader(owner.token))
        .send({ userId: stranger.id });
      expect(strangerTransfer.status).toBe(404);
      expect(strangerTransfer.body.error.code).toBe('MEMBER_NOT_FOUND');
    });

    it('rejects transferring to the current owner', async () => {
      const res = await request
        .post(transferPath())
        .set(authHeader(owner.token))
        .send({ userId: owner.id });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('OWNER_ROLE_IMMUTABLE');
    });

    it('rejects a transfer without a target', async () => {
      const res = await request.post(transferPath()).set(authHeader(owner.token)).send({});
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_REQUEST');
    });
  });

  describe('workflow sharing inside the workspace', () => {
    it('gives every member role-based access to a shared workflow', async () => {
      const created = await request
        .post('/api/workflows')
        .set(authHeader(editor.token))
        .send({ name: 'Editor workflow', definition: validDefinition('shared'), workspaceId });
      expect(created.status).toBe(201);
      const sharedId = created.body._id as string;

      const ownerRead = await request.get(`/api/workflows/${sharedId}`).set(authHeader(owner.token));
      expect(ownerRead.status).toBe(200);

      const adminRead = await request.get(`/api/workflows/${sharedId}`).set(authHeader(admin.token));
      expect(adminRead.status).toBe(200);

      const viewerRead = await request.get(`/api/workflows/${sharedId}`).set(authHeader(viewer.token));
      expect(viewerRead.status).toBe(200);

      const viewerPublish = await request
        .post(`/api/workflows/${sharedId}/publish`)
        .set(authHeader(viewer.token));
      expect(viewerPublish.status).toBe(403);
      expect(viewerPublish.body.error.code).toBe('FORBIDDEN');

      const outsiderRead = await request.get(`/api/workflows/${sharedId}`).set(authHeader(outsider.token));
      expect(outsiderRead.status).toBe(404);
      expect(outsiderRead.body.error.code).toBe('WORKFLOW_NOT_FOUND');
    });

    it('keeps the workflow owner as immutable audit metadata after edits', async () => {
      const update = await request
        .put(`/api/workflows/${workflowId}/draft`)
        .set(authHeader(editor.token))
        .send({ name: 'Edited by editor' });
      expect(update.status).toBe(200);

      const workflow = await WorkflowModel.findById(workflowId);
      expect(workflow?.ownerId.toString()).toBe(owner.id);
      expect(workflow?.createdBy?.toString()).toBe(owner.id);
      expect(workflow?.name).toBe('Edited by editor');
    });
  });
});
