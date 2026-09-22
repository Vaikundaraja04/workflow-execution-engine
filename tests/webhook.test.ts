import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { createHmac } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createApp } from '../src/api/app.js';
import { SubscriptionModel } from '../src/models/SubscriptionModel.js';
import { WebhookEventModel } from '../src/models/WebhookEventModel.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';
import { normalizeWebhookEvent } from '../src/services/billingWebhookService.js';
import type { AuthConfig } from '../src/auth/jwt.service.js';

/**
 * Phase 15.4 - Billing webhook processing.
 *
 * Signature rejection, normalization, application to the subscription,
 * idempotent redelivery, audit entries and the failed-event retry path.
 */

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;

const authConfig: AuthConfig = {
  jwtSecret: 'test-secret-key-for-webhook-tests',
  accessTtl: '15m',
  refreshTtl: '7d',
};

let workspaceId = '';
let externalSubscriptionId = '';
let secondWorkspaceId = '';

beforeAll(async () => {
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

  const signup = await request.post('/api/v1/saas/signup').send({
    email: 'webhook-owner@acme.test',
    password: 'FounderPass123!',
    name: 'Webhook Owner',
    companyName: 'Webhook Co',
  });
  workspaceId = signup.body.workspace.id;

  const second = await request.post('/api/v1/saas/signup').send({
    email: 'webhook-second@acme.test',
    password: 'FounderPass123!',
    name: 'Second Owner',
    companyName: 'Second Co',
  });
  secondWorkspaceId = second.body.workspace.id;

  const subscription = await SubscriptionModel.findOne({ workspaceId }).lean();
  externalSubscriptionId = subscription?.externalSubscriptionId ?? '';
}, 180000);

afterAll(async () => {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  await mongoose.disconnect();
  await replSet.stop();
}, 30000);

const deliver = (type: string, data: Record<string, unknown>, provider = 'mock') =>
  request
    .post(`/api/v1/billing/webhook?provider=${provider}`)
    .send({ type, data });
