import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  BillingProvider,
  BillingCustomer,
  BillingSubscription,
  BillingInvoice,
  BillingPayment,
} from './billingProvider.js';

type BillingSubscriptionStatus = BillingSubscription['status'];

interface StripeBillingProviderOptions {
  apiBase?: string;
  secretKey?: string;
  webhookSecret?: string;
}

const DEFAULT_API_BASE = 'https://api.stripe.com';
const WEBHOOK_TOLERANCE_SECONDS = 300;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toFormBody(params: Record<string, unknown>): string {
  const parts: string[] = [];
  const append = (key: string, value: unknown): void => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => append(`${key}[${index}]`, item));
      return;
    }
    if (isRecord(value)) {
      for (const [nestedKey, nestedValue] of Object.entries(value)) {
        append(`${key}[${nestedKey}]`, nestedValue);
      }
      return;
    }
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  };
  for (const [key, value] of Object.entries(params)) append(key, value);
  return parts.join('&');
}
function mapSubscriptionStatus(status: unknown): BillingSubscriptionStatus {
  switch (status) {
    case 'active':
    case 'trialing':
    case 'past_due':
    case 'canceled':
    case 'unpaid':
      return status;
    case 'incomplete':
    case 'incomplete_expired':
    case 'paused':
      return 'past_due';
    default:
      return 'unpaid';
  }
}

type BillingPaymentStatus = BillingPayment['status'];

/** Stripe payment_intent.status -> normalized payment status (Phase 14.3). */
function mapPaymentStatus(status: unknown): BillingPaymentStatus {
  switch (status) {
    case 'succeeded':
      return 'succeeded';
    case 'processing':
      return 'processing';
    case 'requires_action':
    case 'requires_confirmation':
    case 'requires_capture':
      return 'requires_action';
    case 'canceled':
      return 'failed';
    default:
      return 'unknown';
  }
}

export class StripeBillingProvider implements BillingProvider {
  private readonly secretKey: string;
  private readonly webhookSecret: string;
  private readonly apiBase: string;

