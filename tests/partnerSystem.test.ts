import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { createApp } from '../src/api/app.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';
import { PaymentRecordModel } from '../src/models/PaymentRecordModel.js';
import { leadService } from '../src/services/leadService.js';
import type { AuthConfig } from '../src/auth/jwt.service.js';

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;

const authConfig: AuthConfig = {
  jwtSecret: 'test-secret-key-for-partner-system',
  accessTtl: '15m',
  refreshTtl: '7d',
};

const adminEmail = 'partner-admin@acme.test';
const memberEmail = 'partner-member@acme.test';
let adminToken = '';
let memberToken = '';
let workspaceId = '';
let leadId = '';
let partnerId = '';

beforeAll(async () => {
  process.env.PLATFORM_ADMIN_EMAILS = adminEmail;
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
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

  const admin = await request.post('/api/v1/saas/signup').send({
    email: adminEmail,
    password: 'PartnerPass123!',
    name: 'Partner Admin',
    companyName: 'Partner Test Co',
  });
  adminToken = admin.body.tokens.accessToken;
  workspaceId = admin.body.workspace.id;

  const member = await request.post('/api/v1/saas/signup').send({
    email: memberEmail,
    password: 'MemberPass123!',
    name: 'Partner Member',
    companyName: 'Member Test Co',
  });
  memberToken = member.body.tokens.accessToken;

  const captured = await leadService.capture({
    company: 'Referral Co',
    contactName: 'Rita Referral',
    contactEmail: 'rita@referral.test',
    source: 'PARTNER',
  });
  leadId = captured.lead.id;
}, 180000);

afterAll(async () => {
  delete process.env.PLATFORM_ADMIN_EMAILS;
  await mongoose.disconnect();
  await replSet.stop();
}, 30000);

const authed = (req: supertest.Test) => req.set('Authorization', `Bearer ${adminToken}`);

describe('Phase 16.6 partner channel', () => {
  it('creates a partner with a unique code and audits it', async () => {
    const res = await authed(request.post('/api/v1/partners')).send({
      name: 'Acme Reseller Network',
      company: 'Acme Partners LLC',
      contactName: 'Ada Vendor',
      contactEmail: 'ada@acme-partners.test',
      code: 'acme-2026',
      tier: 'SILVER',
      commissionRatePercent: 15,
    }).expect(201);
    partnerId = res.body.partner.partnerId;
    expect(res.body.partner.code).toBe('ACME-2026');
    expect(res.body.partner.tier).toBe('SILVER');
    expect(res.body.partner.commissionRatePercent).toBe(15);
    expect(res.body.partner.status).toBe('ACTIVE');
    expect(await AuditLogModel.countDocuments({ action: 'PARTNER_CREATED' })).toBe(1);

    const duplicate = await authed(request.post('/api/v1/partners')).send({
      name: 'Other Network',
      company: 'Other LLC',
      contactName: 'Bo Seller',
      contactEmail: 'bo@other.test',
      code: 'ACME-2026',
    }).expect(409);
    expect(duplicate.body.error.code).toBe('PARTNER_CODE_TAKEN');
  });

  it('validates partner payloads', async () => {
    await authed(request.post('/api/v1/partners')).send({ name: 'X', company: 'X', contactName: 'X' }).expect(400);
    await authed(request.post('/api/v1/partners')).send({
      name: 'X', company: 'X', contactName: 'X', contactEmail: 'x@x.test', commissionRatePercent: 90,
    }).expect(400);
  });

  it('registers referrals by code without double counting', async () => {
    const referral = await authed(request.post('/api/v1/partners/referrals')).send({ code: 'ACME-2026', workspaceId }).expect(201);
    expect(referral.body.partner.referrals.customers).toBe(1);

    const again = await authed(request.post('/api/v1/partners/referrals')).send({ code: 'ACME-2026', workspaceId }).expect(201);
    expect(again.body.partner.referrals.customers).toBe(1);

    const leadReferral = await authed(request.post('/api/v1/partners/referrals')).send({ code: 'ACME-2026', leadId }).expect(201);
    expect(leadReferral.body.partner.referrals.leads).toBe(1);
    expect(await AuditLogModel.countDocuments({ action: 'PARTNER_REFERRAL_REGISTERED' })).toBe(2);

    await authed(request.post('/api/v1/partners/referrals')).send({ code: 'NOPE' }).expect(404);
    await authed(request.post('/api/v1/partners/referrals')).send({ code: 'ACME-2026' }).expect(400);
    await authed(request.post('/api/v1/partners/referrals')).send({ code: 'ACME-2026', workspaceId: 'bad-id' }).expect(400);
  });

  it('computes commission from payments actually collected', async () => {
    await PaymentRecordModel.create({
      workspaceId: new Types.ObjectId(workspaceId),
      provider: 'mock',
      paymentId: 'pay-partner-1',
      amount: 99900,
      amountReceived: 99900,
      refundedAmount: 0,
      currency: 'usd',
      status: 'succeeded',
      paid: true,
      activated: true,
      providerCreatedAt: Date.now(),
    });
    const res = await authed(request.get('/api/v1/partners/revenue')).expect(200);
    const row = res.body.partners.find((partner: { code: string }) => partner.code === 'ACME-2026');
    expect(row.payingCustomers).toBe(1);
    expect(row.grossPaidByCurrency.USD).toBe(99900);
    expect(row.commissionByCurrency.USD).toBe(Math.round((99900 * 15) / 100));
    expect(res.body.totals.payingCustomers).toBe(1);
    expect(res.body.totals.commissionByCurrency.USD).toBe(Math.round((99900 * 15) / 100));
  });

  it('lists partners and restricts the channel to administrators', async () => {
    const list = await authed(request.get('/api/v1/partners')).expect(200);
    expect(list.body.partners.some((partner: { partnerId: string }) => partner.partnerId === partnerId)).toBe(true);

    await authed(request.get('/api/v1/partners?status=ACTIVE')).expect(200);
    await authed(request.get('/api/v1/partners?status=NOPE')).expect(400);

    await request.get('/api/v1/partners').expect(401);
    await request.get('/api/v1/partners').set('Authorization', `Bearer ${memberToken}`).expect(403);
    await request.post('/api/v1/partners')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ name: 'M', company: 'M', contactName: 'M', contactEmail: 'm@m.test' })
      .expect(403);
    await request.get('/api/v1/partners/revenue').set('Authorization', `Bearer ${memberToken}`).expect(403);
  });
});
