import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { createApp } from '../src/api/app.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';
import { EnterpriseAccountModel } from '../src/models/EnterpriseAccountModel.js';
import type { AuthConfig } from '../src/auth/jwt.service.js';

/**
 * Phase 18.1 - Enterprise accounts through the app: the administrator-only
 * register over workspaces (create, list with filters and summary, read,
 * update with audits) plus the RBAC, isolation and validation denials.
 */

const authConfig: AuthConfig = {
  jwtSecret: 'test-secret-key-for-enterprise-accounts-18',
  accessTtl: '15m',
  refreshTtl: '7d',
};

const adminEmail = 'accounts-admin@acme.test';
const memberEmail = 'accounts-member@acme.test';

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;
let adminToken = '';
let memberToken = '';
let adminUserId = '';
let adminWorkspaceId = '';
let memberWorkspaceId = '';

const authed = (req: supertest.Test) => req.set('Authorization', `Bearer ${adminToken}`);
const DAY_MS = 24 * 60 * 60 * 1000;
const isoInDays = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString();

beforeAll(async () => {
  process.env.PLATFORM_ADMIN_EMAILS = adminEmail;
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  request = supertest(createApp({
    auth: authConfig,
    docs: false,
    health: {
      checks: {
        mongo: async () => ({ status: 'up', latencyMs: 1 }),
        redis: async () => ({ status: 'skipped', latencyMs: 0 }),
        worker: async () => ({ status: 'skipped', latencyMs: 0 }),
      },
    },
  }));

  const admin = await request.post('/api/v1/saas/signup').send({
    email: adminEmail,
    password: 'AccountsPass123!',
    name: 'Accounts Admin',
    companyName: 'Accounts Platform',
  });
  adminToken = admin.body.tokens.accessToken;
  adminUserId = admin.body.user.id;
  adminWorkspaceId = admin.body.workspace.id;

  const member = await request.post('/api/v1/saas/signup').send({
    email: memberEmail,
    password: 'AccountsPass123!',
    name: 'Accounts Member',
    companyName: 'Member Logistics',
  });
  memberToken = member.body.tokens.accessToken;
  memberWorkspaceId = member.body.workspace.id;
}, 180000);

afterAll(async () => {
  delete process.env.PLATFORM_ADMIN_EMAILS;
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
}, 30000);

beforeEach(async () => {
  await Promise.all([
    EnterpriseAccountModel.deleteMany({}),
    AuditLogModel.deleteMany({}),
  ]);
});

const createAccount = (body: Record<string, unknown>) => authed(request.post('/api/v1/accounts')).send(body);

