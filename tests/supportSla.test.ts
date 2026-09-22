import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { createApp } from '../src/api/app.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';
import { NotificationModel } from '../src/models/NotificationModel.js';
import { SupportTicketModel } from '../src/models/SupportTicketModel.js';
import { SLAPolicyModel } from '../src/models/SLAPolicyModel.js';
import type { AuthConfig } from '../src/auth/jwt.service.js';

/**
 * Phase 18.3 / 18.4 - Enterprise support through the app: the ticket lifecycle
 * with SLA deadlines, workspace scoping, breach detection and the idempotent
 * sweep, plus the administrator-only surfaces.
 */

const authConfig: AuthConfig = {
  jwtSecret: 'test-secret-key-for-support-sla-18',
  accessTtl: '15m',
  refreshTtl: '7d',
};

const adminEmail = 'support-admin@acme.test';
const memberEmail = 'support-member@acme.test';
const outsiderEmail = 'support-outsider@acme.test';

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;
let adminToken = '';
let memberToken = '';
let outsiderToken = '';
let adminUserId = '';
let memberUserId = '';
let memberWorkspaceId = '';
let outsiderWorkspaceId = '';

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const HOUR_MS = 60 * 60 * 1000;

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
    password: 'SupportPass123!',
    name: 'Support Admin',
    companyName: 'Support Platform',
  });
  adminToken = admin.body.tokens.accessToken;
  adminUserId = admin.body.user.id;

  const member = await request.post('/api/v1/saas/signup').send({
    email: memberEmail,
    password: 'SupportPass123!',
    name: 'Support Member',
    companyName: 'Member Manufacturing',
  });
  memberToken = member.body.tokens.accessToken;
  memberUserId = member.body.user.id;
  memberWorkspaceId = member.body.workspace.id;

  const outsider = await request.post('/api/v1/saas/signup').send({
    email: outsiderEmail,
    password: 'SupportPass123!',
    name: 'Support Outsider',
    companyName: 'Outsider Retail',
  });
  outsiderToken = outsider.body.tokens.accessToken;
  outsiderWorkspaceId = outsider.body.workspace.id;
}, 180000);

afterAll(async () => {
  delete process.env.PLATFORM_ADMIN_EMAILS;
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
}, 30000);

beforeEach(async () => {
  await Promise.all([
    SupportTicketModel.deleteMany({}),
    SLAPolicyModel.deleteMany({}),
    AuditLogModel.deleteMany({}),
    NotificationModel.deleteMany({}),
  ]);
});

const createTicket = (token: string, body: Record<string, unknown> = {}) =>
  request
    .post('/api/v1/support/tickets')
    .set(bearer(token))
    .send({ subject: 'Cannot publish workflows', description: 'Publishing fails with a server error.', ...body });

describe('Phase 18.3 support tickets', () => {
  it('creates a ticket with SLA deadlines stamped from the default policy', async () => {
    const before = Date.now();
    const res = await createTicket(memberToken);
    const after = Date.now();
    expect(res.status).toBe(201);
    expect(res.body.data.ticketNumber).toMatch(/^TCK-/);
    expect(res.body.data).toMatchObject({
      workspaceId: memberWorkspaceId,
      priority: 'NORMAL',
      status: 'OPEN',
      category: 'GENERAL',
      breached: false,
      escalationLevel: 0,
      responded: false,
    });
    expect(res.body.data.slaPolicyId).toBeTruthy();
    const responseDue = new Date(res.body.data.firstResponseDueAt).getTime();
    expect(responseDue).toBeGreaterThanOrEqual(before + 8 * HOUR_MS);
    expect(responseDue).toBeLessThanOrEqual(after + 8 * HOUR_MS);
    const resolutionDue = new Date(res.body.data.resolutionDueAt).getTime();
    expect(resolutionDue).toBeGreaterThanOrEqual(before + 48 * HOUR_MS);
    expect(resolutionDue).toBeLessThanOrEqual(after + 48 * HOUR_MS);
    expect(await AuditLogModel.countDocuments({ action: 'SUPPORT_TICKET_CREATED' })).toBe(1);
    expect(await SLAPolicyModel.countDocuments({})).toBe(4);
  });
});

