import type { BillingProvider, BillingCustomer, BillingSubscription, BillingInvoice } from './billingProvider.js';

/**
 * Mock Billing Provider for testing and development
 * Implements the BillingProvider interface with in-memory storage
 */

// In-memory stores for the mock
const customers = new Map<string, BillingCustomer>();
const subscriptions = new Map<string, BillingSubscription>();
const invoices = new Map<string, BillingInvoice>();

// Helper to generate unique IDs
function generateId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).substring(2, 11)}`;
}

// Helper to get current timestamp in seconds
function now(): number {
  return Math.floor(Date.now() / 1000);
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
    const subscription = subscriptions.get(params.subscriptionId);
    if (!subscription) {
      throw new Error('Subscription not found');
    }

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
    const subscription = subscriptions.get(params.subscriptionId);
    if (!subscription) {
      throw new Error('Subscription not found');
    }

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
      throw new Error('Invalid JSON in webhook body');
    }

    if (!parsed || typeof parsed.type !== 'string') {
      throw new Error('Invalid webhook event: missing type');
    }

    const dataObj = (parsed.data && typeof parsed.data === 'object') ? (parsed.data as Record<string, unknown>) : {};

    return {
      type: parsed.type,
      data: dataObj,
    };
  }

  async getSubscription(subscriptionId: string): Promise<BillingSubscription> {
    const subscription = subscriptions.get(subscriptionId);
    if (!subscription) {
      throw new Error('Subscription not found');
    }
    return subscription;
  }

  async getInvoice(invoiceId: string): Promise<BillingInvoice> {
    const invoice = invoices.get(invoiceId);
    if (!invoice) {
      throw new Error('Invoice not found');
    }
    return invoice;
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
    return {
      clientSecret: `pi_${id}_secret`,
      id,
      status: 'requires_payment_method',
    };
  }
}
