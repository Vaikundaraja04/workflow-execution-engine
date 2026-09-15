import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createApp } from '../src/api/app.js';
import { UserModel } from '../src/models/UserModel.js';
import { WorkspaceModel } from '../src/models/WorkspaceModel.js';
import { WorkspaceMemberModel } from '../src/models/WorkspaceMemberModel.js';
import { WorkflowModel } from '../src/models/WorkflowModel.js';
import { WorkflowExecutionModel } from '../src/models/WorkflowExecutionModel.js';
import { APIKeyModel } from '../src/models/APIKeyModel.js';
import { WebhookModel } from '../src/models/WebhookModel.js';
import { WebhookDeliveryModel } from '../src/models/WebhookDeliveryModel.js';
import { DeadLetterModel } from '../src/models/DeadLetterModel.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';
import { WorkspaceUsageModel } from '../src/models/WorkspaceUsageModel.js';
import { hashPassword } from '../src/auth/password.service.js';
import { signAccessToken } from '../src/auth/jwt.service.js';
import type { AuthConfig } from '../src/auth/jwt.service.js';
import { permissionsForRole } from '../src/auth/permissions.js';

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;

const authConfig: AuthConfig = {
  jwtSecret: 'test-secret-key-for-admin-platform-tests-5a',
  accessTtl: '15m',
  refreshTtl: '7d',
};

// Test users and tokens
let ownerUser: any;
let adminUser: any;
let editorUser: any;
let viewerUser: any;
let foreignUser: any;

let ownerToken: string;
let adminToken: string;
let editorToken: string;
let viewerToken: string;
let foreignToken: string;

let workspaceA: any;
let workspaceAId: string;
let workspaceB: any;
let workspaceBId: string;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());

  const app = createApp({
    auth: authConfig,
    docs: true,
    health: {
      checks: {
        mongo: async () => ({ status: 'up', latencyMs: 1 }),
        redis: async () => ({ status: 'skipped', latencyMs: 0 }),
        worker: async () => ({ status: 'skipped', latencyMs: 0 }),
      },
    },
  });
  request = supertest(app);
});

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

beforeEach(async () => {
  await UserModel.deleteMany({});
  await WorkspaceModel.deleteMany({});
  await WorkspaceMemberModel.deleteMany({});
  await WorkflowModel.deleteMany({});
  await WorkflowExecutionModel.deleteMany({});
  await APIKeyModel.deleteMany({});
  await WebhookModel.deleteMany({});
  await WebhookDeliveryModel.deleteMany({});
  await DeadLetterModel.deleteMany({});
  await AuditLogModel.deleteMany({});
  await WorkspaceUsageModel.deleteMany({});

  const hashedPassword = await hashPassword('TestPassword123!');

  // Create users
  ownerUser = await UserModel.create({
    email: 'owner@example.com',
    passwordHash: hashedPassword,
  });
  adminUser = await UserModel.create({
    email: 'admin@example.com',
    passwordHash: hashedPassword,
  });
  editorUser = await UserModel.create({
    email: 'editor@example.com',
    passwordHash: hashedPassword,
  });
  viewerUser = await UserModel.create({
    email: 'viewer@example.com',
    passwordHash: hashedPassword,
  });
  foreignUser = await UserModel.create({
    email: 'foreign@example.com',
    passwordHash: hashedPassword,
  });

  // Create Workspace A
  workspaceA = await WorkspaceModel.create({
    name: 'Workspace Alpha',
    slug: 'workspace-alpha',
    ownerId: ownerUser._id,
    status: 'ACTIVE',
  });
  workspaceAId = workspaceA._id.toString();

  // Create memberships for Workspace A
  await WorkspaceMemberModel.create([
    {
      workspaceId: workspaceA._id,
      userId: ownerUser._id,
      role: 'OWNER',
      permissions: permissionsForRole('OWNER'),
      status: 'ACTIVE',
    },
    {
      workspaceId: workspaceA._id,
      userId: adminUser._id,
      role: 'ADMIN',
      permissions: permissionsForRole('ADMIN'),
      status: 'ACTIVE',
    },
    {
      workspaceId: workspaceA._id,
      userId: editorUser._id,
      role: 'EDITOR',
      permissions: permissionsForRole('EDITOR'),
      status: 'ACTIVE',
    },
    {
      workspaceId: workspaceA._id,
      userId: viewerUser._id,
      role: 'VIEWER',
      permissions: permissionsForRole('VIEWER'),
      status: 'ACTIVE',
    },
  ]);

  // Create Workspace B (owned by foreign user)
  workspaceB = await WorkspaceModel.create({
    name: 'Workspace Beta',
    slug: 'workspace-beta',
    ownerId: foreignUser._id,
    status: 'ACTIVE',
  });
  workspaceBId = workspaceB._id.toString();

  await WorkspaceMemberModel.create({
    workspaceId: workspaceB._id,
    userId: foreignUser._id,
    role: 'OWNER',
    permissions: permissionsForRole('OWNER'),
    status: 'ACTIVE',
  });

  // Generate JWTs
  ownerToken = signAccessToken(authConfig, { userId: ownerUser._id.toString(), email: ownerUser.email });
  adminToken = signAccessToken(authConfig, { userId: adminUser._id.toString(), email: adminUser.email });
  editorToken = signAccessToken(authConfig, { userId: editorUser._id.toString(), email: editorUser.email });
  viewerToken = signAccessToken(authConfig, { userId: viewerUser._id.toString(), email: viewerUser.email });
  foreignToken = signAccessToken(authConfig, { userId: foreignUser._id.toString(), email: foreignUser.email });
});