describe('Phase 18.3 ticket scoping and isolation', () => {
  it('scopes reads to the caller workspace and hides foreign tickets', async () => {
    const created = await createTicket(memberToken);
    const ticketId = created.body.data.ticketId as string;

    const adminList = await request.get('/api/v1/support/tickets').set(bearer(adminToken));
    expect(adminList.status).toBe(200);
    expect(adminList.body.data.total).toBe(1);
    expect(adminList.body.data.items[0].ticketId).toBe(ticketId);

    const memberList = await request.get('/api/v1/support/tickets').set(bearer(memberToken));
    expect(memberList.body.data.items).toHaveLength(1);

    const outsiderList = await request.get('/api/v1/support/tickets').set(bearer(outsiderToken));
    expect(outsiderList.body.data.total).toBe(0);

    const foreignWindow = await request
      .get(`/api/v1/support/tickets?workspaceId=${memberWorkspaceId}`)
      .set(bearer(outsiderToken));
    expect(foreignWindow.status).toBe(404);
    expect(foreignWindow.body.error.code).toBe('WORKSPACE_NOT_FOUND');

    const foreignTicket = await request.get(`/api/v1/support/tickets/${ticketId}`).set(bearer(outsiderToken));
    expect(foreignTicket.status).toBe(404);
    expect(foreignTicket.body.error.code).toBe('TICKET_NOT_FOUND');

    const adminTicket = await request.get(`/api/v1/support/tickets/${ticketId}`).set(bearer(adminToken));
    expect(adminTicket.status).toBe(200);

    await request.get('/api/v1/support/tickets').expect(401);
  });
});

describe('Phase 18.3 ticket lifecycle', () => {
  it('assigns, stamps the first staff response, resolves and reopens', async () => {
    const created = await createTicket(memberToken);
    const ticketId = created.body.data.ticketId as string;

    const ownUpdate = await request
      .patch(`/api/v1/support/tickets/${ticketId}`)
      .set(bearer(memberToken))
      .send({ status: 'IN_PROGRESS' });
    expect(ownUpdate.status).toBe(200);
    expect(ownUpdate.body.data.firstResponseAt).toBeNull();

    const assigned = await request
      .patch(`/api/v1/support/tickets/${ticketId}`)
      .set(bearer(adminToken))
      .send({ assigneeId: adminUserId, status: 'WAITING' });
    expect(assigned.status).toBe(200);
    expect(assigned.body.data.assigneeId).toBe(adminUserId);
    expect(assigned.body.data.firstResponseAt).toBeTruthy();
    expect(await AuditLogModel.countDocuments({ action: 'SUPPORT_TICKET_ASSIGNED' })).toBe(1);
    expect(await NotificationModel.countDocuments({ userId: new Types.ObjectId(adminUserId) })).toBe(1);

    const resolved = await request
      .patch(`/api/v1/support/tickets/${ticketId}`)
      .set(bearer(adminToken))
      .send({ status: 'RESOLVED', resolution: 'Rotated the failing credential.' });
    expect(resolved.status).toBe(200);
    expect(resolved.body.data.resolution).toBe('Rotated the failing credential.');
    expect(resolved.body.data.resolvedAt).toBeTruthy();
    expect(await AuditLogModel.countDocuments({ action: 'SUPPORT_TICKET_RESOLVED' })).toBe(1);

    const invalid = await request
      .patch(`/api/v1/support/tickets/${ticketId}`)
      .set(bearer(adminToken))
      .send({ status: 'IN_PROGRESS' });
    expect(invalid.status).toBe(409);
    expect(invalid.body.error.code).toBe('INVALID_TICKET_TRANSITION');

    const reopened = await request
      .patch(`/api/v1/support/tickets/${ticketId}`)
      .set(bearer(adminToken))
      .send({ status: 'OPEN' });
    expect(reopened.status).toBe(200);
    expect(reopened.body.data.resolvedAt).toBeNull();
  });
});

