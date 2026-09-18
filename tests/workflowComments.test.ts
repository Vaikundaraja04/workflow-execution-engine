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

let owner: Session;
let admin: Session;
let editor: Session;
let viewer: Session;
let outsider: Session;
let workspaceId: string;
let workflowId: string;

beforeEach(async () => {
  await AuditLogModel.deleteMany({});
  await WorkflowModel.deleteMany({});
  await WorkspaceMemberModel.deleteMany({});
  await WorkspaceModel.deleteMany({});
  await UserModel.deleteMany({});

  owner = await createUser('owner@comment.test');
  admin = await createUser('admin@comment.test');
  editor = await createUser('editor@comment.test');
  viewer = await createUser('viewer@comment.test');
  outsider = await createUser('outsider@comment.test');

  const workspace = await WorkspaceModel.create({
    name: 'Comment Workspace',
    slug: `comment-ws-${new Types.ObjectId().toString()}`,
    ownerId: new Types.ObjectId(owner.id),
    status: 'ACTIVE',
  });
  workspaceId = workspace._id.toString();

  await addMember(workspaceId, owner.id, 'OWNER');
  await addMember(workspaceId, admin.id, 'ADMIN');
  await addMember(workspaceId, editor.id, 'EDITOR');
  await addMember(workspaceId, viewer.id, 'VIEWER');

  const workflow = await WorkflowModel.create({
    name: 'Commentable Workflow',
    draftDefinition: { nodes: [], edges: [] },
    status: 'DRAFT',
    ownerId: new Types.ObjectId(owner.id),
    createdBy: new Types.ObjectId(owner.id),
    workspaceId: new Types.ObjectId(workspaceId),
  });
  workflowId = workflow._id.toString();
});

