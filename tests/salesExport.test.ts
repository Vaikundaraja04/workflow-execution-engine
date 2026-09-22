import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createApp } from '../src/api/app.js';
import { leadService, followUpStatusFor } from '../src/services/leadService.js';
import { leadExportService, toCsv } from '../src/services/leadExportService.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';
import type { AuthConfig } from '../src/auth/jwt.service.js';

/**
 * Phase 15.7 - CRM-ready lead export and follow-up status.
 */

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;

const authConfig: AuthConfig = {
  jwtSecret: 'test-secret-key-for-sales-export-tests',
  accessTtl: '15m',
  refreshTtl: '7d',
};

const adminEmail = 'sales-export-admin@acme.test';
let adminToken = '';
let memberToken = '';

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
    password: 'FounderPass123!',
    name: 'Sales Admin',
    companyName: 'Sales Co',
  });
  adminToken = admin.body.tokens.accessToken;

  const member = await request.post('/api/v1/saas/signup').send({
    email: 'sales-member@acme.test',
    password: 'FounderPass123!',
    name: 'Sales Member',
    companyName: 'Member Co',
  });
  memberToken = member.body.tokens.accessToken;

  const captured = await leadService.capture({
    company: 'Acme, Inc.',
    contactName: 'Dana "Deal" Reeves',
    contactEmail: 'dana@acme.test',
    industry: 'Technology',
    companySize: '201-1000',
    interest: 'ENTERPRISE',
    source: 'WEBSITE',
  });
  await leadService.update(
    captured.lead.id,
    { estimatedValueMonthly: 49900, tags: ['enterprise', 'inbound'] },
    new mongoose.Types.ObjectId().toString(),
  );
}, 180000);

afterAll(async () => {
  delete process.env.PLATFORM_ADMIN_EMAILS;
  await mongoose.disconnect();
  await replSet.stop();
}, 30000);

describe('Phase 15.7 follow-up status', () => {
  it('derives overdue, due, scheduled and none', () => {
    const now = new Date('2026-01-31T00:00:00.000Z');
    const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    expect(followUpStatusFor({ status: 'WON', lastContactedAt: null, capturedAt: daysAgo(30) }, now)).toBe('none');
    expect(followUpStatusFor({ status: 'LOST', lastContactedAt: null, capturedAt: daysAgo(30) }, now)).toBe('none');
    expect(followUpStatusFor({ status: 'NEW', lastContactedAt: null, capturedAt: daysAgo(9) }, now)).toBe('overdue');
    expect(followUpStatusFor({ status: 'NEW', lastContactedAt: daysAgo(4), capturedAt: daysAgo(20) }, now)).toBe('due');
    expect(followUpStatusFor({ status: 'QUALIFIED', lastContactedAt: daysAgo(1), capturedAt: daysAgo(20) }, now)).toBe('scheduled');
  });

  it('surfaces the follow-up status on the lead row', async () => {
    const result = await leadService.list({});
    expect(result.leads.length).toBeGreaterThan(0);
    expect(['overdue', 'due', 'scheduled', 'none']).toContain(result.leads[0]?.followUpStatus);
  });
});

describe('Phase 15.7 CRM export', () => {
  it('is restricted to platform administrators', async () => {
    const anonymous = await request.get('/api/v1/sales/leads/export');
    expect(anonymous.status).toBe(401);

    const member = await request
      .get('/api/v1/sales/leads/export')
      .set('Authorization', `Bearer ${memberToken}`);
    expect(member.status).toBe(403);
  });
  it('returns csv with the CRM column set and escaped values', async () => {
    const response = await request
      .get('/api/v1/sales/leads/export?format=csv')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('attachment; filename="leads-');
    expect(response.headers['x-export-row-count']).toBe('1');

    const lines = response.text.split('\r\n');
    expect(lines[0]).toContain('contact_email');
    expect(lines[0]).toContain('follow_up_status');
    expect(lines[0]).toContain('score_band');
    expect(lines[1]).toContain('"Acme, Inc."');
    expect(lines[1]).toContain('"Dana ""Deal"" Reeves"');
    expect(lines[1]).toContain('dana@acme.test');

    const audit = await AuditLogModel.findOne({ action: 'LEAD_EXPORTED' }).lean();
    expect(audit?.metadata?.rowCount).toBe(1);
  });

  it('returns json rows with the lifecycle fields', async () => {
    const response = await request
      .get('/api/v1/sales/leads/export?format=json&source=WEBSITE')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(200);
    expect(response.body.rowCount).toBe(1);
    const row = response.body.leads[0];
    expect(row.company).toBe('Acme, Inc.');
    expect(row.industry).toBe('Technology');
    expect(row.scoreBand).toBeDefined();
    expect(row.nextAction).toBeTruthy();
    expect(row.followUpStatus).toBeDefined();
    expect(row.estimatedValueMonthly).toBe(49900);
  });
  it('filters the export by pipeline status', async () => {
    const result = await leadExportService.export({ format: 'json', filters: { status: 'WON' } });
    expect(result.rowCount).toBe(0);
    expect(toCsv([])).toBe(
      'id,company,contact_name,contact_email,contact_phone,industry,company_size,interest,source,status,'
      + 'demo_status,score,score_band,next_action,follow_up_status,owner,estimated_value_monthly,tags,'
      + 'captured_at,last_contacted_at,updated_at',
    );
  });
});