describe('Phase 18.3 ticket validation', () => {
  it('re-stamps the SLA deadlines when the priority changes', async () => {
    const created = await createTicket(memberToken);
    const ticketId = created.body.data.ticketId as string;

    const before = Date.now();
    const urgent = await request
      .patch(`/api/v1/support/tickets/${ticketId}`)
      .set(bearer(adminToken))
      .send({ priority: 'URGENT' });
    const after = Date.now();
    expect(urgent.status).toBe(200);
    expect(urgent.body.data.priority).toBe('URGENT');
    const responseDue = new Date(urgent.body.data.firstResponseDueAt).getTime();
    expect(responseDue).toBeGreaterThanOrEqual(before + HOUR_MS);
    expect(responseDue).toBeLessThanOrEqual(after + HOUR_MS);
    const resolutionDue = new Date(urgent.body.data.resolutionDueAt).getTime();
    expect(resolutionDue).toBeGreaterThanOrEqual(before + 8 * HOUR_MS);
    expect(resolutionDue).toBeLessThanOrEqual(after + 8 * HOUR_MS);
  });

  it('rejects malformed tickets and hides unknown ids', async () => {
    const badSubject = await createTicket(memberToken, { subject: 'ab' });
    expect(badSubject.status).toBe(400);
    expect(badSubject.body.error.code).toBe('INVALID_REQUEST');

    const missingDescription = await request
      .post('/api/v1/support/tickets')
      .set(bearer(memberToken))
      .send({ subject: 'Cannot publish workflows' });
    expect(missingDescription.status).toBe(400);

    const unknownId = new Types.ObjectId().toString();
    const missingTicket = await request.get(`/api/v1/support/tickets/${unknownId}`).set(bearer(adminToken));
    expect(missingTicket.status).toBe(404);
    expect(missingTicket.body.error.code).toBe('TICKET_NOT_FOUND');

    const missingPatch = await request
      .patch(`/api/v1/support/tickets/${unknownId}`)
      .set(bearer(adminToken))
      .send({ status: 'OPEN' });
    expect(missingPatch.status).toBe(404);
  });
});

describe('Phase 18.4 SLA monitoring', () => {
  it('seeds the default policies once and lists them with the breach view', async () => {
    const first = await request.get('/api/v1/support/sla').set(bearer(memberToken));
    expect(first.status).toBe(200);
    expect(first.body.data.policies).toHaveLength(4);
    expect(first.body.data.policies[0]).toMatchObject({ priority: 'URGENT', responseTimeMinutes: 60 });
    expect(first.body.data.breaches).toHaveLength(0);

    const again = await request.get('/api/v1/support/sla').set(bearer(adminToken));
    expect(again.body.data.policies).toHaveLength(4);
    expect(await SLAPolicyModel.countDocuments({})).toBe(4);
  });

  it('detects a breach once and keeps the sweep idempotent', async () => {
    const created = await createTicket(memberToken);
    const ticketId = created.body.data.ticketId as string;
    const ticketNumber = created.body.data.ticketNumber as string;
    await SupportTicketModel.updateOne(
      { _id: new Types.ObjectId(ticketId) },
      {
        $set: {
          firstResponseDueAt: new Date(Date.now() - HOUR_MS),
          resolutionDueAt: new Date(Date.now() - HOUR_MS),
        },
      },
    );

    const sweep = await request.post('/api/v1/support/sla/sweep').set(bearer(adminToken)).send({});
    expect(sweep.status).toBe(200);
    expect(sweep.body.data.evaluated).toBe(1);
    expect(sweep.body.data.breached).toHaveLength(1);
    expect(sweep.body.data.breached[0]).toMatchObject({
      ticketId,
      ticketNumber,
      reason: 'FIRST_RESPONSE',
      escalationLevel: 1,
    });

    const row = await SupportTicketModel.findById(ticketId).lean();
    expect(row?.breached).toBe(true);
    expect(row?.escalationLevel).toBe(1);
    expect(row?.breachNotifiedAt).toBeTruthy();
    expect(await NotificationModel.countDocuments({ userId: new Types.ObjectId(memberUserId) })).toBe(1);
    expect(await AuditLogModel.countDocuments({ action: 'SLA_BREACH_DETECTED' })).toBe(1);
  });

  it('reports zero new breaches on a second sweep and restricts the sweep to administrators', async () => {
    const created = await createTicket(memberToken);
    const ticketId = created.body.data.ticketId as string;
    const ticketNumber = created.body.data.ticketNumber as string;
    await SupportTicketModel.updateOne(
      { _id: new Types.ObjectId(ticketId) },
      {
        $set: {
          firstResponseDueAt: new Date(Date.now() - HOUR_MS),
          resolutionDueAt: new Date(Date.now() - HOUR_MS),
        },
      },
    );
    await request.post('/api/v1/support/sla/sweep').set(bearer(adminToken)).send({});

    const second = await request.post('/api/v1/support/sla/sweep').set(bearer(adminToken)).send({});
    expect(second.status).toBe(200);
    expect(second.body.data.breached).toHaveLength(0);
    expect(await AuditLogModel.countDocuments({ action: 'SLA_BREACH_DETECTED' })).toBe(1);

    const view = await request.get('/api/v1/support/sla').set(bearer(memberToken));
    expect(view.body.data.breaches).toHaveLength(1);
    expect(view.body.data.breaches[0].ticketNumber).toBe(ticketNumber);

    const forbidden = await request.post('/api/v1/support/sla/sweep').set(bearer(memberToken)).send({});
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');
  });
});
