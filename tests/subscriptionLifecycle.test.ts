import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { UserModel } from '../src/models/UserModel.js';
import { WorkspaceModel } from '../src/models/WorkspaceModel.js';
import { SubscriptionModel } from '../src/models/SubscriptionModel.js';
import { TenantAccountModel } from '../src/models/TenantAccountModel.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';
import { subscriptionLifecycleService } from '../src/services/subscriptionLifecycleService.js';

let replSet: MongoMemoryReplSet;
let owner: any;
const dayMs = 24 * 60 * 60 * 1000;

async function makeWorkspace(slug: string) {
  const workspace = await WorkspaceModel.create({
    name: slug,
    slug,
    ownerId: owner._id,
  });
  await TenantAccountModel.create({
    workspaceId: workspace._id,
    ownerUserId: owner._id,
    companyName: slug,
    status: 'ACTIVE',
    plan: 'STARTER',
  });
  return workspace;
}

async function makeSubscription(workspaceId: mongoose.Types.ObjectId, overrides: Record<string, unknown>) {
  return SubscriptionModel.create({
    workspaceId,
    plan: 'STARTER',
    status: 'ACTIVE',
    billingProvider: 'mock',
    externalCustomerId: `cus_${workspaceId}`,
    externalSubscriptionId: `sub_${workspaceId}`,
    currentPeriodStart: new Date(Date.now() - 30 * dayMs),
    currentPeriodEnd: new Date(Date.now() + 30 * dayMs),
    ...overrides,
  });
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  owner = await UserModel.create({
    email: 'lifecycle-owner@example.test',
    passwordHash: 'unused-test-password-hash',
  });
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
}, 30000);
describe('subscription lifecycle sweeps', () => {
  it('marks overdue subscriptions past due, expires beyond grace and closes trial/cancelled cases', async () => {
    const graceWorkspace = await makeWorkspace('grace-ws');
    await makeSubscription(graceWorkspace._id, {
      currentPeriodEnd: new Date(Date.now() - 1 * dayMs),
    });

    const expiredWorkspace = await makeWorkspace('expired-ws');
    await makeSubscription(expiredWorkspace._id, {
      currentPeriodEnd: new Date(Date.now() - 10 * dayMs),
    });

    const trialWorkspace = await makeWorkspace('trial-ws');
    await makeSubscription(trialWorkspace._id, {
      status: 'TRIALING',
      trialEndsAt: new Date(Date.now() - 1 * dayMs),
      currentPeriodEnd: new Date(Date.now() - 1 * dayMs),
    });

    const cancelledWorkspace = await makeWorkspace('cancelled-ws');
    await makeSubscription(cancelledWorkspace._id, {
      status: 'CANCELLED',
      currentPeriodEnd: new Date(Date.now() - 1 * dayMs),
    });

    const result = await subscriptionLifecycleService.sweep();
    expect(result.markedPastDue).toBe(2);
    expect(result.expired).toBe(2);

    const grace = await SubscriptionModel.findOne({ workspaceId: graceWorkspace._id });
    expect(grace?.status).toBe('PAST_DUE');

    const trial = await SubscriptionModel.findOne({ workspaceId: trialWorkspace._id });
    expect(trial?.status).toBe('PAST_DUE');

    const expired = await SubscriptionModel.findOne({ workspaceId: expiredWorkspace._id });
    expect(expired?.status).toBe('EXPIRED');
    expect(expired?.plan).toBe('FREE');

    const expiredTenant = await TenantAccountModel.findOne({ workspaceId: expiredWorkspace._id });
    expect(expiredTenant?.plan).toBe('FREE');

    const expiredAudit = await AuditLogModel.findOne({
      action: 'SUBSCRIPTION_EXPIRED',
      workspaceId: expiredWorkspace._id,
    });
    expect(expiredAudit?.metadata?.previousPlan).toBe('STARTER');

    const cancelled = await SubscriptionModel.findOne({ workspaceId: cancelledWorkspace._id });
    expect(cancelled?.status).toBe('EXPIRED');
  });
});

describe('subscription sweep scheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    subscriptionLifecycleService.stopScheduler();
    delete process.env.SUBSCRIPTION_SWEEP_INTERVAL_MS;
  });

  it('refuses to start below the minimum sweep interval', () => {
    delete process.env.SUBSCRIPTION_SWEEP_INTERVAL_MS;
    expect(subscriptionLifecycleService.startScheduler()).toEqual({ started: false, intervalMs: null });

    process.env.SUBSCRIPTION_SWEEP_INTERVAL_MS = '30000';
    expect(subscriptionLifecycleService.startScheduler()).toEqual({ started: false, intervalMs: null });

    process.env.SUBSCRIPTION_SWEEP_INTERVAL_MS = 'later';
    expect(subscriptionLifecycleService.startScheduler()).toEqual({ started: false, intervalMs: null });
  });
  it('sweeps on the configured interval, starts only once and stops cleanly', async () => {
    vi.useFakeTimers();
    process.env.SUBSCRIPTION_SWEEP_INTERVAL_MS = '60000';
    const sweep = vi.spyOn(subscriptionLifecycleService, 'sweep').mockResolvedValue({
      scanned: 0,
      markedPastDue: 0,
      expired: 0,
    });

    expect(subscriptionLifecycleService.startScheduler()).toEqual({ started: true, intervalMs: 60000 });
    expect(subscriptionLifecycleService.startScheduler()).toEqual({ started: false, intervalMs: 60000 });

    await vi.advanceTimersByTimeAsync(60000);
    expect(sweep).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(120000);
    expect(sweep).toHaveBeenCalledTimes(3);

    subscriptionLifecycleService.stopScheduler();
    await vi.advanceTimersByTimeAsync(180000);
    expect(sweep).toHaveBeenCalledTimes(3);

    expect(subscriptionLifecycleService.startScheduler()).toEqual({ started: true, intervalMs: 60000 });
  });
  it('keeps the scheduler alive when a sweep fails', async () => {
    vi.useFakeTimers();
    process.env.SUBSCRIPTION_SWEEP_INTERVAL_MS = '60000';
    const sweep = vi.spyOn(subscriptionLifecycleService, 'sweep').mockRejectedValue(new Error('sweep failed'));

    subscriptionLifecycleService.startScheduler();
    await vi.advanceTimersByTimeAsync(120000);
    expect(sweep).toHaveBeenCalledTimes(2);
  });
});
