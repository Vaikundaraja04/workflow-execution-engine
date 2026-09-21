/**
 * Billing Provider Interface
 * Abstracts billing operations to allow multiple providers (Stripe, Razorpay, Paddle, etc.)
 */

export interface BillingCustomer {
  id: string;
  email: string;
  name?: string;
  created: number; // Unix timestamp
}

export interface BillingSubscription {
  id: string;
  customerId: string;
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid';
  currentPeriodStart: number; // Unix timestamp
  currentPeriodEnd: number; // Unix timestamp
  trialEnd?: number | null; // Unix timestamp
  cancelAtPeriodEnd: boolean;
  canceledAt?: number | null; // Unix timestamp
  items: {
    data: Array<{
      id: string;
      price: {
        id: string;
        // Additional price properties can be added as needed
      };
      quantity: number;
    }>;
  };
  metadata?: Record<string, string>;
}

export interface BillingInvoice {
  id: string;
  customerId: string;
  status: 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';
  amountDue: number; // in currency smallest unit (e.g., cents)
  amountPaid: number;
  currency: string;
  created: number; // Unix timestamp
  dueDate?: number | null; // Unix timestamp
  paid: boolean;
  attemptCount: number;
  nextPaymentAttempt?: number | null; // Unix timestamp
  hostedInvoiceUrl?: string;
  invoicePdf?: string;
}

export interface BillingProvider {
  /**
   * Create a customer in the billing system
   */
  createCustomer(params: {
    email: string;
    name?: string;
    metadata?: Record<string, string>;
  }): Promise<BillingCustomer>;

  /**
   * Create a subscription for a customer
   */
  createSubscription(params: {
    customerId: string;
    priceId: string; // The price ID from the billing provider
    trialEnd?: Date | null;
    metadata?: Record<string, string>;
  }): Promise<BillingSubscription>;

  /**
   * Cancel a subscription
   */
  cancelSubscription(params: {
    subscriptionId: string;
    cancelAtPeriodEnd?: boolean;
  }): Promise<BillingSubscription>;

  /**
   * Change subscription plan (upgrade/downgrade)
   */
  changeSubscription(params: {
    subscriptionId: string;
    newPriceId: string;
    prorate?: boolean;
    trialEnd?: Date | null;
  }): Promise<BillingSubscription>;

  /**
   * Handle incoming webhook events from the billing provider
   * Returns the parsed event if verified, throws if verification fails
   */
  handleWebhook(requestBody: string, signature: string): Promise<{
    type: string;
    data: Record<string, unknown>;
  }>;

  /**
   * Get a subscription by ID
   */
  getSubscription(subscriptionId: string): Promise<BillingSubscription>;

  /**
   * Get an invoice by ID
   */
  getInvoice(invoiceId: string): Promise<BillingInvoice>;

  /**
   * List invoices for a customer (most recent first)
   */
  listInvoices(params: {
    customerId: string;
    limit?: number;
  }): Promise<BillingInvoice[]>;

  /**
   * Create a one-time payment (if needed for add-ons, etc.)
   */
  createPaymentIntent(params: {
    amount: number; // in currency smallest unit
    currency: string;
    customerId: string;
    metadata?: Record<string, string>;
  }): Promise<{
    clientSecret: string;
    id: string;
    status: string;
  }>;
}