describe('Phase 15.4 webhook normalization', () => {
  it('maps provider event names onto the platform vocabulary', () => {
    expect(normalizeWebhookEvent('payment.succeeded')).toBe('payment_success');
    expect(normalizeWebhookEvent('payment_intent.payment_failed')).toBe('payment_failed');
    expect(normalizeWebhookEvent('customer.subscription.created')).toBe('subscription_created');
    expect(normalizeWebhookEvent('customer.subscription.updated')).toBe('subscription_updated');
    expect(normalizeWebhookEvent('customer.subscription.deleted')).toBe('subscription_cancelled');
    expect(normalizeWebhookEvent('invoice.paid')).toBe('invoice_paid');
    expect(normalizeWebhookEvent('something.else')).toBe('unhandled');
  });

  it('rejects a malformed payload before any state change', async () => {
    const response = await request
      .post('/api/v1/billing/webhook?provider=mock')
      .send({ notAnEvent: true });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_WEBHOOK_PAYLOAD');
    expect(await WebhookEventModel.countDocuments()).toBe(0);
  });

  it('rejects a bad stripe signature and applies a correctly signed event', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_webhook';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_webhook_test';

    const payload = {
      type: 'invoice.paid',
      data: { object: { id: externalSubscriptionId } },
    };
    const raw = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000);

    const bad = await request
      .post('/api/v1/billing/webhook?provider=stripe')
      .set('content-type', 'application/json')
      .set('stripe-signature', `t=${timestamp},v1=deadbeef`)
      .send(raw);
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_WEBHOOK_SIGNATURE');

    const signature = createHmac('sha256', 'whsec_webhook_test')
      .update(`${timestamp}.${raw}`)
      .digest('hex');
    const good = await request
      .post('/api/v1/billing/webhook?provider=stripe')
      .set('content-type', 'application/json')
      .set('stripe-signature', `t=${timestamp},v1=${signature}`)
      .send(raw);
    expect(good.status).toBe(200);
    expect(good.body.type).toBe('invoice_paid');
    expect(good.body.applied).toBe(true);
    expect(good.body.provider).toBe('stripe');
  });
});
describe('Phase 15.4 webhook application', () => {
  it('marks the subscription past due on a failed payment and restores it on success', async () => {
    const failed = await deliver('payment.failed', {
      id: externalSubscriptionId,
      event_id: 'evt_mock_failed_1',
    });
    expect(failed.status).toBe(200);
    expect(failed.body.type).toBe('payment_failed');
    expect(failed.body.applied).toBe(true);
    expect((await SubscriptionModel.findOne({ workspaceId }).lean())?.status).toBe('PAST_DUE');

    const paid = await deliver('payment.captured', {
      id: externalSubscriptionId,
      event_id: 'evt_mock_paid_1',
    });
    expect(paid.body.type).toBe('payment_success');
    expect((await SubscriptionModel.findOne({ workspaceId }).lean())?.status).toBe('ACTIVE');
  });

  it('applies a subscription update and a cancellation', async () => {
    const periodEnd = Math.floor(Date.now() / 1000) + 60 * 24 * 60 * 60;
    const updated = await deliver('subscription.updated', {
      id: externalSubscriptionId,
      event_id: 'evt_mock_update_1',
      status: 'trialing',
      current_period_end: periodEnd,
    });
    expect(updated.status).toBe(200);
    expect(updated.body.type).toBe('subscription_updated');
    const subscription = await SubscriptionModel.findOne({ workspaceId }).lean();
    expect(subscription?.status).toBe('TRIALING');
    expect(subscription?.currentPeriodEnd.getTime()).toBe(periodEnd * 1000);

    const cancelled = await deliver('subscription.cancelled', {
      id: externalSubscriptionId,
      event_id: 'evt_mock_cancel_1',
    });
    expect(cancelled.body.type).toBe('subscription_cancelled');
    expect((await SubscriptionModel.findOne({ workspaceId }).lean())?.status).toBe('CANCELLED');
  });

  it('records an unhandled type as ignored instead of dropping it', async () => {
    const response = await deliver('customer.updated', {
      id: externalSubscriptionId,
      event_id: 'evt_mock_unhandled_1',
    });
    expect(response.status).toBe(200);
    expect(response.body.type).toBe('unhandled');
    expect(response.body.status).toBe('IGNORED');
    expect(response.body.applied).toBe(false);
  });
});
describe('Phase 15.4 webhook idempotency and retry', () => {
  it('answers a repeated delivery from the ledger and audits it once', async () => {
    const first = await deliver('payment.failed', {
      id: externalSubscriptionId,
      event_id: 'evt_mock_dup_1',
    });
    expect(first.body.duplicate).toBe(false);

    const second = await deliver('payment.failed', {
      id: externalSubscriptionId,
      event_id: 'evt_mock_dup_1',
    });
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.status).toBe(first.body.status);

    expect(await WebhookEventModel.countDocuments({ provider: 'mock', eventId: 'evt_mock_dup_1' })).toBe(1);
    const audits = await AuditLogModel.find({
      action: 'BILLING_WEBHOOK_RECEIVED',
      resourceId: 'mock:evt_mock_dup_1',
    }).lean();
    expect(audits.length).toBe(1);
    expect(audits[0]?.metadata?.type).toBe('payment_failed');
    expect(JSON.stringify(audits[0]?.metadata)).not.toContain('signature');
  });
  it('creates a subscription when the event names an unknown workspace', async () => {
    const newWorkspaceId = new mongoose.Types.ObjectId().toString();
    const created = await deliver('subscription.created', {
      id: 'sub_created_from_webhook_1',
      customer: 'cus_created_from_webhook_1',
      status: 'active',
      event_id: 'evt_mock_created_1',
      metadata: { workspaceId: newWorkspaceId, plan: 'STARTER' },
    });
    expect(created.status).toBe(200);
    expect(created.body.type).toBe('subscription_created');
    expect(created.body.applied).toBe(true);

    const subscription = await SubscriptionModel.findOne({
      externalSubscriptionId: 'sub_created_from_webhook_1',
    }).lean();
    expect(subscription?.workspaceId.toString()).toBe(newWorkspaceId);
    expect(subscription?.plan).toBe('STARTER');
    expect(subscription?.status).toBe('ACTIVE');
  });
  it('marks a failed application and re-applies it when the provider retries', async () => {
    const invalid = await deliver('subscription.created', {
      id: 'sub_retry_1',
      customer: 'cus_retry_1',
      status: 'active',
      event_id: 'evt_mock_retry_1',
      metadata: { workspaceId: 'not-an-object-id', plan: 'STARTER' },
    });
    expect(invalid.status).toBe(500);
    const failed = await WebhookEventModel.findOne({ provider: 'mock', eventId: 'evt_mock_retry_1' }).lean();
    expect(failed?.status).toBe('FAILED');
    expect(failed?.error).toBeTruthy();

    const retryWorkspaceId = new mongoose.Types.ObjectId().toString();
    const retry = await deliver('subscription.created', {
      id: 'sub_retry_1',
      customer: 'cus_retry_1',
      status: 'active',
      event_id: 'evt_mock_retry_1',
      metadata: { workspaceId: retryWorkspaceId, plan: 'STARTER' },
    });
    expect(retry.status).toBe(200);
    expect(retry.body.applied).toBe(true);
    const applied = await WebhookEventModel.findOne({ provider: 'mock', eventId: 'evt_mock_retry_1' }).lean();
    expect(applied?.status).toBe('APPLIED');
    expect(applied?.error).toBeNull();
  });
});