  constructor(options: StripeBillingProviderOptions = {}) {
    const secretKey = options.secretKey ?? process.env.STRIPE_SECRET_KEY;
    if (!secretKey) throw new Error('BILLING_PROVIDER_NOT_CONFIGURED');
    this.secretKey = secretKey;
    this.webhookSecret = options.webhookSecret ?? process.env.STRIPE_WEBHOOK_SECRET ?? '';
    this.apiBase = (options.apiBase ?? process.env.STRIPE_API_BASE ?? DEFAULT_API_BASE).replace(/\/+$/, '');
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetch(`${this.apiBase}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      ...(body ? { body: toFormBody(body) } : {}),
    });
    const payload: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === 'string'
        ? payload.error.message
        : `Stripe request failed with status ${response.status}`;
      throw new Error(`STRIPE_API_ERROR: ${message}`);
    }
    return payload as T;
  }
  private toSubscription(entity: Record<string, unknown>): BillingSubscription {
    const items = isRecord(entity.items) && Array.isArray(entity.items.data) ? entity.items.data : [];
    const firstItem = items.length > 0 && isRecord(items[0]) ? items[0] : null;
    const fallbackStart = Math.floor(Date.now() / 1000);
    const periodStart = Number(entity.current_period_start ?? firstItem?.current_period_start ?? fallbackStart);
    const periodEnd = Number(entity.current_period_end ?? firstItem?.current_period_end ?? periodStart + 30 * 24 * 60 * 60);
    const customer = entity.customer;
    const customerId = typeof customer === 'string'
      ? customer
      : isRecord(customer) && typeof customer.id === 'string'
        ? customer.id
        : '';
    return {
      id: String(entity.id ?? ''),
      customerId,
      status: mapSubscriptionStatus(entity.status),
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      trialEnd: entity.trial_end === null || entity.trial_end === undefined ? null : Number(entity.trial_end),
      cancelAtPeriodEnd: Boolean(entity.cancel_at_period_end),
      canceledAt: entity.canceled_at === null || entity.canceled_at === undefined ? null : Number(entity.canceled_at),
      items: {
        data: items.filter(isRecord).map((item) => {
          const price = isRecord(item.price) ? item.price : {};
          return {
            id: String(item.id ?? ''),
            price: { id: String(price.id ?? '') },
            quantity: Number(item.quantity ?? 1),
          };
        }),
      },
      ...(isRecord(entity.metadata) ? { metadata: entity.metadata as Record<string, string> } : {}),
    };
  }

  async createCustomer(params: {
    email: string;
    name?: string;
    metadata?: Record<string, string>;
  }): Promise<BillingCustomer> {
    const body: Record<string, unknown> = { email: params.email };
    if (params.name !== undefined) body.name = params.name;
    if (params.metadata !== undefined) body.metadata = params.metadata;
    const customer = await this.request<Record<string, unknown>>('POST', '/v1/customers', body);
    return {
      id: String(customer.id ?? ''),
      email: String(customer.email ?? params.email),
      ...(typeof customer.name === 'string' ? { name: customer.name } : {}),
      created: Number(customer.created ?? Math.floor(Date.now() / 1000)),
    };
  }
  async createSubscription(params: {
    customerId: string;
    priceId: string;
    trialEnd?: Date | null;
    metadata?: Record<string, string>;
  }): Promise<BillingSubscription> {
    const body: Record<string, unknown> = {
      customer: params.customerId,
      items: [{ price: params.priceId }],
    };
    if (params.trialEnd) body.trial_end = Math.floor(params.trialEnd.getTime() / 1000);
    if (params.metadata !== undefined) body.metadata = params.metadata;
    const subscription = await this.request<Record<string, unknown>>('POST', '/v1/subscriptions', body);
    return this.toSubscription(subscription);
  }

  async cancelSubscription(params: {
    subscriptionId: string;
    cancelAtPeriodEnd?: boolean;
  }): Promise<BillingSubscription> {
    const subscription = await this.request<Record<string, unknown>>(
      'DELETE',
      `/v1/subscriptions/${encodeURIComponent(params.subscriptionId)}`,
      { cancel_at_period_end: params.cancelAtPeriodEnd ?? false },
    );
    return this.toSubscription(subscription);
  }

  async changeSubscription(params: {
    subscriptionId: string;
    newPriceId: string;
    prorate?: boolean;
    trialEnd?: Date | null;
  }): Promise<BillingSubscription> {
    const body: Record<string, unknown> = {
      items: [{ price: params.newPriceId }],
      proration_behavior: params.prorate === false ? 'none' : 'create_prorations',
    };
    if (params.trialEnd !== undefined) {
      body.trial_end = params.trialEnd ? Math.floor(params.trialEnd.getTime() / 1000) : 'now';
    }
    const subscription = await this.request<Record<string, unknown>>(
      'POST',
      `/v1/subscriptions/${encodeURIComponent(params.subscriptionId)}`,
      body,
    );
    return this.toSubscription(subscription);
  }
  async handleWebhook(requestBody: string, signature: string): Promise<{
    type: string;
    data: Record<string, unknown>;
  }> {
    if (!this.webhookSecret) throw new Error('BILLING_PROVIDER_NOT_CONFIGURED');
    const parsedSignature = this.parseSignatureHeader(signature);
    const timestamp = Number(parsedSignature.timestamp);
    if (!Number.isFinite(timestamp) || timestamp <= 0) throw new Error('INVALID_WEBHOOK_SIGNATURE');
    if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > WEBHOOK_TOLERANCE_SECONDS) {
      throw new Error('INVALID_WEBHOOK_SIGNATURE');
    }
    const expected = createHmac('sha256', this.webhookSecret)
      .update(`${timestamp}.${requestBody}`)
      .digest();
    const provided = Buffer.from(parsedSignature.signature, 'hex');
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      throw new Error('INVALID_WEBHOOK_SIGNATURE');
    }

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(requestBody) as Record<string, unknown>;
    } catch {
      throw new Error('INVALID_WEBHOOK_PAYLOAD');
    }
    const type = typeof event.type === 'string' ? event.type : '';
    const data = isRecord(event.data) && isRecord(event.data.object) ? event.data.object : {};
    if (type === 'invoice.payment_failed') {
      return {
        type,
        data: {
          id: this.invoiceSubscriptionId(data) ?? String(data.id ?? ''),
          customer: data.customer,
          metadata: data.metadata,
        },
      };
    }
    return { type, data };
  }

  private invoiceSubscriptionId(invoice: Record<string, unknown>): string | null {
    if (typeof invoice.subscription === 'string') return invoice.subscription;
    if (isRecord(invoice.parent) && isRecord(invoice.parent.subscription_details)) {
      const subscription = invoice.parent.subscription_details.subscription;
      if (typeof subscription === 'string') return subscription;
    }
    return null;
  }

  private parseSignatureHeader(header: string): { timestamp: number; signature: string } {
    let timestamp = 0;
    let signature = '';
    for (const part of header.split(',')) {
      const [key, value] = part.split('=');
      if (key === 't' && value) timestamp = Number(value);
      if (key === 'v1' && value) signature = value;
    }
    return { timestamp, signature };
  }
  async getSubscription(subscriptionId: string): Promise<BillingSubscription> {
    const subscription = await this.request<Record<string, unknown>>(
      'GET',
      `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
    );
    return this.toSubscription(subscription);
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
      `/v1/invoices?customer=${encodeURIComponent(params.customerId)}&limit=${limit}`,
    );
    const data = Array.isArray(payload.data) ? payload.data : [];
    return data.filter(isRecord).map((invoice) => this.toInvoice(invoice));
  }
  private toInvoice(invoice: Record<string, unknown>): BillingInvoice {
    const allowed = ['draft', 'open', 'paid', 'void', 'uncollectible'] as const;
    const status = typeof invoice.status === 'string' ? invoice.status : 'open';
    const normalized = (allowed as readonly string[]).includes(status)
      ? (status as (typeof allowed)[number])
      : 'open';
    return {
      id: String(invoice.id ?? ''),
      customerId: typeof invoice.customer === 'string' ? invoice.customer : '',
      status: normalized,
      amountDue: Number(invoice.amount_due ?? 0),
      amountPaid: Number(invoice.amount_paid ?? 0),
      currency: String(invoice.currency ?? 'usd'),
      created: Number(invoice.created ?? Math.floor(Date.now() / 1000)),
      dueDate: invoice.due_date === null || invoice.due_date === undefined ? null : Number(invoice.due_date),
      paid: Boolean(invoice.paid),
      attemptCount: Number(invoice.attempt_count ?? 0),
      nextPaymentAttempt: invoice.next_payment_attempt === null || invoice.next_payment_attempt === undefined
        ? null
        : Number(invoice.next_payment_attempt),
      ...(typeof invoice.hosted_invoice_url === 'string' ? { hostedInvoiceUrl: invoice.hosted_invoice_url } : {}),
      ...(typeof invoice.invoice_pdf === 'string' ? { invoicePdf: invoice.invoice_pdf } : {}),
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
      customer: params.customerId,
    };
    if (params.metadata !== undefined) body.metadata = params.metadata;
    const intent = await this.request<Record<string, unknown>>('POST', '/v1/payment_intents', body);
    return {
      clientSecret: String(intent.client_secret ?? ''),
      id: String(intent.id ?? ''),
      status: String(intent.status ?? ''),
    };
  }

  async verifyPayment(params: { paymentId: string }): Promise<BillingPayment> {
    if (!params.paymentId || params.paymentId.trim().length === 0) {
      throw new Error('INVALID_PAYMENT_ID');
    }
    const intent = await this.request<Record<string, unknown>>(
      'GET',
      `/v1/payment_intents/${encodeURIComponent(params.paymentId)}`,
    );
    const methods = Array.isArray(intent.payment_method_types) ? intent.payment_method_types : [];
    const method = methods.length > 0 && typeof methods[0] === 'string' ? methods[0] : null;
    const amount = Number(intent.amount ?? 0);
    const amountReceived = Number(intent.amount_received ?? 0);
    const metadata = isRecord(intent.metadata) ? (intent.metadata as Record<string, string>) : undefined;
    return {
      id: String(intent.id ?? ''),
      customerId: typeof intent.customer === 'string' ? intent.customer : null,
      amount,
      amountReceived,
      currency: String(intent.currency ?? 'usd'),
      status: mapPaymentStatus(intent.status),
      method,
      paid: amountReceived > 0,
      refundedAmount: Math.max(0, amount - amountReceived),
      created: Number(intent.created ?? Math.floor(Date.now() / 1000)),
      ...(metadata ? { metadata } : {}),
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
    const currency = params.currency ?? 'usd';
    const daysUntilDue = Number.isFinite(params.daysUntilDue) && params.daysUntilDue && params.daysUntilDue > 0
      ? Math.floor(params.daysUntilDue)
      : 7;

    if (amount !== null) {
      const itemBody: Record<string, unknown> = {
        customer: params.customerId,
        amount,
        currency,
      };
      if (params.description !== undefined) itemBody.description = params.description;
      await this.request<Record<string, unknown>>('POST', '/v1/invoiceitems', itemBody);
    }

    const invoiceBody: Record<string, unknown> = {
      customer: params.customerId,
      collection_method: 'send_invoice',
      days_until_due: daysUntilDue,
      auto_advance: true,
    };
    if (params.metadata !== undefined) {
      for (const [key, value] of Object.entries(params.metadata)) {
        invoiceBody[`metadata[${key}]`] = value;
      }
    }
    const invoice = await this.request<Record<string, unknown>>('POST', '/v1/invoices', invoiceBody);
    return this.toInvoice(invoice);
  }
}