describe('Phase 18.1 creating the account register', () => {
  it('creates one account per workspace and joins the workspace and subscription state', async () => {
    const res = await createAccount({
      workspaceId: memberWorkspaceId,
      company: 'Northwind Freight',
      industry: 'Logistics',
      accountOwnerId: adminUserId,
      contractType: 'ANNUAL',
      mrr: 250000,
      seats: 40,
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      workspaceId: memberWorkspaceId,
      company: 'Northwind Freight',
      industry: 'Logistics',
      customerStatus: 'TRIAL',
      contractType: 'ANNUAL',
      mrr: 250000,
      seats: 40,
      workspaceName: 'Member Logistics',
    });
    expect(res.body.data.accountId).toBeTruthy();
    expect(res.body.data.subscriptionPlan).toBeTruthy();
    expect(res.body.data.renewalDate).toBeTruthy();
    expect(typeof res.body.data.renewalDueInDays).toBe('number');
    expect(await AuditLogModel.countDocuments({ action: 'ENTERPRISE_ACCOUNT_CREATED' })).toBe(1);

    const duplicate = await createAccount({
      workspaceId: memberWorkspaceId,
      company: 'Northwind Freight',
      accountOwnerId: adminUserId,
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('ACCOUNT_ALREADY_EXISTS');
  });

  it('rejects unknown workspaces, invalid owners and malformed bodies', async () => {
    const unknownWorkspace = await createAccount({
      workspaceId: new Types.ObjectId().toString(),
      company: 'Ghost Co',
      accountOwnerId: adminUserId,
    });
    expect(unknownWorkspace.status).toBe(404);
    expect(unknownWorkspace.body.error.code).toBe('WORKSPACE_NOT_FOUND');

    const invalidOwner = await createAccount({
      workspaceId: memberWorkspaceId,
      company: 'Northwind Freight',
      accountOwnerId: 'not-an-id',
    });
    expect(invalidOwner.status).toBe(400);
    expect(invalidOwner.body.error.code).toBe('INVALID_ACCOUNT');

    const missingCompany = await createAccount({
      workspaceId: memberWorkspaceId,
      accountOwnerId: adminUserId,
    });
    expect(missingCompany.status).toBe(400);
    expect(missingCompany.body.error.code).toBe('INVALID_REQUEST');

    const unknownField = await createAccount({
      workspaceId: memberWorkspaceId,
      company: 'Northwind Freight',
      accountOwnerId: adminUserId,
      surprise: true,
    });
    expect(unknownField.status).toBe(400);
    expect(await EnterpriseAccountModel.countDocuments({})).toBe(0);
  });
});

describe('Phase 18.1 listing the register', () => {
  it('filters by status, industry, company and renewal window with a folded summary', async () => {
    await createAccount({
      workspaceId: memberWorkspaceId,
      company: 'Northwind Freight',
      industry: 'Logistics',
      accountOwnerId: adminUserId,
      customerStatus: 'ACTIVE',
      mrr: 100000,
      renewalDate: isoInDays(10),
    });
    await createAccount({
      workspaceId: adminWorkspaceId,
      company: 'Contoso Analytics',
      industry: 'Software',
      accountOwnerId: adminUserId,
      customerStatus: 'AT_RISK',
      mrr: 50000,
      renewalDate: isoInDays(60),
    });

    const all = await authed(request.get('/api/v1/accounts'));
    expect(all.status).toBe(200);
    expect(all.body.data.summary).toMatchObject({ total: 2, renewingSoon: 1, mrrTotal: 150000 });

    expect(all.body.data.summary.byStatus.ACTIVE).toBe(1);
    expect(all.body.data.summary.byStatus.AT_RISK).toBe(1);
    expect(all.body.data.summary.byStatus.CHURNED).toBe(0);

    const active = await authed(request.get('/api/v1/accounts?customerStatus=ACTIVE'));
    expect(active.body.data.items).toHaveLength(1);
    expect(active.body.data.items[0].company).toBe('Northwind Freight');

    const search = await authed(request.get('/api/v1/accounts?q=contoso'));
    expect(search.body.data.items).toHaveLength(1);
    expect(search.body.data.items[0].company).toBe('Contoso Analytics');

    const industry = await authed(request.get('/api/v1/accounts?industry=Logistics'));
    expect(industry.body.data.items).toHaveLength(1);

    const window = await authed(request.get('/api/v1/accounts?renewalWithinDays=30'));
    expect(window.body.data.items).toHaveLength(1);
    expect(window.body.data.items[0].company).toBe('Northwind Freight');

    const empty = await authed(request.get('/api/v1/accounts?customerStatus=CHURNED'));
    expect(empty.body.data.summary.total).toBe(0);
    expect(empty.body.data.summary.mrrTotal).toBe(0);
    expect(empty.body.data.items).toHaveLength(0);
  });
});

describe('Phase 18.1 reading and updating one account', () => {
  it('reads by account id or workspace id and hides unknown ids', async () => {
    const created = await createAccount({
      workspaceId: memberWorkspaceId,
      company: 'Northwind Freight',
      accountOwnerId: adminUserId,
    });
    const accountId = created.body.data.accountId as string;

    const byId = await authed(request.get(`/api/v1/accounts/${accountId}`));
    expect(byId.status).toBe(200);
    expect(byId.body.data.company).toBe('Northwind Freight');

    const byWorkspace = await authed(request.get(`/api/v1/accounts/${memberWorkspaceId}`));
    expect(byWorkspace.status).toBe(200);
    expect(byWorkspace.body.data.accountId).toBe(accountId);

    const missing = await authed(request.get(`/api/v1/accounts/${new Types.ObjectId().toString()}`));
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('ACCOUNT_NOT_FOUND');
  });

  it('audits every status change with the previous status and ignores no-op patches', async () => {
    const created = await createAccount({
      workspaceId: memberWorkspaceId,
      company: 'Northwind Freight',
      accountOwnerId: adminUserId,
    });
    const accountId = created.body.data.accountId as string;

    const updated = await authed(request.patch(`/api/v1/accounts/${accountId}`)).send({
      customerStatus: 'AT_RISK',
      mrr: 120000,
      renewalDate: isoInDays(15),
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({ customerStatus: 'AT_RISK', mrr: 120000 });
    const audits = await AuditLogModel.find({ action: 'ENTERPRISE_ACCOUNT_UPDATED' }).lean();
    expect(audits).toHaveLength(1);
    expect(audits[0]?.metadata?.previousStatus).toBe('TRIAL');
    expect(audits[0]?.metadata?.customerStatus).toBe('AT_RISK');
    expect(audits[0]?.metadata?.changed).toContain('customerStatus');

    const noop = await authed(request.patch(`/api/v1/accounts/${accountId}`)).send({});
    expect(noop.status).toBe(200);
    expect(await AuditLogModel.countDocuments({ action: 'ENTERPRISE_ACCOUNT_UPDATED' })).toBe(1);

    const invalid = await authed(request.patch(`/api/v1/accounts/${accountId}`)).send({ customerStatus: 'NOPE' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('INVALID_REQUEST');

    const missing = await authed(request.patch(`/api/v1/accounts/${new Types.ObjectId().toString()}`)).send({ seats: 5 });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('ACCOUNT_NOT_FOUND');
  });
});

describe('Phase 18.1 account register access control', () => {
  it('keeps the register to platform administrators', async () => {
    const forbidden = await request
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ workspaceId: memberWorkspaceId, company: 'Northwind Freight', accountOwnerId: adminUserId });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');

    await request.get('/api/v1/accounts').set('Authorization', `Bearer ${memberToken}`).expect(403);

    const unauthenticated = await request.get('/api/v1/accounts');
    expect(unauthenticated.status).toBe(401);
    expect(await EnterpriseAccountModel.countDocuments({})).toBe(0);
  });
});
