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
import { RevenueTransactionModel } from '../src/models/RevenueTransactionModel.js';
import { PartnerMarketplaceModel } from '../src/models/PartnerMarketplaceModel.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';
import { partnerService } from '../src/services/partnerService.js';
import { marketplaceRevenueService } from '../src/services/marketplaceRevenueService.js';
/**
 * Phase 17.8 / 17.6 - The platform ecosystem analytics route and partner
 * solution listings: admin-only writes, published-only discovery and the
 * refund-aware GMV report.
 */

const authConfig = {
  jwtSecret: 'test-jwt-secret-for-ecosystem-analytics-17',
  accessTtl: '15m',
  refreshTtl: '30d',
};
const PLATFORM_ADMIN_EMAIL = 'ecosystem-admin@platform.test';

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;
let sellerWorkspaceId = '';
let buyerWorkspaceId = '';
let sellerOwnerId = '';
let buyerOwnerId = '';
let adminWorkspaceId = '';
let sellerOwnerToken = '';
let buyerOwnerToken = '';
let adminToken = '';

const authHeader = (token: string) => ({ Authorization: `Bearer ${token}` });
beforeAll(async () => {
  process.env.PLATFORM_ADMIN_EMAILS = PLATFORM_ADMIN_EMAIL;
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  request = supertest(createApp({ auth: authConfig, authRateLimit: { loginLimit: 1000, refreshLimit: 1000 } }));
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
}, 30000);

beforeEach(async () => {
  await Promise.all([
    RevenueTransactionModel.deleteMany({}),
    PartnerMarketplaceModel.deleteMany({}),
    AuditLogModel.deleteMany({}),
    WorkspaceMemberModel.deleteMany({}),
    WorkspaceModel.deleteMany({}),
    UserModel.deleteMany({}),
  ]);

  const stamp = new Types.ObjectId().toString();
  const sellerOwner = await UserModel.create({ email: `seller-owner-${stamp}@test.dev`, passwordHash: 'x' });
  const buyerOwner = await UserModel.create({ email: `buyer-owner-${stamp}@test.dev`, passwordHash: 'x' });
  const admin = await UserModel.create({ email: PLATFORM_ADMIN_EMAIL, passwordHash: 'x' });
  sellerOwnerId = sellerOwner._id.toString();
  buyerOwnerId = buyerOwner._id.toString();
  sellerOwnerToken = signAccessToken(authConfig, { userId: sellerOwnerId, email: sellerOwner.email });
  buyerOwnerToken = signAccessToken(authConfig, { userId: buyerOwnerId, email: buyerOwner.email });
  adminToken = signAccessToken(authConfig, { userId: admin._id.toString(), email: admin.email });
  const sellerWorkspace = await WorkspaceModel.create({ name: 'Ecosystem Seller', slug: `seller-${stamp}`, ownerId: sellerOwner._id });
  sellerWorkspaceId = sellerWorkspace._id.toString();
  const buyerWorkspace = await WorkspaceModel.create({ name: 'Ecosystem Buyer', slug: `buyer-${stamp}`, ownerId: buyerOwner._id });
  buyerWorkspaceId = buyerWorkspace._id.toString();
  const adminWorkspace = await WorkspaceModel.create({ name: 'Ecosystem Admin', slug: `admin-${stamp}`, ownerId: admin._id });
  adminWorkspaceId = adminWorkspace._id.toString();

  const members: Array<[string, string, WorkspaceRole]> = [
    [sellerWorkspaceId, sellerOwnerId, 'OWNER'],
    [buyerWorkspaceId, buyerOwnerId, 'OWNER'],
    [adminWorkspaceId, admin._id.toString(), 'OWNER'],
  ];
  for (const [wsId, userId, role] of members) {
    await WorkspaceMemberModel.create({
      workspaceId: new Types.ObjectId(wsId),
      userId: new Types.ObjectId(userId),
      role,
      status: 'ACTIVE',
      permissions: permissionsForRole(role),
    });
  }
}, 60000);

