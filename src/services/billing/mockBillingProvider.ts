import type {
  BillingProvider,
  BillingCustomer,
  BillingSubscription,
  BillingInvoice,
  BillingPayment,
} from './billingProvider.js';

/**
 * Mock Billing Provider for testing and development
 * Implements the BillingProvider interface with in-memory storage
 */

// In-memory stores for the mock
const customers = new Map<string, BillingCustomer>();
const subscriptions = new Map<string, BillingSubscription>();
const invoices = new Map<string, BillingInvoice>();
const payments = new Map<string, BillingPayment>();

// Helper to generate unique IDs
function generateId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).substring(2, 11)}`;
}

// Helper to get current timestamp in seconds
function now(): number {
  return Math.floor(Date.now() / 1000);
}

const DEFAULT_PERIOD_SECONDS = 30 * 24 * 60 * 60;

// Adopt subscriptions that exist in the application database but were not
// created through this in-process mock (for example, seeded workspaces), so
// local development can manage them without losing the mock's statefulness.
function adoptInvoice(id: string): BillingInvoice {
  const current = now();
  const invoice: BillingInvoice = {
    id,
    customerId: 'cus_adopted_mock',
    status: 'paid',
    amountDue: 0,
    amountPaid: 2900,
    currency: 'usd',
    created: current,
    dueDate: null,
    paid: true,
    attemptCount: 1,
    nextPaymentAttempt: null,
  };
  invoices.set(id, invoice);
  return invoice;
}

function adoptSubscription(id: string): BillingSubscription {
  const current = now();
  const subscription: BillingSubscription = {
    id,
    customerId: 'cus_adopted_mock',
    status: 'active',
    currentPeriodStart: current,
    currentPeriodEnd: current + DEFAULT_PERIOD_SECONDS,
    trialEnd: null,
    cancelAtPeriodEnd: false,
    items: {
      data: [{
        id: `si_adopted_${id}`,
        price: { id: 'price_adopted_mock' },
        quantity: 1,
      }],
    },
  };
  subscriptions.set(id, subscription);
  return subscription;
}

export class MockBillingProvider implements BillingProvider {
  async createCustomer(params: {
    email: string;
    name?: string;
    metadata?: Record<string, string>;
  }): Promise<BillingCustomer> {
    const id = generateId('cus');
    const customer: BillingCustomer = {
      id,
      email: params.email,
      created: now(),
      ...(params.name !== undefined ? { name: params.name } : {}),
    };
    customers.set(id, customer);
    return customer;
  }

  async createSubscription(params: {
    customerId: string;
    priceId: string;
    trialEnd?: Date | null;
    metadata?: Record<string, string>;
  }): Promise<BillingSubscription> {
    // Validate customer exists
    if (!customers.has(params.customerId)) {
      throw new Error('Customer not found');
    }

    const id = generateId('sub');
    const subscription: BillingSubscription = {
      id,
      customerId: params.customerId,
      status: params.trialEnd ? 'trialing' : 'active',
      currentPeriodStart: now(),
      currentPeriodEnd: now() + 30 * 24 * 60 * 60, // 30 days from now
      trialEnd: params.trialEnd ? Math.floor(params.trialEnd.getTime() / 1000) : null,
      cancelAtPeriodEnd: false,
      items: {
        data: [{
          id: generateId('si'),
          price: {
            id: params.priceId,
          },
          quantity: 1,
        }],
      },
      ...(params.metadata !== undefined ? { metadata: params.metadata } : {}),
    };
    subscriptions.set(id, subscription);
    return subscription;
  }

  async cancelSubscription(params: {
    subscriptionId: string;
    cancelAtPeriodEnd?: boolean;
  }): Promise<BillingSubscription> {
    const subscription = subscriptions.get(params.subscriptionId)
      ?? adoptSubscription(params.subscriptionId);

    // Update subscription
    subscription.cancelAtPeriodEnd = params.cancelAtPeriodEnd ?? false;
    if (!params.cancelAtPeriodEnd) {
      subscription.status = 'canceled';
      subscription.canceledAt = now();
    }
    subscriptions.set(params.subscriptionId, subscription);
    return subscription;
  }

  async changeSubscription(params: {
    subscriptionId: string;
    newPriceId: string;
    prorate?: boolean;
    trialEnd?: Date | null;
  }): Promise<BillingSubscription> {
    const subscription = subscriptions.get(params.subscriptionId)
      ?? adoptSubscription(params.subscriptionId);

    // Update the subscription's price and possibly trial end
    const firstItem = subscription.items.data[0];
    if (firstItem) {
      firstItem.price.id = params.newPriceId;
    }
    if (params.trialEnd !== undefined) {
      subscription.trialEnd = params.trialEnd ? Math.floor(params.trialEnd.getTime() / 1000) : null;
      if (params.trialEnd) {
        subscription.status = 'trialing';
      }
    }
    subscriptions.set(params.subscriptionId, subscription);
    return subscription;
  }

  async handleWebhook(requestBody: string, _signature: string): Promise<{
    type: string;
    data: Record<string, unknown>;
  }> {
    let parsed: any;
    try {
      parsed = JSON.parse(requestBody);
    } catch {
      throw new Error('INVALID_WEBHOOK_PAYLOAD');
    }

    if (!parsed || typeof parsed.type !== 'string') {
      throw new Error('INVALID_WEBHOOK_PAYLOAD');
    }

    const dataObj = (parsed.data && typeof parsed.data === 'object') ? (parsed.data as Record<string, unknown>) : {};

    return {
      type: parsed.type,
      data: dataObj,
    };
  }

  async getSubscription(subscriptionId: string): Promise<BillingSubscription> {
    return subscriptions.get(subscriptionId) ?? adoptSubscription(subscriptionId);
  }

  async getInvoice(invoiceId: string): Promise<BillingInvoice> {
    const invoice = invoices.get(invoiceId)
      ?? adoptInvoice(invoiceId);
    return invoice;
  }

  async listInvoices(params: { customerId: string; limit?: number }): Promise<BillingInvoice[]> {
    const limit = Number.isFinite(params.limit) && params.limit && params.limit > 0
      ? Math.min(100, Math.floor(params.limit))
      : 12;
    const current = now();
    return Array.from({ length: limit }, (_, index) => {
      const periodStart = current - (limit - index) * DEFAULT_PERIOD_SECONDS;
      const invoice: BillingInvoice = {
        id: `in_mock_${params.customerId}_${index + 1}`,
        customerId: params.customerId,
        status: 'paid',
        amountDue: 0,
        amountPaid: 2900,
        currency: 'usd',
        created: periodStart + 5 * 24 * 60 * 60,
        dueDate: periodStart + 12 * 24 * 60 * 60,
        paid: true,
        attemptCount: 1,
        nextPaymentAttempt: null,
      };
      invoices.set(invoice.id, invoice);
      return invoice;
    }).reverse();
  }

  async createPaymentIntent(params: {
    amount: number;
    currency: string;
    customerId: string;
    metadata?: Record<string, string>;
  }): Promise<{
    clientSecret: string;
    id: string;
    status: string;
  }> {
    // Validate customer exists
    if (!customers.has(params.customerId)) {
      throw new Error('Customer not found');
    }

    const id = generateId('pi');
    const payment: BillingPayment = {
      id,
      customerId: params.customerId,
      amount: params.amount,
      amountReceived: 0,
      currency: params.currency,
      status: 'processing',
      method: null,
      paid: false,
      refundedAmount: 0,
      created: now(),
    };
    payments.set(id, payment);
    return {
      clientSecret: `pi_${id}_secret`,
      id,
      status: 'requires_payment_method',
    };
  }

  /**
   * Mock verification: payments created through this provider keep their state,
   * unknown identifiers are adopted as succeeded so local flows can complete.
   */
  async verifyPayment(params: { paymentId: string }): Promise<BillingPayment> {
    const existing = payments.get(params.paymentId);
    if (existing) return existing;
    const adopted: BillingPayment = {
      id: params.paymentId,
      customerId: null,
      amount: 2900,
      amountReceived: 2900,
      currency: 'usd',
      status: 'succeeded',
      method: 'card',
      paid: true,
      refundedAmount: 0,
      created: now(),
    };
    payments.set(adopted.id, adopted);
    return adopted;
  }

  async createInvoice(params: {
    customerId: string;
    description?: string;
    amount?: number;
    currency?: string;
    daysUntilDue?: number;
    metadata?: Record<string, string>;
  }): Promise<BillingInvoice> {
    if (!customers.has(params.customerId)) {
      throw new Error('Customer not found');
    }
    const current = now();
    const amount = Number.isFinite(params.amount) && params.amount && params.amount > 0
      ? Math.floor(params.amount)
      : 2900;
    const daysUntilDue = Number.isFinite(params.daysUntilDue) && params.daysUntilDue && params.daysUntilDue > 0
      ? Math.floor(params.daysUntilDue)
      : 7;
    const invoice: BillingInvoice = {
      id: generateId('in'),
      customerId: params.customerId,
      status: 'open',
      amountDue: amount,
      amountPaid: 0,
      currency: params.currency ?? 'usd',
      created: current,
      dueDate: current + daysUntilDue * 24 * 60 * 60,
      paid: false,
      attemptCount: 0,
      nextPaymentAttempt: null,
    };
    invoices.set(invoice.id, invoice);
    return invoice;
  }
}
