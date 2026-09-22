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
import { SubscriptionModel } from '../src/models/SubscriptionModel.js';
import { AgentModel } from '../src/models/AgentModel.js';
import { AgentMarketplaceModel } from '../src/models/AgentMarketplaceModel.js';
import { MarketplacePricingModel } from '../src/models/MarketplacePricingModel.js';
import { MarketplaceLicenseModel } from '../src/models/MarketplaceLicenseModel.js';
import { RevenueTransactionModel } from '../src/models/RevenueTransactionModel.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';
import { AgentService } from '../src/services/agent/agentService.js';
import { createBillingProvider } from '../src/services/billing/billingProviderRegistry.js';
/**
 * Phase 17.3 - Marketplace revenue ledger through the API: publisher and
 * platform reports, refund reversal (full and partial), payout batches and the
 * workspace scoping of every query.
 */

const authConfig = {
  jwtSecret: 'test-jwt-secret-for-marketplace-revenue-17',
  accessTtl: '15m',
  refreshTtl: '30d',
};
const PLATFORM_ADMIN_EMAIL = 'ops-admin@platform.test';

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;
let sellerWorkspaceId = '';
let buyerWorkspaceId = '';
let outsiderWorkspaceId = '';
let sellerOwnerId = '';
let buyerOwnerId = '';
let sellerOwnerToken = '';
let buyerOwnerToken = '';
let outsiderOwnerToken = '';
let adminToken = '';

const authHeader = (token: string) => ({ Authorization: `Bearer ${token}` });

