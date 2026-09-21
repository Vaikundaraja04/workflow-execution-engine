import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createApp } from '../src/api/app.js';
import { UserModel } from '../src/models/UserModel.js';
import { WorkspaceModel } from '../src/models/WorkspaceModel.js';
import { WorkspaceMemberModel } from '../src/models/WorkspaceMemberModel.js';
import { SubscriptionModel } from '../src/models/SubscriptionModel.js';
import { TenantAccountModel } from '../src/models/TenantAccountModel.js';
import { CustomerProfileModel } from '../src/models/CustomerProfileModel.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';
import { signAccessToken } from '../src/auth/jwt.service.js';
import type { AuthConfig } from '../src/auth/jwt.service.js';

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;

const authConfig: AuthConfig = {
  jwtSecret: 'test-secret-key-for-customer-management-tests',
  accessTtl: '15m',
  refreshTtl: '7d',
};

let adminToken: string;
let ownerToken: string;
let workspaceId: string;
let workspaceObjectId: mongoose.Types.ObjectId;
beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());

  process.env.PLATFORM_ADMIN_EMAILS = 'admin@platform.test';

  const app = createApp({
    auth: authConfig,
    docs: false,
    health: {
      checks: {
        mongo: async () => ({ status: 'up', latencyMs: 1 }),
        redis: async () => ({ status: 'skipped', latencyMs: 0 }),
        worker: async () => ({ status: 'skipped', latencyMs: 0 }),
      },
    },
  });
  request = supertest(app);

  const admin = await UserModel.create({
    email: 'admin@platform.test',
    passwordHash: 'unused-test-password-hash',
  });
  adminToken = signAccessToken(authConfig, { userId: admin._id.toString(), email: admin.email });

  const owner = await UserModel.create({
    email: 'customer@acme.test',
    passwordHash: 'unused-test-password-hash',
  });
  ownerToken = signAccessToken(authConfig, { userId: owner._id.toString(), email: owner.email });

  const workspace = await WorkspaceModel.create({
    name: 'Acme Customer',
    slug: 'acme-customer',
    ownerId: owner._id,
  });
  workspaceObjectId = workspace._id;
  workspaceId = workspace._id.toString();

  await WorkspaceMemberModel.create({
    workspaceId: workspace._id,
    userId: owner._id,
    role: 'OWNER',
    status: 'ACTIVE',
  });
  await TenantAccountModel.create({
    workspaceId: workspace._id,
    ownerUserId: owner._id,
    companyName: 'Acme Customer',
    status: 'ACTIVE',
    plan: 'FREE',
  });
  await CustomerProfileModel.create({
    tenantId: workspace._id,
    contactName: 'Cara Customer',
    contactEmail: 'customer@acme.test',
    company: 'Acme Customer',
  });
  await SubscriptionModel.create({
    workspaceId: workspace._id,
    plan: 'FREE',
    status: 'ACTIVE',
    billingProvider: 'mock',
    externalCustomerId: 'cus_customer',
    externalSubscriptionId: 'sub_customer',
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
}, 180000);

afterAll(async () => {
  delete process.env.PLATFORM_ADMIN_EMAILS;
  await mongoose.disconnect();
  await replSet.stop();
}, 30000);

const authHeader = (token: string) => ({ Authorization: `Bearer ${token}` });
describe('customer management console', () => {
  it('rejects non-admin users from the customer list', async () => {
    await request
      .get('/api/v1/saas/customers')
      .set(authHeader(ownerToken))
      .expect(403);
  });

  it('lists customers with health and usage headlines for admins', async () => {
    const res = await request
      .get('/api/v1/saas/customers')
      .set(authHeader(adminToken))
      .expect(200);

    expect(res.body.total).toBeGreaterThanOrEqual(1);
    const row = res.body.customers.find((customer: any) => customer.workspaceId === workspaceId);
    expect(row).toBeTruthy();
    expect(row.plan).toBe('FREE');
    expect(row.subscription.status).toBe('ACTIVE');
    expect(row.health.score).toBeGreaterThan(0);
    expect(['healthy', 'watch', 'at_risk']).toContain(row.health.band);
    expect(row.usage).toHaveProperty('executionsThisMonth');

    const filtered = await request
      .get('/api/v1/saas/customers?search=acme')
      .set(authHeader(adminToken))
      .expect(200);
    expect(filtered.body.total).toBe(1);
  });

  it('returns customer detail including profile and support notes', async () => {
    const res = await request
      .get(`/api/v1/saas/customers/${workspaceId}`)
      .set(authHeader(adminToken))
      .expect(200);

    expect(res.body.tenant.companyName).toBe('Acme Customer');
    expect(res.body.profile.contactEmail).toBe('customer@acme.test');
    expect(res.body.workspace.status).toBe('ACTIVE');
    expect(res.body.subscription.plan).toBe('FREE');
  });
  it('suspends the tenant, blocks tenant APIs and reactivates', async () => {
    await request
      .post(`/api/v1/saas/customers/${workspaceId}/suspend`)
      .set(authHeader(adminToken))
      .expect(200);

    const workspace = await WorkspaceModel.findById(workspaceObjectId);
    expect(workspace?.status).toBe('SUSPENDED');
    const tenant = await TenantAccountModel.findOne({ workspaceId: workspaceObjectId });
    expect(tenant?.status).toBe('SUSPENDED');
    const suspendAudit = await AuditLogModel.findOne({
      action: 'TENANT_SUSPENDED',
      workspaceId: workspaceObjectId,
    });
    expect(suspendAudit).toBeTruthy();

    const blocked = await request
      .get('/api/v1/usage')
      .set(authHeader(ownerToken))
      .set('x-workspace-id', workspaceId)
      .expect(403);
    expect(blocked.body.error.code).toBe('TENANT_SUSPENDED');

    await request
      .post(`/api/v1/saas/customers/${workspaceId}/reactivate`)
      .set(authHeader(adminToken))
      .expect(200);

    const reactivateAudit = await AuditLogModel.findOne({
      action: 'TENANT_REACTIVATED',
      workspaceId: workspaceObjectId,
    });
    expect(reactivateAudit).toBeTruthy();

    await request
      .get('/api/v1/usage')
      .set(authHeader(ownerToken))
      .set('x-workspace-id', workspaceId)
      .expect(200);
  });

  it('records support notes with audit history', async () => {
    await request
      .post(`/api/v1/saas/customers/${workspaceId}/notes`)
      .set(authHeader(adminToken))
      .send({ note: 'Requested a demo of enterprise SSO.' })
      .expect(201);

    const profile = await CustomerProfileModel.findOne({ tenantId: workspaceObjectId });
    expect(profile?.supportNotes).toHaveLength(1);
    expect(profile?.supportNotes[0]?.note).toBe('Requested a demo of enterprise SSO.');

    const audit = await AuditLogModel.findOne({
      action: 'CUSTOMER_NOTE_ADDED',
      workspaceId: workspaceObjectId,
    });
    expect(audit).toBeTruthy();

    await request
      .post(`/api/v1/saas/customers/${workspaceId}/notes`)
      .set(authHeader(adminToken))
      .send({ note: '   ' })
      .expect(400);
  });
});
