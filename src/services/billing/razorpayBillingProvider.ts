import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  BillingProvider,
  BillingCustomer,
  BillingSubscription,
  BillingInvoice,
  BillingPayment,
} from './billingProvider.js';

type BillingSubscriptionStatus = BillingSubscription['status'];
type BillingPaymentStatus = BillingPayment['status'];

/**
 * Razorpay payment method -> normalized rail. UPI and Google Pay are first-class
 * rails for the India market (Phase 14.3).
 */
function mapPaymentMethod(method: unknown, wallet: unknown): string | null {
  if (typeof method !== 'string' || method.length === 0) return null;
  if (method === 'wallet' && typeof wallet === 'string' && wallet.toLowerCase() === 'google_pay') {
    return 'google_pay';
  }
  if (method === 'upi') return 'upi';
  if (method === 'card') return 'card';
  if (method === 'netbanking') return 'netbanking';
  return method;
}

function mapPaymentStatus(status: unknown): BillingPaymentStatus {
  switch (status) {
    case 'captured':
      return 'succeeded';
    case 'authorized':
      return 'processing';
    case 'created':
      return 'requires_action';
    case 'failed':
      return 'failed';
    case 'refunded':
      return 'refunded';
    default:
      return 'unknown';
  }
}

interface RazorpayBillingProviderOptions {
  apiBase?: string;
  keyId?: string;
  keySecret?: string;
  webhookSecret?: string;
}

const DEFAULT_API_BASE = 'https://api.razorpay.com';
const DEFAULT_PERIOD_SECONDS = 30 * 24 * 60 * 60;
const SUBSCRIPTION_CYCLES = 120;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toUnixSeconds(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}
export class RazorpayBillingProvider implements BillingProvider {
  private readonly keyId: string;
  private readonly keySecret: string;
  private readonly webhookSecret: string;
  private readonly apiBase: string;