async function seedSubscription(workspaceId: string, label: string) {
  const provider = createBillingProvider('mock');
  const customer = await provider.createCustomer({ email: `${label}@revenue.test`, name: label });
  await SubscriptionModel.create({
    workspaceId: new Types.ObjectId(workspaceId),
    plan: 'FREE',
    status: 'ACTIVE',
    billingProvider: 'mock',
    externalCustomerId: customer.id,
    externalSubscriptionId: `sub_${label}`,
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
}
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
    AgentMarketplaceModel.deleteMany({}),
    AgentModel.deleteMany({}),
    MarketplacePricingModel.deleteMany({}),
    MarketplaceLicenseModel.deleteMany({}),
    RevenueTransactionModel.deleteMany({}),
    AuditLogModel.deleteMany({}),
    SubscriptionModel.deleteMany({}),
    WorkspaceMemberModel.deleteMany({}),
    WorkspaceModel.deleteMany({}),
    UserModel.deleteMany({}),
  ]);

  const stamp = new Types.ObjectId().toString();
  const sellerOwner = await UserModel.create({ email: `seller-owner-${stamp}@test.dev`, passwordHash: 'x' });
  const buyerOwner = await UserModel.create({ email: `buyer-owner-${stamp}@test.dev`, passwordHash: 'x' });
  const outsiderOwner = await UserModel.create({ email: `outsider-owner-${stamp}@test.dev`, passwordHash: 'x' });
  const admin = await UserModel.create({ email: PLATFORM_ADMIN_EMAIL, passwordHash: 'x' });
  sellerOwnerId = sellerOwner._id.toString();
  buyerOwnerId = buyerOwner._id.toString();
  sellerOwnerToken = signAccessToken(authConfig, { userId: sellerOwnerId, email: sellerOwner.email });
  buyerOwnerToken = signAccessToken(authConfig, { userId: buyerOwnerId, email: buyerOwner.email });
  outsiderOwnerToken = signAccessToken(authConfig, { userId: outsiderOwner._id.toString(), email: outsiderOwner.email });
  adminToken = signAccessToken(authConfig, { userId: admin._id.toString(), email: admin.email });
  const sellerWorkspace = await WorkspaceModel.create({ name: 'Revenue Seller', slug: `seller-${stamp}`, ownerId: sellerOwner._id });
  sellerWorkspaceId = sellerWorkspace._id.toString();
  const buyerWorkspace = await WorkspaceModel.create({ name: 'Revenue Buyer', slug: `buyer-${stamp}`, ownerId: buyerOwner._id });
  buyerWorkspaceId = buyerWorkspace._id.toString();
  const outsiderWorkspace = await WorkspaceModel.create({ name: 'Revenue Outsider', slug: `outsider-${stamp}`, ownerId: outsiderOwner._id });
  outsiderWorkspaceId = outsiderWorkspace._id.toString();

  const members: Array<[string, string, WorkspaceRole]> = [
    [sellerWorkspaceId, sellerOwnerId, 'OWNER'],
    [buyerWorkspaceId, buyerOwnerId, 'OWNER'],
    [outsiderWorkspaceId, outsiderOwner._id.toString(), 'OWNER'],
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
  await seedSubscription(sellerWorkspaceId, 'seller');
  await seedSubscription(buyerWorkspaceId, 'buyer');
}, 60000);
/** Sell one agent listing to the buyer workspace and return the ledger row. */
async function settlePurchase(paymentId: string) {
  const agent = await AgentService.getInstance().createAgent(sellerWorkspaceId, sellerOwnerId, {
    name: `Revenue Agent ${new Types.ObjectId().toHexString().slice(-6)}`,
    systemPrompt: 'Summarise incidents and propose remediation steps.',
    toolsAllowed: ['calculate'],
  } as never);
  const created = await request
    .post('/api/v1/agent-marketplace/agents')
    .set(authHeader(sellerOwnerToken))
    .set('X-Workspace-Id', sellerWorkspaceId)
    .send({ agentId: agent._id.toString(), visibility: 'PUBLIC' });
  const listingId = created.body.data._id as string;
  await request
    .post(`/api/v1/agent-marketplace/agents/${listingId}/publish`)
    .set(authHeader(sellerOwnerToken))
    .set('X-Workspace-Id', sellerWorkspaceId)
    .send({});
  await request
    .put(`/api/v1/marketplace/agents/${listingId}/pricing`)
    .set(authHeader(sellerOwnerToken))
    .set('X-Workspace-Id', sellerWorkspaceId)
    .send({ pricingModel: 'ONE_TIME_PURCHASE', price: 10000 });
  const settled = await request
    .post(`/api/v1/marketplace/agents/${listingId}/purchase`)
    .set(authHeader(buyerOwnerToken))
    .set('X-Workspace-Id', buyerWorkspaceId)
    .send({ paymentId });
  expect(settled.body.data.settled).toBe(true);
  return settled.body.data.transactionId as string;
}
describe('Phase 17.3 publisher revenue report', () => {
  it('folds the ledger into gross sales, commission and publisher earnings', async () => {
    const transactionId = await settlePurchase('pi_rev_1');
    const res = await request
      .get('/api/v1/marketplace/revenue')
      .set(authHeader(sellerOwnerToken))
      .set('X-Workspace-Id', sellerWorkspaceId);
    expect(res.status).toBe(200);
    expect(res.body.data.publisherWorkspaceId).toBe(sellerWorkspaceId);
    expect(res.body.data.totals).toMatchObject({
      transactions: 1,
      grossSales: 2900,
      platformRevenue: 580,
      publisherEarnings: 2320,
      refunded: 0,
      payouts: 0,
    });
    expect(res.body.data.byCurrency.usd.grossSales).toBe(2900);
    expect(res.body.data.series).toHaveLength(1);
    expect(res.body.data.series[0].transactions).toBe(1);
    expect(res.body.data.recent[0]).toMatchObject({ transactionId, amount: 2900, status: 'AVAILABLE' });
    expect(await RevenueTransactionModel.countDocuments({ transactionId })).toBe(1);
  });

  it('reports zeros and a note when the ledger is empty', async () => {
    const res = await request
      .get('/api/v1/marketplace/revenue')
      .set(authHeader(outsiderOwnerToken))
      .set('X-Workspace-Id', outsiderWorkspaceId);
    expect(res.status).toBe(200);
    expect(res.body.data.totals.transactions).toBe(0);
    expect(res.body.data.totals.grossSales).toBe(0);
    expect(res.body.data.recent).toEqual([]);
  });
});
describe('Phase 17.3 platform revenue and scoping', () => {
  it('reserves the platform-wide report for platform administrators', async () => {
    await settlePurchase('pi_rev_scope');
    const denied = await request
      .get('/api/v1/marketplace/revenue?scope=platform')
      .set(authHeader(sellerOwnerToken))
      .set('X-Workspace-Id', sellerWorkspaceId);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');

    const report = await request
      .get('/api/v1/marketplace/revenue?scope=platform')
      .set(authHeader(adminToken))
      .set('X-Workspace-Id', sellerWorkspaceId);
    expect(report.status).toBe(200);
    expect(report.body.data.totals.grossSales).toBe(2900);
    expect(report.body.data.totals.platformRevenue).toBe(580);
    expect(report.body.data.byAssetType[0]).toMatchObject({ assetType: 'AGENT', grossSales: 2900 });
    expect(report.body.data.topSellers[0]).toMatchObject({ sellerWorkspaceId, grossSales: 2900 });
  });

  it('scopes transaction reads to the calling workspace', async () => {
    await settlePurchase('pi_rev_tx');
    const sellerRows = await request
      .get('/api/v1/marketplace/revenue/transactions')
      .set(authHeader(sellerOwnerToken))
      .set('X-Workspace-Id', sellerWorkspaceId);
    expect(sellerRows.status).toBe(200);
    expect(sellerRows.body.data).toHaveLength(1);
    expect(sellerRows.body.data[0].sellerWorkspaceId).toBe(sellerWorkspaceId);

    const buyerRows = await request
      .get('/api/v1/marketplace/revenue/transactions')
      .set(authHeader(buyerOwnerToken))
      .set('X-Workspace-Id', buyerWorkspaceId);
    expect(buyerRows.status).toBe(200);
    expect(buyerRows.body.data).toHaveLength(0);

    const adminRows = await request
      .get(`/api/v1/marketplace/revenue/transactions?buyerWorkspaceId=${buyerWorkspaceId}`)
      .set(authHeader(adminToken))
      .set('X-Workspace-Id', sellerWorkspaceId);
    expect(adminRows.status).toBe(200);
    expect(adminRows.body.data).toHaveLength(1);
  });
});
describe('Phase 17.3 payouts', () => {
  it('marks the available balance as paid out in one batch', async () => {
    await settlePurchase('pi_payout_1');
    const denied = await request
      .post('/api/v1/marketplace/revenue/payouts')
      .set(authHeader(sellerOwnerToken))
      .set('X-Workspace-Id', sellerWorkspaceId)
      .send({ sellerWorkspaceId });
    expect(denied.status).toBe(403);

    const payout = await request
      .post('/api/v1/marketplace/revenue/payouts')
      .set(authHeader(adminToken))
      .set('X-Workspace-Id', sellerWorkspaceId)
      .send({ sellerWorkspaceId });
    expect(payout.status).toBe(201);
    expect(payout.body.data.transactions).toBe(1);
    expect(payout.body.data.amount).toBe(2320);
    expect(payout.body.data.payoutId).toMatch(/^po_/);

    const rows = await RevenueTransactionModel.find({ sellerWorkspaceId: new Types.ObjectId(sellerWorkspaceId) }).lean();
    expect(rows[0]?.status).toBe('PAID_OUT');
    expect(rows[0]?.payoutId).toBe(payout.body.data.payoutId);

    const report = await request
      .get('/api/v1/marketplace/revenue')
      .set(authHeader(sellerOwnerToken))
      .set('X-Workspace-Id', sellerWorkspaceId);
    expect(report.body.data.totals.payouts).toBe(2320);
    expect(report.body.data.totals.publisherEarnings).toBe(2320);

    const again = await request
      .post('/api/v1/marketplace/revenue/payouts')
      .set(authHeader(adminToken))
      .set('X-Workspace-Id', sellerWorkspaceId)
      .send({ sellerWorkspaceId });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('NO_AVAILABLE_BALANCE');
    expect(await AuditLogModel.countDocuments({ action: 'MARKETPLACE_PAYOUT_RECORDED' })).toBe(1);
  });
});
describe('Phase 17.3 refunds', () => {
  it('reverses a full refund, revokes the license and zeroes the net revenue', async () => {
    const transactionId = await settlePurchase('pi_refund_full');
    const refund = await request
      .post('/api/v1/marketplace/revenue/refund')
      .set(authHeader(adminToken))
      .set('X-Workspace-Id', sellerWorkspaceId)
      .send({ transactionId, reason: 'Customer requested' });
    expect(refund.status).toBe(200);
    expect(refund.body.data).toMatchObject({ transactionId, refundedAmount: 2900, status: 'REFUNDED', fullyRefunded: true });

    const row = await RevenueTransactionModel.findOne({ transactionId }).lean();
    expect(row?.status).toBe('REFUNDED');
    expect(row?.refundedAmount).toBe(2900);

    const license = await MarketplaceLicenseModel.findOne({ workspaceId: new Types.ObjectId(buyerWorkspaceId) });
    expect(license?.status).toBe('REVOKED');
    expect(license?.revokeReason).toBe('Customer requested');

    const report = await request
      .get('/api/v1/marketplace/revenue')
      .set(authHeader(sellerOwnerToken))
      .set('X-Workspace-Id', sellerWorkspaceId);
    expect(report.body.data.totals.grossSales).toBe(2900);
    expect(report.body.data.totals.refunded).toBe(2900);
    expect(report.body.data.totals.platformRevenue).toBe(0);
    expect(report.body.data.totals.publisherEarnings).toBe(0);
    expect(await AuditLogModel.countDocuments({ action: 'MARKETPLACE_REFUND_RECORDED' })).toBe(1);

    const again = await request
      .post('/api/v1/marketplace/revenue/refund')
      .set(authHeader(adminToken))
      .set('X-Workspace-Id', sellerWorkspaceId)
      .send({ transactionId });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('TRANSACTION_ALREADY_REFUNDED');
  });
});
describe('Phase 17.3 partial refunds', () => {
  it('scales the commission with the refunded amount and keeps the license', async () => {
    const transactionId = await settlePurchase('pi_refund_partial');
    const refund = await request
      .post('/api/v1/marketplace/revenue/refund')
      .set(authHeader(adminToken))
      .set('X-Workspace-Id', sellerWorkspaceId)
      .send({ transactionId, amount: 1000, reason: 'Partial credit' });
    expect(refund.status).toBe(200);
    expect(refund.body.data).toMatchObject({ refundedAmount: 1000, status: 'AVAILABLE', fullyRefunded: false });

    const license = await MarketplaceLicenseModel.findOne({ workspaceId: new Types.ObjectId(buyerWorkspaceId) });
    expect(license?.status).toBe('ACTIVE');

    const report = await request
      .get('/api/v1/marketplace/revenue')
      .set(authHeader(sellerOwnerToken))
      .set('X-Workspace-Id', sellerWorkspaceId);
    expect(report.body.data.totals.refunded).toBe(1000);
    expect(report.body.data.totals.platformRevenue).toBe(380);
    expect(report.body.data.totals.publisherEarnings).toBe(1520);
  });

  it('rejects refunds from workspace members and unknown transactions', async () => {
    const transactionId = await settlePurchase('pi_refund_guard');
    const denied = await request
      .post('/api/v1/marketplace/revenue/refund')
      .set(authHeader(sellerOwnerToken))
      .set('X-Workspace-Id', sellerWorkspaceId)
      .send({ transactionId });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');

    const missing = await request
      .post('/api/v1/marketplace/revenue/refund')
      .set(authHeader(adminToken))
      .set('X-Workspace-Id', sellerWorkspaceId)
      .send({ transactionId: 'mt_missing_transaction' });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('TRANSACTION_NOT_FOUND');
  });
});