describe('PHASE 5A — Enterprise Operations Platform', () => {
  // =========================================================================
  // 1. Audit Explorer API
  // =========================================================================
  describe('1. Audit Explorer API', () => {
    beforeEach(async () => {
      // Seed audit logs for Workspace A
      await AuditLogModel.create([
        {
          userId: ownerUser._id,
          workspaceId: workspaceA._id,
          action: 'WORKFLOW_CREATED',
          resource: 'workflow',
          resourceId: 'wf-101',
          metadata: { name: 'Order Processing' },
          ipAddress: '192.168.1.10',
          createdAt: new Date('2026-09-01T10:00:00.000Z'),
        },
        {
          userId: adminUser._id,
          workspaceId: workspaceA._id,
          action: 'WORKSPACE_MEMBER_INVITED',
          resource: 'member',
          resourceId: 'user-202',
          metadata: { email: 'newmember@example.com', role: 'EDITOR' },
          ipAddress: '192.168.1.20',
          createdAt: new Date('2026-09-02T11:00:00.000Z'),
        },
        {
          userId: ownerUser._id,
          workspaceId: workspaceA._id,
          action: 'API_KEY_CREATED',
          resource: 'api_key',
          resourceId: 'key-303',
          metadata: { name: 'Production Trigger Key' },
          ipAddress: '192.168.1.10',
          createdAt: new Date('2026-09-03T12:00:00.000Z'),
        },
        {
          userId: ownerUser._id,
          workspaceId: workspaceA._id,
          action: 'AUTH_LOGIN_FAILED',
          resource: 'auth',
          ipAddress: '198.51.100.1',
          createdAt: new Date('2026-09-04T13:00:00.000Z'),
        },
      ]);

      // Seed audit log for Workspace B (for workspace isolation checks)
      await AuditLogModel.create({
        userId: foreignUser._id,
        workspaceId: workspaceB._id,
        action: 'WORKFLOW_CREATED',
        resource: 'workflow',
        resourceId: 'wf-999-secret',
        metadata: { name: 'Workspace B Secret' },
        createdAt: new Date('2026-09-01T10:00:00.000Z'),
      });
    });

    it('GET /api/v1/audit - queries audit logs with default pagination and sorting', async () => {
      const response = await request
        .get('/api/v1/audit')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);

      expect(response.body).toHaveProperty('logs');
      expect(response.body.logs.length).toBe(4);
      expect(response.body.total).toBe(4);
      expect(response.body.limit).toBe(50);
      expect(response.body.offset).toBe(0);
      expect(response.body.hasMore).toBe(false);

      // Default sort is createdAt desc (newest first)
      expect(response.body.logs[0].action).toBe('AUTH_LOGIN_FAILED');
      expect(response.body.logs[3].action).toBe('WORKFLOW_CREATED');
    });

    it('GET /api/v1/audit - supports pagination with limit and offset', async () => {
      const page1 = await request
        .get('/api/v1/audit?limit=2&offset=0')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);

      expect(page1.body.logs.length).toBe(2);
      expect(page1.body.total).toBe(4);
      expect(page1.body.limit).toBe(2);
      expect(page1.body.offset).toBe(0);
      expect(page1.body.hasMore).toBe(true);

      const page2 = await request
        .get('/api/v1/audit?limit=2&offset=2')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);

      expect(page2.body.logs.length).toBe(2);
      expect(page2.body.offset).toBe(2);
      expect(page2.body.hasMore).toBe(false);

      // Verify no overlap
      const page1Ids = page1.body.logs.map((l: any) => l.id);
      const page2Ids = page2.body.logs.map((l: any) => l.id);
      expect(page1Ids.some((id: string) => page2Ids.includes(id))).toBe(false);
    });

    it('GET /api/v1/audit - supports filtering by action, resource, ipAddress, and date range', async () => {
      // Filter by action
      const actionRes = await request
        .get('/api/v1/audit?action=API_KEY_CREATED')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);
      expect(actionRes.body.logs.length).toBe(1);
      expect(actionRes.body.logs[0].action).toBe('API_KEY_CREATED');

      // Filter by resource
      const resourceRes = await request
        .get('/api/v1/audit?resource=workflow')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);
      expect(resourceRes.body.logs.length).toBe(1);
      expect(resourceRes.body.logs[0].resource).toBe('workflow');

      // Filter by ipAddress
      const ipRes = await request
        .get('/api/v1/audit?ipAddress=198.51.100.1')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);
      expect(ipRes.body.logs.length).toBe(1);
      expect(ipRes.body.logs[0].ipAddress).toBe('198.51.100.1');

      // Filter by date range
      const dateRes = await request
        .get('/api/v1/audit?startDate=2026-09-01T00:00:00.000Z&endDate=2026-09-02T23:59:59.999Z')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);
      expect(dateRes.body.logs.length).toBe(2);
    });

    it('GET /api/v1/audit - enforces workspace isolation strictly', async () => {
      // Owner of Workspace A queries Workspace A
      const resA = await request
        .get('/api/v1/audit')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);

      // Verify no Workspace B logs appear in Workspace A
      const hasWorkspaceBLog = resA.body.logs.some((l: any) => l.resourceId === 'wf-999-secret');
      expect(hasWorkspaceBLog).toBe(false);

      // Foreign user queries Workspace B
      const resB = await request
        .get('/api/v1/audit')
        .set('Authorization', `Bearer ${foreignToken}`)
        .set('x-workspace-id', workspaceBId)
        .expect(200);

      expect(resB.body.logs.length).toBe(1);
      expect(resB.body.logs[0].resourceId).toBe('wf-999-secret');

      // Foreign user attempts to query Workspace A -> 404/403
      await request
        .get('/api/v1/audit')
        .set('Authorization', `Bearer ${foreignToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(404);
    });

    it('GET /api/v1/audit/actions - returns supported audit actions list', async () => {
      const response = await request
        .get('/api/v1/audit/actions')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);

      expect(response.body).toHaveProperty('actions');
      expect(Array.isArray(response.body.actions)).toBe(true);
      expect(response.body.actions).toContain('WORKFLOW_CREATED');
      expect(response.body.actions).toContain('API_KEY_CREATED');
      expect(response.body.actions).toContain('WORKSPACE_MEMBER_INVITED');
    });

    it('GET /api/v1/audit/summary - returns aggregate metrics for workspace audit events', async () => {
      const response = await request
        .get('/api/v1/audit/summary')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);

      expect(response.body).toHaveProperty('workspaceId', workspaceAId);
      expect(response.body).toHaveProperty('totalEvents', 4);
      expect(response.body).toHaveProperty('eventsByAction');
      expect(response.body.eventsByAction.WORKFLOW_CREATED).toBe(1);
      expect(response.body.eventsByAction.AUTH_LOGIN_FAILED).toBe(1);
      expect(response.body).toHaveProperty('securityEventsCount');
      expect(response.body.securityEventsCount).toBeGreaterThanOrEqual(1);
    });

    it('GET /api/v1/audit/:id - gets single audit log by ID and checks workspace isolation', async () => {
      const listRes = await request
        .get('/api/v1/audit')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);

      const logId = listRes.body.logs[0].id;

      const singleRes = await request
        .get(`/api/v1/audit/${logId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);

      expect(singleRes.body.id).toBe(logId);
      expect(singleRes.body.workspaceId).toBe(workspaceAId);

      // Non-existent ID returns 404
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request
        .get(`/api/v1/audit/${fakeId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(404);
    });

    it('RBAC: AUDIT_READ permission matrix', async () => {
      // OWNER has AUDIT_READ -> 200
      await request
        .get('/api/v1/audit')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);

      // ADMIN has AUDIT_READ -> 200
      await request
        .get('/api/v1/audit')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);

      // EDITOR lacks AUDIT_READ -> 403 FORBIDDEN
      const editorRes = await request
        .get('/api/v1/audit')
        .set('Authorization', `Bearer ${editorToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(403);
      expect(editorRes.body.error.code).toBe('FORBIDDEN');

      // VIEWER lacks AUDIT_READ -> 403 FORBIDDEN
      const viewerRes = await request
        .get('/api/v1/audit')
        .set('Authorization', `Bearer ${viewerToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(403);
      expect(viewerRes.body.error.code).toBe('FORBIDDEN');
    });
  });

  // =========================================================================
  // 2. Workspace Administration API
  // =========================================================================
  describe('2. Workspace Administration API', () => {
    beforeEach(async () => {
      // Add workflows and executions in Workspace A
      const wf1 = await WorkflowModel.create({
        name: 'Alpha Workflow',
        ownerId: ownerUser._id,
        workspaceId: workspaceA._id,
        createdBy: ownerUser._id,
        draftDefinition: { nodes: [], edges: [] },
        status: 'PUBLISHED',
        latestVersionNumber: 1,
      });

      await WorkflowExecutionModel.create({
        workflowId: wf1._id,
        workflowVersionId: new mongoose.Types.ObjectId(),
        workspaceId: workspaceA._id,
        ownerId: ownerUser._id,
        status: 'SUCCEEDED',
        startedAt: new Date(Date.now() - 5000),
        finishedAt: new Date(),
        attemptsMade: 1,
        input: {},
        inputHash: 'dummy_hash',
        idempotencyKey: 'dummy_idempotency_key',
        jobId: 'dummy_job_id',
        versionNumber: 1,
      });

      await APIKeyModel.create({
        workspaceId: workspaceA._id,
        createdBy: ownerUser._id,
        name: 'Test Key',
        keyHash: 'secret_hash_1234',
        keyPrefix: 'wke_1234',
        status: 'ACTIVE',
        permissions: ['WORKFLOW_READ'],
      });
    });

    it('GET /api/v1/admin/workspaces - lists workspaces user administers with stats', async () => {
      const response = await request
        .get('/api/v1/admin/workspaces')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(1);
      expect(response.body[0]).toHaveProperty('id', workspaceAId);
      expect(response.body[0]).toHaveProperty('memberCount', 4);
      expect(response.body[0]).toHaveProperty('workflowCount', 1);
      expect(response.body[0]).toHaveProperty('role', 'OWNER');
    });

    it('GET /api/v1/admin/workspaces/:workspaceId - gets workspace administrative detail', async () => {
      const response = await request
        .get(`/api/v1/admin/workspaces/${workspaceAId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('id', workspaceAId);
      expect(response.body).toHaveProperty('status', 'ACTIVE');
      expect(response.body).toHaveProperty('memberCount', 4);
      expect(response.body.membersByRole).toEqual({
        owner: 1,
        admin: 1,
        editor: 1,
        viewer: 1,
      });
      expect(response.body).toHaveProperty('workflowCount', 1);
      expect(response.body).toHaveProperty('executionCount', 1);
      expect(response.body).toHaveProperty('apiKeyCount', 1);
      expect(response.body).toHaveProperty('storageUsedBytes');
    });

    it('POST /api/v1/admin/workspaces/:workspaceId/suspend - owner can suspend workspace, creating audit log', async () => {
      const response = await request
        .post(`/api/v1/admin/workspaces/${workspaceAId}/suspend`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(response.body.status).toBe('SUSPENDED');

      // Verify DB status
      const updated = await WorkspaceModel.findById(workspaceAId);
      expect(updated?.status).toBe('SUSPENDED');

      // Verify audit log was written
      const audit = await AuditLogModel.findOne({
        workspaceId: workspaceA._id,
        action: 'WORKSPACE_UPDATED',
        'metadata.change': 'suspend',
      });
      expect(audit).toBeDefined();
      expect(audit?.userId?.toString()).toBe(ownerUser._id.toString());
    });

    it('POST /api/v1/admin/workspaces/:workspaceId/unsuspend - owner can unsuspend workspace', async () => {
      // Suspend first
      await request
        .post(`/api/v1/admin/workspaces/${workspaceAId}/suspend`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      // Unsuspend
      const response = await request
        .post(`/api/v1/admin/workspaces/${workspaceAId}/unsuspend`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(response.body.status).toBe('ACTIVE');

      const updated = await WorkspaceModel.findById(workspaceAId);
      expect(updated?.status).toBe('ACTIVE');
    });

    it('DELETE /api/v1/admin/workspaces/:workspaceId - owner can soft delete workspace', async () => {
      const response = await request
        .delete(`/api/v1/admin/workspaces/${workspaceAId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(response.body.status).toBe('DELETED');

      const updated = await WorkspaceModel.findById(workspaceAId);
      expect(updated?.status).toBe('DELETED');
    });

    it('RBAC: non-owners cannot suspend or delete workspace', async () => {
      // Admin attempts suspend -> 403 FORBIDDEN
      const adminRes = await request
        .post(`/api/v1/admin/workspaces/${workspaceAId}/suspend`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(403);
      expect(adminRes.body.error.code).toBe('FORBIDDEN');

      // Editor attempts suspend -> 403 FORBIDDEN
      const editorRes = await request
        .post(`/api/v1/admin/workspaces/${workspaceAId}/suspend`)
        .set('Authorization', `Bearer ${editorToken}`)
        .expect(403);
      expect(editorRes.body.error.code).toBe('FORBIDDEN');

      // Admin attempts delete -> 403 FORBIDDEN
      const deleteRes = await request
        .delete(`/api/v1/admin/workspaces/${workspaceAId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(403);
      expect(deleteRes.body.error.code).toBe('FORBIDDEN');
    });
  });

  // =========================================================================
  // 3. Usage & Quota API
  // =========================================================================
  describe('3. Usage & Quota API', () => {
    beforeEach(async () => {
      // Seed workflows
      await WorkflowModel.create([
        {
          name: 'WF 1',
          ownerId: ownerUser._id,
          workspaceId: workspaceA._id,
          draftDefinition: { nodes: [], edges: [] },
          status: 'PUBLISHED',
          latestVersionNumber: 1,
        },
        {
          name: 'WF 2',
          ownerId: ownerUser._id,
          workspaceId: workspaceA._id,
          draftDefinition: { nodes: [], edges: [] },
          status: 'DRAFT',
          latestVersionNumber: 0,
        },
      ]);

      // Seed executions
      await WorkflowExecutionModel.create([
        {
          workflowId: new mongoose.Types.ObjectId(),
          workflowVersionId: new mongoose.Types.ObjectId(),
          workspaceId: workspaceA._id,
          ownerId: ownerUser._id,
          status: 'SUCCEEDED',
          startedAt: new Date(Date.now() - 4000),
          finishedAt: new Date(Date.now() - 2000),
          attemptsMade: 1,
          input: {},
          inputHash: 'hash_exec_1',
          idempotencyKey: 'idem_key_1',
          jobId: 'job_exec_1',
          versionNumber: 1,
        },
        {
          workflowId: new mongoose.Types.ObjectId(),
          workflowVersionId: new mongoose.Types.ObjectId(),
          workspaceId: workspaceA._id,
          ownerId: ownerUser._id,
          status: 'FAILED',
          startedAt: new Date(Date.now() - 3000),
          finishedAt: new Date(Date.now() - 1000),
          attemptsMade: 3,
          input: {},
          inputHash: 'hash_exec_2',
          idempotencyKey: 'idem_key_2',
          jobId: 'job_exec_2',
          versionNumber: 1,
        },
      ]);

      // Seed API key & Webhook
      await APIKeyModel.create({
        workspaceId: workspaceA._id,
        createdBy: ownerUser._id,
        name: 'Key 1',
        keyPrefix: 'wke_aaa',
        keyHash: 'hash',
        status: 'ACTIVE',
        permissions: ['WORKFLOW_READ'],
      });

      await WebhookModel.create({
        workspaceId: workspaceA._id,
        createdBy: ownerUser._id,
        name: 'Webhook 1',
        url: 'https://example.com/hook',
        encryptedSecret: 'sec_123',
        events: ['WORKFLOW_EXECUTION_COMPLETED'],
        status: 'ACTIVE',
      });
    });

    it('GET /api/v1/admin/usage - returns detailed workspace usage metrics', async () => {
      const response = await request
        .get('/api/v1/admin/usage')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);

      expect(response.body).toHaveProperty('workspaceId', workspaceAId);
      expect(response.body.workflows).toEqual({
        total: 2,
        active: 1,
        draft: 1,
        archived: 0,
      });
      expect(response.body.executions).toMatchObject({
        total: 2,
        successful: 1,
        failed: 1,
        successRate: 0.5,
      });
      expect(response.body.members).toMatchObject({
        total: 4,
        active: 4,
        invited: 0,
      });
      expect(response.body.apiKeys).toEqual({
        total: 1,
        active: 1,
        revoked: 0,
      });
      expect(response.body.webhooks).toEqual({
        total: 1,
        active: 1,
        disabled: 0,
      });
      expect(response.body.storage).toHaveProperty('totalBytes');
      expect(response.body.storage).toHaveProperty('formatted');
    });

    it('GET /api/v1/admin/quotas - calculates quota utilization and warnings', async () => {
      const response = await request
        .get('/api/v1/admin/quotas')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);

      expect(response.body).toHaveProperty('workspaceId', workspaceAId);
      expect(response.body).toHaveProperty('quotas');
      expect(response.body.quotas).toHaveProperty('workflows');
      expect(response.body.quotas.workflows).toEqual({
        limit: 100,
        current: 2,
        usedPercentage: 2,
        status: 'OK',
      });
      expect(response.body.quotas).toHaveProperty('monthlyExecutions');
      expect(response.body.quotas).toHaveProperty('storageBytes');
      expect(response.body.quotas).toHaveProperty('members');
      expect(response.body.quotas).toHaveProperty('apiKeys');
      expect(response.body.quotas).toHaveProperty('webhooks');
      expect(response.body).toHaveProperty('isOverQuota', false);
      expect(response.body).toHaveProperty('warnings');
    });

    it('RBAC: Usage and Quota endpoints require AUDIT_READ', async () => {
      // ADMIN allowed
      await request
        .get('/api/v1/admin/usage')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);

      // EDITOR forbidden
      await request
        .get('/api/v1/admin/usage')
        .set('Authorization', `Bearer ${editorToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(403);

      // VIEWER forbidden
      await request
        .get('/api/v1/admin/quotas')
        .set('Authorization', `Bearer ${viewerToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(403);
    });
  });

  // =========================================================================
  // 4. Security Center API
  // =========================================================================
  describe('4. Security Center API', () => {
    beforeEach(async () => {
      // Seed security events
      await AuditLogModel.create([
        {
          userId: ownerUser._id,
          workspaceId: workspaceA._id,
          action: 'AUTH_LOGIN_FAILED',
          resource: 'auth',
          ipAddress: '198.51.100.1',
          createdAt: new Date(),
        },
        {
          userId: ownerUser._id,
          workspaceId: workspaceA._id,
          action: 'API_KEY_REVOKED',
          resource: 'api_key',
          resourceId: 'key-old',
          createdAt: new Date(),
        },
        {
          userId: ownerUser._id,
          workspaceId: workspaceA._id,
          action: 'WORKSPACE_MEMBER_ROLE_CHANGED',
          resource: 'member',
          metadata: { userId: adminUser._id.toString(), newRole: 'ADMIN' },
          createdAt: new Date(),
        },
      ]);

      // Seed API keys with various postures
      await APIKeyModel.create([
        {
          workspaceId: workspaceA._id,
          createdBy: ownerUser._id,
          name: 'Active Key',
          keyPrefix: 'wke_act',
          keyHash: 'secret_1',
          status: 'ACTIVE',
          permissions: ['WORKFLOW_READ'],
          rateLimit: { requestsPerMinute: 100, executionsPerHour: 500 },
        },
        {
          workspaceId: workspaceA._id,
          createdBy: ownerUser._id,
          name: 'Admin Key Without Rate Limit',
          keyPrefix: 'wke_adm',
          keyHash: 'secret_2',
          status: 'ACTIVE',
          permissions: ['MEMBER_MANAGE', 'AUDIT_READ'],
        },
      ]);
    });

    it('GET /api/v1/admin/security/overview - generates security score and posture breakdown', async () => {
      const response = await request
        .get('/api/v1/admin/security/overview')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);

      expect(response.body).toHaveProperty('workspaceId', workspaceAId);
      expect(response.body).toHaveProperty('score');
      expect(typeof response.body.score).toBe('number');
      expect(response.body).toHaveProperty('status');
      expect(['EXCELLENT', 'GOOD', 'WARNING', 'CRITICAL']).toContain(response.body.status);

      expect(response.body.apiKeys).toMatchObject({
        total: 2,
        active: 2,
        withoutRateLimit: 1,
        adminPermissions: 1,
      });

      expect(response.body.access).toMatchObject({
        totalMembers: 4,
        owners: 1,
        admins: 1,
        editors: 1,
        viewers: 1,
      });

      expect(response.body.events).toMatchObject({
        failedLoginsLast7d: 1,
        apiKeyRevocationsLast30d: 1,
        totalSecurityEventsLast7d: 3,
      });

      expect(Array.isArray(response.body.recommendations)).toBe(true);
    });

    it('GET /api/v1/admin/security/events - queries security-specific audit events', async () => {
      const response = await request
        .get('/api/v1/admin/security/events')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);

      expect(response.body).toHaveProperty('logs');
      expect(response.body.logs.length).toBe(3);
      const actions = response.body.logs.map((l: any) => l.action);
      expect(actions).toContain('AUTH_LOGIN_FAILED');
      expect(actions).toContain('API_KEY_REVOKED');
      expect(actions).toContain('WORKSPACE_MEMBER_ROLE_CHANGED');
    });

    it('RBAC: Security Center endpoints require AUDIT_READ', async () => {
      // ADMIN allowed
      await request
        .get('/api/v1/admin/security/overview')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);

      // EDITOR forbidden
      await request
        .get('/api/v1/admin/security/overview')
        .set('Authorization', `Bearer ${editorToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(403);
    });
  });

  // =========================================================================
  // 5. System Administration API
  // =========================================================================
  describe('5. System Administration API', () => {
    beforeEach(async () => {
      // Seed dead letter queue entry
      await DeadLetterModel.create({
        executionId: new mongoose.Types.ObjectId(),
        workflowId: new mongoose.Types.ObjectId(),
        workspaceId: workspaceA._id,
        failureReason: 'Node timeout exceeded',
        attempts: 3,
        failedAt: new Date(),
      });
    });

    it('GET /api/v1/admin/system/health - reuses health checks and returns operational health', async () => {
      const response = await request
        .get('/api/v1/admin/system/health')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);

      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('checks');
      expect(response.body.checks.mongo).toHaveProperty('status', 'up');
      expect(response.body).toHaveProperty('uptimeSeconds');
      expect(response.body).toHaveProperty('memory');
      expect(response.body.memory).toHaveProperty('heapUsedMB');
      expect(response.body).toHaveProperty('timestamp');
    });

    it('GET /api/v1/admin/system/metrics - aggregates system-wide platform statistics', async () => {
      const response = await request
        .get('/api/v1/admin/system/metrics')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);

      expect(response.body).toHaveProperty('users', 5);
      expect(response.body.workspaces).toEqual({
        total: 2,
        active: 2,
        suspended: 0,
        deleted: 0,
      });
      expect(response.body).toHaveProperty('deadLetters', 1);
      expect(response.body).toHaveProperty('auditLogs');
      expect(response.body).toHaveProperty('timestamp');
    });

    it('POST /api/v1/admin/system/maintenance/recalculate-analytics - triggers analytics recomputation', async () => {
      const response = await request
        .post('/api/v1/admin/system/maintenance/recalculate-analytics')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-workspace-id', workspaceAId)
        .send({ workspaceId: workspaceAId })
        .expect(200);

      expect(response.body).toHaveProperty('workflows');
      expect(response.body).toHaveProperty('executions');
      expect(response.body).toHaveProperty('workspaces');
    });

    it('RBAC: System Administration endpoints require administrative access', async () => {
      // ADMIN allowed
      await request
        .get('/api/v1/admin/system/health')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(200);

      // EDITOR forbidden -> 403
      const editorRes = await request
        .get('/api/v1/admin/system/health')
        .set('Authorization', `Bearer ${editorToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(403);
      expect(editorRes.body.error.code).toBe('FORBIDDEN');

      // VIEWER forbidden -> 403
      const viewerRes = await request
        .get('/api/v1/admin/system/metrics')
        .set('Authorization', `Bearer ${viewerToken}`)
        .set('x-workspace-id', workspaceAId)
        .expect(403);
      expect(viewerRes.body.error.code).toBe('FORBIDDEN');
    });
  });
});