  constructor(options: RazorpayBillingProviderOptions = {}) {
    const keyId = options.keyId ?? process.env.RAZORPAY_KEY_ID;
    const keySecret = options.keySecret ?? process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) throw new Error('BILLING_PROVIDER_NOT_CONFIGURED');
    this.keyId = keyId;
    this.keySecret = keySecret;
    this.webhookSecret = options.webhookSecret ?? process.env.RAZORPAY_WEBHOOK_SECRET ?? '';
    this.apiBase = (options.apiBase ?? process.env.RAZORPAY_API_BASE ?? DEFAULT_API_BASE).replace(/\/+$/, '');
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetch(`${this.apiBase}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const payload: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = isRecord(payload) && isRecord(payload.error) && typeof payload.error.description === 'string'
        ? payload.error.description
        : `Razorpay request failed with status ${response.status}`;
      throw new Error(`RAZORPAY_API_ERROR: ${message}`);
    }
    return payload as T;
  }
  private mapStatus(status: unknown, startAt: number | null): BillingSubscriptionStatus {
    const now = Math.floor(Date.now() / 1000);
    switch (status) {
      case 'active':
      case 'authenticated':
        return 'active';
      case 'created':
        return startAt !== null && startAt > now ? 'trialing' : 'active';
      case 'pending':
      case 'halted':
      case 'paused':
        return 'past_due';
      case 'cancelled':
      case 'expired':
      case 'completed':
        return 'canceled';
      default:
        return 'unpaid';
    }
  }

  private toSubscription(entity: Record<string, unknown>): BillingSubscription {
    const now = Math.floor(Date.now() / 1000);
    const startAt = toUnixSeconds(entity.start_at);
    const currentStart = toUnixSeconds(entity.current_start) ?? startAt ?? now;
    const currentEnd = toUnixSeconds(entity.current_end)
      ?? (startAt !== null && startAt > now ? startAt : currentStart + DEFAULT_PERIOD_SECONDS);
    const trialEnd = startAt !== null && startAt > now ? startAt : null;
    return {
      id: String(entity.id ?? ''),
      customerId: String(entity.customer_id ?? ''),
      status: this.mapStatus(entity.status, startAt),
      currentPeriodStart: currentStart,
      currentPeriodEnd: currentEnd,
      trialEnd,
      cancelAtPeriodEnd: entity.cancel_at_cycle_end === 1 || entity.cancel_at_cycle_end === true,
      canceledAt: toUnixSeconds(entity.cancelled_at) ?? toUnixSeconds(entity.ended_at),
      items: {
        data: [{
          id: String(entity.id ?? ''),
          price: { id: String(entity.plan_id ?? '') },
          quantity: Number(entity.quantity ?? 1),
        }],
      },
      ...(isRecord(entity.notes) ? { metadata: entity.notes as Record<string, string> } : {}),
    };
  }
  async createCustomer(params: {
    email: string;
    name?: string;
    metadata?: Record<string, string>;
  }): Promise<BillingCustomer> {
    const body: Record<string, unknown> = {
      name: params.name ?? params.email,
      email: params.email,
      fail_existing: 0,
    };
    if (params.metadata !== undefined) body.notes = params.metadata;
    const customer = await this.request<Record<string, unknown>>('POST', '/v1/customers', body);
    return {
      id: String(customer.id ?? ''),
      email: String(customer.email ?? params.email),
      ...(typeof customer.name === 'string' ? { name: customer.name } : {}),
      created: toUnixSeconds(customer.created_at) ?? Math.floor(Date.now() / 1000),
    };
  }

  async createSubscription(params: {
    customerId: string;
    priceId: string;
    trialEnd?: Date | null;
    metadata?: Record<string, string>;
  }): Promise<BillingSubscription> {
    const body: Record<string, unknown> = {
      plan_id: params.priceId,
      customer_id: params.customerId,
      total_count: SUBSCRIPTION_CYCLES,
      quantity: 1,
      customer_notify: 0,
    };
    if (params.trialEnd) body.start_at = Math.floor(params.trialEnd.getTime() / 1000);
    if (params.metadata !== undefined) body.notes = params.metadata;
    const subscription = await this.request<Record<string, unknown>>('POST', '/v1/subscriptions', body);
    return this.toSubscription(subscription);
  }
  async cancelSubscription(params: {
    subscriptionId: string;
    cancelAtPeriodEnd?: boolean;
  }): Promise<BillingSubscription> {
    const entity = await this.request<Record<string, unknown>>(
      'POST',
      `/v1/subscriptions/${encodeURIComponent(params.subscriptionId)}/cancel`,
      { cancel_at_cycle_end: params.cancelAtPeriodEnd ? 1 : 0 },
    );
    return this.toSubscription(isRecord(entity) ? entity : {});
  }

  async changeSubscription(params: {
    subscriptionId: string;
    newPriceId: string;
    prorate?: boolean;
    trialEnd?: Date | null;
  }): Promise<BillingSubscription> {
    const body: Record<string, unknown> = {
      plan_id: params.newPriceId,
      schedule_change_at: params.prorate === false ? 'cycle_end' : 'now',
      customer_notify: 0,
    };
    const entity = await this.request<Record<string, unknown>>(
      'PATCH',
      `/v1/subscriptions/${encodeURIComponent(params.subscriptionId)}`,
      body,
    );
    const subscription = this.toSubscription(isRecord(entity) ? entity : {});
    if (params.trialEnd) {
      const trialEnd = Math.floor(params.trialEnd.getTime() / 1000);
      return { ...subscription, status: 'trialing', trialEnd, currentPeriodEnd: Math.max(subscription.currentPeriodEnd, trialEnd) };
    }
    return subscription;
  }

  async getSubscription(subscriptionId: string): Promise<BillingSubscription> {
    const entity = await this.request<Record<string, unknown>>(
      'GET',
      `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
    );
    return this.toSubscription(isRecord(entity) ? entity : {});
  }
  async getInvoice(invoiceId: string): Promise<BillingInvoice> {
    const invoice = await this.request<Record<string, unknown>>(
      'GET',
      `/v1/invoices/${encodeURIComponent(invoiceId)}`,
    );
    return this.toInvoice(invoice);
  }

  async listInvoices(params: { customerId: string; limit?: number }): Promise<BillingInvoice[]> {
    const limit = Number.isFinite(params.limit) && params.limit && params.limit > 0
      ? Math.min(100, Math.floor(params.limit))
      : 12;
    const payload = await this.request<Record<string, unknown>>(
      'GET',
      `/v1/invoices?customer_id=${encodeURIComponent(params.customerId)}&count=${limit}`,
    );
    const items = Array.isArray(payload.items) ? payload.items : [];
    return items.filter(isRecord).map((invoice) => this.toInvoice(invoice));
  }

  private toInvoice(invoice: Record<string, unknown>): BillingInvoice {
    const status = typeof invoice.status === 'string' ? invoice.status : 'issued';
    const normalized = status === 'paid'
      ? 'paid'
      : status === 'draft'
        ? 'draft'
        : status === 'cancelled' || status === 'expired'
          ? 'void'
          : 'open';
    return {
      id: String(invoice.id ?? ''),
      customerId: String(invoice.customer_id ?? ''),
      status: normalized,
      amountDue: Number(invoice.amount ?? 0) - Number(invoice.amount_paid ?? 0),
      amountPaid: Number(invoice.amount_paid ?? 0),
      currency: String(invoice.currency ?? 'INR'),
      created: toUnixSeconds(invoice.created_at) ?? Math.floor(Date.now() / 1000),
      dueDate: toUnixSeconds(invoice.due_date),
      paid: invoice.paid_at !== null && invoice.paid_at !== undefined,
      attemptCount: 1,
      nextPaymentAttempt: null,
      ...(typeof invoice.short_url === 'string' ? { hostedInvoiceUrl: invoice.short_url } : {}),
    };
  }
  async createPaymentIntent(params: {
    amount: number;
    currency: string;
    customerId: string;
    metadata?: Record<string, string>;
  }): Promise<{ clientSecret: string; id: string; status: string }> {
    const body: Record<string, unknown> = {
      amount: params.amount,
      currency: params.currency,
      customer_id: params.customerId,
      receipt: `rcpt_${Date.now()}`,
    };
    if (params.metadata !== undefined) body.notes = params.metadata;
    // Razorpay orders accept UPI, Google Pay and cards on the same checkout.
    body.payment_capture = true;
    const order = await this.request<Record<string, unknown>>('POST', '/v1/orders', body);
    const id = String(order.id ?? '');
    return { clientSecret: id, id, status: String(order.status ?? '') };
  }

  async verifyPayment(params: { paymentId: string }): Promise<BillingPayment> {
    if (!params.paymentId || params.paymentId.trim().length === 0) {
      throw new Error('INVALID_PAYMENT_ID');
    }
    const payment = await this.request<Record<string, unknown>>(
      'GET',
      `/v1/payments/${encodeURIComponent(params.paymentId)}`,
    );
    const amount = Number(payment.amount ?? 0);
    const amountRefunded = Number(payment.amount_refunded ?? 0);
    return {
      id: String(payment.id ?? ''),
      customerId: typeof payment.customer_id === 'string' ? payment.customer_id : null,
      amount,
      amountReceived: amount - amountRefunded,
      currency: String(payment.currency ?? 'INR'),
      status: mapPaymentStatus(payment.status),
      method: mapPaymentMethod(payment.method, payment.wallet),
      paid: String(payment.status ?? '') === 'captured',
      refundedAmount: amountRefunded,
      created: toUnixSeconds(payment.created_at) ?? Math.floor(Date.now() / 1000),
      ...(isRecord(payment.notes) ? { metadata: payment.notes as Record<string, string> } : {}),
    };
  }

  async createInvoice(params: {
    customerId: string;
    description?: string;
    amount?: number;
    currency?: string;
    daysUntilDue?: number;
    metadata?: Record<string, string>;
  }): Promise<BillingInvoice> {
    if (!params.customerId) throw new Error('INVALID_REQUEST');
    const amount = Number.isFinite(params.amount) && params.amount && params.amount > 0
      ? Math.floor(params.amount)
      : null;
    const body: Record<string, unknown> = {
      customer_id: params.customerId,
      type: 'invoice',
      currency: params.currency ?? 'INR',
      ...(amount !== null
        ? {
            line_items: [
              {
                amount,
                currency: params.currency ?? 'INR',
                name: params.description ?? 'Subscription charges',
                quantity: 1,
              },
            ],
          }
        : {}),
      ...(params.metadata !== undefined ? { notes: params.metadata } : {}),
    };
    const invoice = await this.request<Record<string, unknown>>('POST', '/v1/invoices', body);
    const existing = await this.getInvoiceFromEntity(invoice);
    return existing;
  }

  private async getInvoiceFromEntity(entity: Record<string, unknown>): Promise<BillingInvoice> {
    const id = String(entity.id ?? '');
    if (!id) throw new Error('RAZORPAY_API_ERROR: invoice id missing in response');
    const allowed = ['draft', 'open', 'paid', 'void', 'uncollectible'] as const;
    const status = typeof entity.status === 'string' ? entity.status : 'draft';
    const normalized = status === 'issued'
      ? 'open'
      : (allowed as readonly string[]).includes(status)
        ? (status as (typeof allowed)[number])
        : 'draft';
    const amount = Number(entity.amount ?? 0);
    const amountPaid = Number(entity.amount_paid ?? 0);
    return {
      id,
      customerId: String(entity.customer_id ?? ''),
      status: normalized,
      amountDue: amount - amountPaid,
      amountPaid,
      currency: String(entity.currency ?? 'INR'),
      created: toUnixSeconds(entity.created_at) ?? Math.floor(Date.now() / 1000),
      dueDate: toUnixSeconds(entity.due_date),
      paid: Boolean(entity.paid_at),
      attemptCount: 1,
      nextPaymentAttempt: null,
      ...(typeof entity.short_url === 'string' ? { hostedInvoiceUrl: entity.short_url } : {}),
    };
  }
  async handleWebhook(requestBody: string, signature: string): Promise<{
    type: string;
    data: Record<string, unknown>;
  }> {
    if (!this.webhookSecret) throw new Error('BILLING_PROVIDER_NOT_CONFIGURED');
    const expected = createHmac('sha256', this.webhookSecret).update(requestBody).digest();
    const provided = Buffer.from(signature, 'hex');
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      throw new Error('INVALID_WEBHOOK_SIGNATURE');
    }

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(requestBody) as Record<string, unknown>;
    } catch {
      throw new Error('INVALID_WEBHOOK_PAYLOAD');
    }
    const type = typeof event.event === 'string' ? event.event : '';
    const payload = isRecord(event.payload) ? event.payload : {};
    const entity = this.entityFromPayload(payload);
    return { type, data: this.toInternalWebhookData(type, entity) };
  }

  private entityFromPayload(payload: Record<string, unknown>): Record<string, unknown> {
    for (const key of ['subscription', 'payment', 'invoice']) {
      const container = payload[key];
      if (isRecord(container) && isRecord(container.entity)) return container.entity;
    }
    return {};
  }

  private toInternalWebhookData(eventType: string, entity: Record<string, unknown>): Record<string, unknown> {
    if (eventType.startsWith('payment.') || eventType.startsWith('invoice.')) {
      return {
        id: String(entity.subscription_id ?? entity.id ?? ''),
        customer: entity.customer_id,
        metadata: entity.notes,
      };
    }
    const startAt = toUnixSeconds(entity.start_at);
    const now = Math.floor(Date.now() / 1000);
    return {
      id: String(entity.id ?? ''),
      customer: entity.customer_id,
      status: entity.status,
      current_period_start: toUnixSeconds(entity.current_start) ?? startAt ?? now,
      current_period_end: toUnixSeconds(entity.current_end) ?? startAt ?? now + DEFAULT_PERIOD_SECONDS,
      trial_end: startAt !== null && startAt > now ? startAt : null,
      metadata: entity.notes,
    };
  }
}
