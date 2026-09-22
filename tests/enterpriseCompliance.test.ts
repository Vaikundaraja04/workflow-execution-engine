import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createApp } from '../src/api/app.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';
import { SecurityEventModel } from '../src/models/SecurityEventModel.js';
import { AIFeaturePolicyModel } from '../src/models/AIGovernancePolicyModel.js';
import { ApprovalRequestModel } from '../src/models/ApprovalRequestModel.js';
import type { AuthConfig } from '../src/auth/jwt.service.js';

/**
 * Phase 18.5 - Compliance center through the app: the posture view built from
 * recorded evidence only (audit coverage, security controls, data access, AI
 * governance), the UNKNOWN-with-excluded-weight behavior on empty windows and
 * the administrator/member scoping.
 */

const authConfig: AuthConfig = {
  jwtSecret: 'test-secret-key-for-enterprise-compliance-18',
  accessTtl: '15m',
  refreshTtl: '7d',
};

const adminEmail = 'compliance-admin@acme.test';
const memberEmail = 'compliance-member@acme.test';

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;
let adminToken = '';
let memberToken = '';
let adminWorkspaceId = '';
let memberWorkspaceId = '';

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

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
    password: 'CompliancePass123!',
    name: 'Compliance Admin',
    companyName: 'Compliance Platform',
  });
  adminToken = admin.body.tokens.accessToken;
  adminWorkspaceId = admin.body.workspace.id;

  const member = await request.post('/api/v1/saas/signup').send({
    email: memberEmail,
    password: 'CompliancePass123!',
    name: 'Compliance Member',
    companyName: 'Compliance Manufacturing',
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
    AuditLogModel.deleteMany({}),
    SecurityEventModel.deleteMany({}),
    AIFeaturePolicyModel.deleteMany({}),
    ApprovalRequestModel.deleteMany({}),
  ]);
});

function sectionOf(report: { sections: Array<{ key: string }> }, key: string) {
  return report.sections.find((section) => section.key === key) as unknown as {
    key: string;
    status: string;
    score: number;
    findings: string[];
    evidence: Record<string, number>;
  };
}

describe('Phase 18.5 compliance center without evidence', () => {
  it('reports UNKNOWN sections and names the excluded weight instead of fabricating a score', async () => {
    const res = await request.get('/api/v1/compliance/center').set(bearer(memberToken));
    expect(res.status).toBe(200);
    expect(res.body.data.workspaceId).toBe(memberWorkspaceId);
    expect(res.body.data.score).toBe(0);
    expect(res.body.data.grade).toBe('D');
    expect(res.body.data.sections).toHaveLength(4);
    for (const section of res.body.data.sections) {
      expect(section.status).toBe('UNKNOWN');
      expect(section.score).toBe(0);
    }
    expect(
      res.body.data.notes.some((note: string) => note.includes('100 points of weight excluded')),
    ).toBe(true);
    expect(await AuditLogModel.countDocuments({ action: 'COMPLIANCE_CENTER_VIEWED' })).toBe(1);
  });

  it('promotes audit coverage once the report audit trail itself is recorded', async () => {
    await request.get('/api/v1/compliance/center').set(bearer(memberToken)).expect(200);
    const second = await request.get('/api/v1/compliance/center').set(bearer(memberToken));
    const auditCoverage = sectionOf(second.body.data, 'auditCoverage');
    expect(auditCoverage.status).toBe('WARN');
    expect(auditCoverage.evidence.entries).toBe(1);
    expect(auditCoverage.findings[0]).toContain('WORKFLOW_CREATED');
    expect(second.body.data.notes.some((note: string) => note.includes('70 points of weight excluded'))).toBe(true);
  });
});