async function recordSale(paymentId: string) {
  return marketplaceRevenueService.recordTransaction({
    buyerWorkspaceId,
    sellerWorkspaceId,
    publisherId: sellerOwnerId,
    assetType: 'AGENT',
    assetId: new Types.ObjectId().toString(),
    amount: 10000,
    currency: 'usd',
    revenueSharePercentage: 80,
    paymentId,
    provider: 'mock',
  });
}
describe('Phase 17.8 ecosystem analytics route', () => {
  it('reports GMV, adoption and top assets to platform administrators', async () => {
    const sale = await recordSale('pi_eco_1');
    expect(sale.platformCommission).toBe(2000);
    expect(sale.publisherEarnings).toBe(8000);

    const res = await request
      .get('/api/v1/analytics/marketplace')
      .set(authHeader(adminToken))
      .set('X-Workspace-Id', sellerWorkspaceId);
    expect(res.status).toBe(200);
    expect(res.body.data.gmv).toMatchObject({
      transactions: 1,
      grossSales: 10000,
      netGrossSales: 10000,
      platformRevenue: 2000,
      publisherEarnings: 8000,
      refunded: 0,
    });
    expect(res.body.data.topAssets).toHaveLength(1);
    expect(res.body.data.topAssets[0]).toMatchObject({
      assetType: 'AGENT',
      sales: 1,
      grossSales: 10000,
      publisherEarnings: 8000,
    });
    const growth = res.body.data.publisherGrowth as Array<{ month: string; newPublishers: number; grossSales: number }>;
    const current = growth[growth.length - 1]!;
    expect(current.grossSales).toBe(10000);
    expect(current.newPublishers).toBeGreaterThanOrEqual(1);
    expect(await AuditLogModel.countDocuments({ action: 'MARKETPLACE_ANALYTICS_VIEWED' })).toBe(1);
  });

  it('nets refunds out of the reported GMV', async () => {
    const sale = await recordSale('pi_eco_2');
    await marketplaceRevenueService.refundTransaction(sale.transactionId, { amount: 4000 });

    const res = await request
      .get('/api/v1/analytics/marketplace?days=30')
      .set(authHeader(adminToken))
      .set('X-Workspace-Id', sellerWorkspaceId);
    expect(res.status).toBe(200);
    expect(res.body.data.gmv.grossSales).toBe(10000);
    expect(res.body.data.gmv.refunded).toBe(4000);
    expect(res.body.data.gmv.netGrossSales).toBe(6000);
    expect(res.body.data.gmv.platformRevenue).toBe(1200);
    expect(res.body.data.gmv.publisherEarnings).toBe(4800);
  });

  it('reserves the ecosystem report for platform administrators', async () => {
    const denied = await request
      .get('/api/v1/analytics/marketplace')
      .set(authHeader(sellerOwnerToken))
      .set('X-Workspace-Id', sellerWorkspaceId);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');
  });
});
describe('Phase 17.6 partner solution listings', () => {
  async function createPartner(name: string) {
    return partnerService.createPartner({
      name,
      company: `${name} Inc`,
      contactName: 'Eva Lind',
      contactEmail: 'eva@nordic.test',
      tier: 'GOLD',
      commissionRatePercent: 15,
    }, sellerOwnerId);
  }

  it('publishes, discovers and archives a partner solution', async () => {
    const partner = await createPartner('Nordic Automation');
    const created = await request
      .post(`/api/v1/partners/${partner.partnerId}/solutions`)
      .set(authHeader(adminToken))
      .set('X-Workspace-Id', sellerWorkspaceId)
      .send({
        title: 'Incident Response Package',
        description: 'Packaged operations solution with onboarding',
        listingType: 'SOLUTION',
        industryTags: ['operations'],
        commissionRatePercent: 15,
      });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      partnerId: partner.partnerId,
      partnerName: 'Nordic Automation',
      status: 'PUBLISHED',
      listingType: 'SOLUTION',
      commissionRatePercent: 15,
    });
    expect(await AuditLogModel.countDocuments({ action: 'PARTNER_SOLUTION_PUBLISHED' })).toBe(1);
    const listed = await request
      .get('/api/v1/partners/solutions')
      .set(authHeader(sellerOwnerToken))
      .set('X-Workspace-Id', sellerWorkspaceId);
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0].title).toBe('Incident Response Package');

    const archived = await request
      .patch(`/api/v1/partners/solutions/${created.body.data.solutionId}`)
      .set(authHeader(adminToken))
      .set('X-Workspace-Id', sellerWorkspaceId)
      .send({ status: 'ARCHIVED' });
    expect(archived.status).toBe(200);
    expect(archived.body.data.status).toBe('ARCHIVED');

    const afterArchive = await request
      .get('/api/v1/partners/solutions')
      .set(authHeader(sellerOwnerToken))
      .set('X-Workspace-Id', sellerWorkspaceId);
    expect(afterArchive.body.data).toHaveLength(0);

    const adminView = await request
      .get('/api/v1/partners/solutions?status=ARCHIVED')
      .set(authHeader(adminToken))
      .set('X-Workspace-Id', adminWorkspaceId);
    expect(adminView.body.data).toHaveLength(1);
  });

  it('reserves partner solution writes for platform administrators', async () => {
    const partner = await createPartner('Blocked Partner');
    const denied = await request
      .post(`/api/v1/partners/${partner.partnerId}/solutions`)
      .set(authHeader(sellerOwnerToken))
      .set('X-Workspace-Id', sellerWorkspaceId)
      .send({ title: 'Not allowed', description: 'Should be refused' });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');

    const missing = await request
      .post(`/api/v1/partners/${new Types.ObjectId().toString()}/solutions`)
      .set(authHeader(adminToken))
      .set('X-Workspace-Id', sellerWorkspaceId)
      .send({ title: 'Unknown partner', description: 'No partner record' });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('PARTNER_NOT_FOUND');
  });
});