describe('Phase 7E Workflow Comments System', () => {
  describe('Comment Service & REST API', () => {
    it('creates a top-level workflow comment via API', async () => {
      const res = await request
        .post('/api/v1/comments')
        .set(authHeader(editor.token))
        .set('x-workspace-id', workspaceId)
        .send({
          workflowId,
          content: 'This workflow looks good, needs error handling.',
          nodeId: 'node-1',
          mentions: ['admin@comment.test'],
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.content).toBe('This workflow looks good, needs error handling.');
      expect(res.body.nodeId).toBe('node-1');
      expect(res.body.authorId).toBe(editor.id);
      expect(res.body.status).toBe('OPEN');
      expect(res.body.mentions).toEqual(['admin@comment.test']);

      // Check audit log
      const audit = await AuditLogModel.findOne({ action: 'COMMENT_CREATED' });
      expect(audit).toBeDefined();
      expect(audit?.userId?.toString()).toBe(editor.id);
      expect(audit?.workspaceId?.toString()).toBe(workspaceId);
    });

    it('creates a threaded reply to an existing comment', async () => {
      // First create a parent comment via API
      const parentRes = await request
        .post('/api/v1/comments')
        .set(authHeader(editor.token))
        .set('x-workspace-id', workspaceId)
        .send({
          workflowId,
          content: 'Root comment',
        });

      expect(parentRes.status).toBe(201);
      const parentId = parentRes.body.id;

      const res = await request
        .post('/api/v1/comments')
        .set(authHeader(admin.token))
        .set('x-workspace-id', workspaceId)
        .send({
          workflowId,
          content: 'Reply to root comment',
          parentCommentId: parentId,
        });

      expect(res.status).toBe(201);
      expect(res.body.parentCommentId).toBe(parentId);
      expect(res.body.authorId).toBe(admin.id);

      // Verify list comments returns correct reply counts
      const listRes = await request
        .get(`/api/v1/comments/workflow/${workflowId}`)
        .set(authHeader(editor.token))
        .set('x-workspace-id', workspaceId);

      expect(listRes.status).toBe(200);
      expect(listRes.body.comments.length).toBe(1);
      expect(listRes.body.comments[0].replyCount).toBe(1);
    });

    it('updates comment content and status (resolve)', async () => {
      // Create a comment via API
      const createRes = await request
        .post('/api/v1/comments')
        .set(authHeader(editor.token))
        .set('x-workspace-id', workspaceId)
        .send({
          workflowId,
          content: 'Original content',
        });

      expect(createRes.status).toBe(201);
      const commentId = createRes.body.id;

      const updateRes = await request
        .put(`/api/v1/comments/${commentId}`)
        .set(authHeader(editor.token))
        .set('x-workspace-id', workspaceId)
        .send({
          content: 'Updated content',
          status: 'RESOLVED',
        });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.content).toBe('Updated content');
      expect(updateRes.body.status).toBe('RESOLVED');
      expect(updateRes.body.isEdited).toBe(true);
      expect(updateRes.body.resolvedBy).toBe(editor.id);
      expect(updateRes.body.resolvedAt).toBeDefined();
    });

    it('prevents non-author from updating comment content', async () => {
      // Create a comment via API
      const createRes = await request
        .post('/api/v1/comments')
        .set(authHeader(editor.token))
        .set('x-workspace-id', workspaceId)
        .send({
          workflowId,
          content: 'Editor content',
        });

      expect(createRes.status).toBe(201);
      const commentId = createRes.body.id;

      const updateRes = await request
        .put(`/api/v1/comments/${commentId}`)
        .set(authHeader(viewer.token))
        .set('x-workspace-id', workspaceId)
        .send({
          content: 'Viewer attempted overwrite',
        });

      expect(updateRes.status).toBe(403);
    });

    it('allows author to delete their comment ONLY if they have MANAGE permission (editor does not)', async () => {
      // Create a comment via API
      const createRes = await request
        .post('/api/v1/comments')
        .set(authHeader(editor.token))
        .set('x-workspace-id', workspaceId)
        .send({
          workflowId,
          content: 'To be deleted',
        });

      expect(createRes.status).toBe(201);
      const commentId = createRes.body.id;

      // Editor attempts to delete their own comment but lacks COLLABORATION_MANAGE
      const delRes = await request
        .delete(`/api/v1/comments/${commentId}`)
        .set(authHeader(editor.token))
        .set('x-workspace-id', workspaceId);

      expect(delRes.status).toBe(403); // FORBIDDEN due to missing MANAGE permission
    });

    it('allows admin to delete any comment in workspace', async () => {
      // Create a comment via API
      const createRes = await request
        .post('/api/v1/comments')
        .set(authHeader(editor.token))
        .set('x-workspace-id', workspaceId)
        .send({
          workflowId,
          content: 'Editor comment deleted by admin',
        });

      expect(createRes.status).toBe(201);
      const commentId = createRes.body.id;

      const delRes = await request
        .delete(`/api/v1/comments/${commentId}`)
        .set(authHeader(admin.token))
        .set('x-workspace-id', workspaceId);

      expect(delRes.status).toBe(204);
    });

    it('forbids viewer without comment permissions from creating comments', async () => {
      const res = await request
        .post('/api/v1/comments')
        .set(authHeader(viewer.token))
        .set('x-workspace-id', workspaceId)
        .send({
          workflowId,
          content: 'Viewer comment attempt',
        });

      expect(res.status).toBe(403);
    });

    it('hides comments for outsider without workspace access', async () => {
      // Create a comment via API
      const createRes = await request
        .post('/api/v1/comments')
        .set(authHeader(editor.token))
        .set('x-workspace-id', workspaceId)
        .send({
          workflowId,
          content: 'Test comment',
        });

      expect(createRes.status).toBe(201);

      const res = await request
        .get(`/api/v1/comments/workflow/${workflowId}`)
        .set(authHeader(outsider.token))
        .set('x-workspace-id', workspaceId);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('WORKFLOW_NOT_FOUND');
    });
  });
});