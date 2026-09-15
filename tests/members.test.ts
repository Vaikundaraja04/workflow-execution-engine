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

function membersPath(id: string): string {
  return `/api/workspaces/${id}/members`;
}

let owner: Session;
let admin: Session;
let editor: Session;
let viewer: Session;
let outsider: Session;
let workspaceId: string;

beforeEach(async () => {
  await AuditLogModel.deleteMany({});
  await WorkflowExecutionModel.deleteMany({});
  await WorkflowVersionModel.deleteMany({});
  await WorkflowModel.deleteMany({});
  await WorkspaceMemberModel.deleteMany({});
  await WorkspaceModel.deleteMany({});
  await RefreshTokenModel.deleteMany({});
  await UserModel.deleteMany({});

  owner = await createUser('owner@members.test');
  admin = await createUser('admin@members.test');
  editor = await createUser('editor@members.test');
  viewer = await createUser('viewer@members.test');
  outsider = await createUser('outsider@members.test');

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
});

function validDefinition(message = 'members') {
  return {
    nodes: [
      { id: 'trigger', type: 'webhook', config: {} },
      { id: 'log', type: 'log', config: { message } },
    ],
    edges: [{ source: 'trigger', target: 'log' }],
  } satisfies WorkflowDefinition;
}

describe('Phase 3C member management', () => {
  describe('invitations', () => {
    it('invites a user by email with the default viewer role', async () => {
      const invited = await createUser('invitee@members.test');
      const res = await request
        .post(`${membersPath(workspaceId)}/invite`)
        .set(authHeader(owner.token))
        .send({ email: invited.email });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('INVITED');
      expect(res.body.role).toBe('VIEWER');
      expect(res.body.userId).toBe(invited.id);

      const beforeAccept = await request
        .get(`/api/workspaces/${workspaceId}`)
        .set(authHeader(invited.token));
      expect(beforeAccept.status).toBe(403);
      expect(beforeAccept.body.error.code).toBe('PERMISSION_DENIED');
    });

    it('invites by userId with an explicit role', async () => {
      const invited = await createUser('byid@members.test');
      const res = await request
        .post(`${membersPath(workspaceId)}/invite`)
        .set(authHeader(admin.token))
        .send({ userId: invited.id, role: 'EDITOR' });
      expect(res.status).toBe(201);
      expect(res.body.role).toBe('EDITOR');
      expect(res.body.invitedBy).toBe(admin.id);
    });

    it('rejects a duplicate invitation', async () => {
      const res = await request
        .post(`${membersPath(workspaceId)}/invite`)
        .set(authHeader(owner.token))
        .send({ email: editor.email });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('MEMBER_ALREADY_EXISTS');
    });

    it('rejects an unknown email and an empty body', async () => {
      const unknown = await request
        .post(`${membersPath(workspaceId)}/invite`)
        .set(authHeader(owner.token))
        .send({ email: 'nobody@members.test' });
      expect(unknown.status).toBe(404);
      expect(unknown.body.error.code).toBe('USER_NOT_FOUND');

      const empty = await request
        .post(`${membersPath(workspaceId)}/invite`)
        .set(authHeader(owner.token))
        .send({});
      expect(empty.status).toBe(400);
      expect(empty.body.error.code).toBe('INVALID_REQUEST');
    });

    it('refuses to invite with the owner role', async () => {
      const invited = await createUser('wouldbeowner@members.test');
      const res = await request
        .post(`${membersPath(workspaceId)}/invite`)
        .set(authHeader(owner.token))
        .send({ userId: invited.id, role: 'OWNER' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('OWNER_ROLE_IMMUTABLE');
    });
  });

  describe('invitation acceptance', () => {
    it('activates the membership when the invited user accepts', async () => {
      const invited = await createUser('joiner@members.test');
      const invite = await request
        .post(`${membersPath(workspaceId)}/invite`)
        .set(authHeader(admin.token))
        .send({ email: invited.email, role: 'EDITOR' });
      expect(invite.status).toBe(201);

      const accept = await request
        .post(`${membersPath(workspaceId)}/accept`)
        .set(authHeader(invited.token));
      expect(accept.status).toBe(200);
      expect(accept.body.status).toBe('ACTIVE');

      const workspace = await request
        .get(`/api/workspaces/${workspaceId}`)
        .set(authHeader(invited.token));
      expect(workspace.status).toBe(200);

      const member = await WorkspaceMemberModel.findOne({
        workspaceId: new Types.ObjectId(workspaceId),
        userId: new Types.ObjectId(invited.id),
      });
      expect(member?.status).toBe('ACTIVE');
      expect(member?.permissions).toEqual(permissionsForRole('EDITOR'));
    });

    it('rejects acceptance without an invitation', async () => {
      const res = await request
        .post(`${membersPath(workspaceId)}/accept`)
        .set(authHeader(outsider.token));
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('INVITATION_NOT_FOUND');
    });

    it('lets a removed member be invited again', async () => {
      const removed = await request
        .delete(`${membersPath(workspaceId)}/${editor.id}`)
        .set(authHeader(owner.token));
      expect(removed.status).toBe(200);
      expect(removed.body.status).toBe('REMOVED');

      const reinvite = await request
        .post(`${membersPath(workspaceId)}/invite`)
        .set(authHeader(owner.token))
        .send({ userId: editor.id, role: 'VIEWER' });
      expect(reinvite.status).toBe(201);
      expect(reinvite.body.status).toBe('INVITED');
      expect(reinvite.body.role).toBe('VIEWER');
    });
  });

  describe('listing', () => {
    it('lists members with roles and emails for owner and admin', async () => {
      const res = await request.get(membersPath(workspaceId)).set(authHeader(admin.token));
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(4);
      expect(res.body.map((member: { role: string }) => member.role).sort())
        .toEqual(['ADMIN', 'EDITOR', 'OWNER', 'VIEWER']);

      const ownerRow = res.body.find((member: { userId: string }) => member.userId === owner.id);
      expect(ownerRow.email).toBe(owner.email);
    });

    it('hides the member list from editors and viewers', async () => {
      const editorList = await request.get(membersPath(workspaceId)).set(authHeader(editor.token));
      expect(editorList.status).toBe(403);
      expect(editorList.body.error.code).toBe('FORBIDDEN');

      const viewerList = await request.get(membersPath(workspaceId)).set(authHeader(viewer.token));
      expect(viewerList.status).toBe(403);
    });

    it('hides the member list from non-members', async () => {
      const res = await request.get(membersPath(workspaceId)).set(authHeader(outsider.token));
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('WORKSPACE_NOT_FOUND');
    });
  });

  describe('role changes', () => {
    it('promotes a viewer to editor and applies the new permissions', async () => {
      const res = await request
        .patch(`${membersPath(workspaceId)}/${viewer.id}`)
        .set(authHeader(owner.token))
        .send({ role: 'EDITOR' });
      expect(res.status).toBe(200);
      expect(res.body.role).toBe('EDITOR');

      const created = await request
        .post('/api/workflows')
        .set(authHeader(viewer.token))
        .send({ name: 'Promoted workflow', definition: validDefinition(), workspaceId });
      expect(created.status).toBe(201);
    });

    it('lets an admin manage another admin', async () => {
      const secondAdmin = await createUser('admin2@members.test');
      await addMember(workspaceId, secondAdmin.id, 'ADMIN');

      const res = await request
        .patch(`${membersPath(workspaceId)}/${secondAdmin.id}`)
        .set(authHeader(admin.token))
        .send({ role: 'EDITOR' });
      expect(res.status).toBe(200);
      expect(res.body.role).toBe('EDITOR');
    });

    it('forbids an admin from changing the owner', async () => {
      const res = await request
        .patch(`${membersPath(workspaceId)}/${owner.id}`)
        .set(authHeader(admin.token))
        .send({ role: 'VIEWER' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('refuses to assign the owner role', async () => {
      const res = await request
        .patch(`${membersPath(workspaceId)}/${editor.id}`)
        .set(authHeader(owner.token))
        .send({ role: 'OWNER' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('OWNER_ROLE_IMMUTABLE');
    });

    it('refuses to demote the owner through the member API', async () => {
      const res = await request
        .patch(`${membersPath(workspaceId)}/${owner.id}`)
        .set(authHeader(owner.token))
        .send({ role: 'ADMIN' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('OWNER_ROLE_IMMUTABLE');
    });

    it('returns 404 for an unknown member reference', async () => {
      const res = await request
        .patch(`${membersPath(workspaceId)}/${new Types.ObjectId().toString()}`)
        .set(authHeader(owner.token))
        .send({ role: 'VIEWER' });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('MEMBER_NOT_FOUND');
    });

    it('scopes member references to the workspace', async () => {
      const own = await WorkspaceModel.create({
        name: 'Own',
        slug: `own-${new Types.ObjectId().toString()}`,
        ownerId: new Types.ObjectId(outsider.id),
        status: 'ACTIVE',
      });
      await addMember(own._id.toString(), outsider.id, 'OWNER');

      const res = await request
        .patch(`${membersPath(own._id.toString())}/${editor.id}`)
        .set(authHeader(outsider.token))
        .send({ role: 'VIEWER' });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('MEMBER_NOT_FOUND');
    });
  });

  describe('removal', () => {
    it('removes an editor and revokes access immediately', async () => {
      const res = await request
        .delete(`${membersPath(workspaceId)}/${editor.id}`)
        .set(authHeader(owner.token));
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('REMOVED');

      const workspaceRead = await request
        .get(`/api/workspaces/${workspaceId}`)
        .set(authHeader(editor.token));
      expect(workspaceRead.status).toBe(404);

      const create = await request
        .post('/api/workflows')
        .set(authHeader(editor.token))
        .send({ name: 'After removal', definition: validDefinition(), workspaceId });
      expect(create.status).toBe(404);
      expect(create.body.error.code).toBe('WORKSPACE_NOT_FOUND');
    });

    it('lets an admin remove a viewer', async () => {
      const res = await request
        .delete(`${membersPath(workspaceId)}/${viewer.id}`)
        .set(authHeader(admin.token));
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('REMOVED');
    });

    it('forbids removing the workspace owner', async () => {
      const adminAttempt = await request
        .delete(`${membersPath(workspaceId)}/${owner.id}`)
        .set(authHeader(admin.token));
      expect(adminAttempt.status).toBe(403);
      expect(adminAttempt.body.error.code).toBe('FORBIDDEN');

      const ownerAttempt = await request
        .delete(`${membersPath(workspaceId)}/${owner.id}`)
        .set(authHeader(owner.token));
      expect(ownerAttempt.status).toBe(409);
      expect(ownerAttempt.body.error.code).toBe('OWNER_ROLE_IMMUTABLE');
    });

    it('hides member removal from editors', async () => {
      const res = await request
        .delete(`${membersPath(workspaceId)}/${viewer.id}`)
        .set(authHeader(editor.token));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });
});
