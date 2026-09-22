import { apiClient } from './apiClient';

/**
 * Phase 15.3/15.5 - Self-serve checkout, payment history and entitlements.
 *
 * Backs the customer billing console: checkout sessions go through the active
 * provider, verification activates the subscription, payment records are the
 * verified snapshots the platform saw, and entitlements are read (never
 * written) because they derive from the subscription.
 */

export type CheckoutRailDTO = 'card' | 'upi' | 'google_pay' | 'netbanking';
export type EntitlementReasonDTO =
  | 'PLAN'
  | 'TRIAL'
  | 'GRACE'
  | 'SUSPENDED'
  | 'NO_SUBSCRIPTION'
  | 'UNKNOWN';

export interface CheckoutSessionDTO {
  id: string;
  clientSecret: string;
  status: string;
  provider: string;
  packageId: string;
  plan: string;
  amount: number;
  currency: string;
  rails: CheckoutRailDTO[];
}

export interface CheckoutPaymentDTO {
  id: string;
  customerId: string | null;
  amount: number;
  amountReceived: number;
  refundedAmount: number;
  currency: string;
  status: string;
  method: string | null;
  paid: boolean;
}

export interface EntitlementFeatureDTO {
  feature: string;
  entitled: boolean;
  reason: EntitlementReasonDTO;
  requiredPlan: string;
}

export interface EntitlementQuotaDTO {
  feature: string;
  limit: number | null;
  used: number | null;
  remaining: number | null;
  percent: number | null;
  exceeded: boolean;
}

export interface EntitlementSummaryDTO {
  workspaceId: string;
  plan: string | null;
  subscriptionStatus: string | null;
  packageId: string | null;
  packageName: string | null;
  features: EntitlementFeatureDTO[];
  quotas: EntitlementQuotaDTO[];
  upgradeTargets: string[];
  generatedAt: string;
}

export interface CheckoutVerificationDTO {
  activated: boolean;
  alreadyActive: boolean;
  reason: 'ACTIVATED' | 'PAYMENT_NOT_SETTLED' | 'ALREADY_ON_PACKAGE';
  payment: CheckoutPaymentDTO;
  subscription: {
    plan: string;
    status: string;
    billingProvider: string;
    currentPeriodStart: string;
    currentPeriodEnd: string;
  } | null;
  entitlements: EntitlementSummaryDTO;
}

export interface PaymentRecordDTO {
  _id: string;
  provider: string;
  paymentId: string;
  customerId: string | null;
  packageId: string | null;
  plan: string | null;
  amount: number;
  amountReceived: number;
  refundedAmount: number;
  currency: string;
  status: string;
  method: string | null;
  paid: boolean;
  activated: boolean;
  providerCreatedAt: number;
  createdAt: string;
}

export const billingConsoleApi = {
  /** Start a checkout session for a sellable package through the active provider. */
  createCheckoutSession: async (input: {
    packageId: string;
    currency?: string;
  }): Promise<CheckoutSessionDTO> => {
    const response = await apiClient.post<{ session: CheckoutSessionDTO }>(
      '/api/v1/billing/checkout',
      input,
    );
    return response.data.session;
  },

  /** Verify a checkout payment; activation happens only when it settled. */
  verifyCheckout: async (input: {
    paymentId: string;
    packageId?: string;
  }): Promise<CheckoutVerificationDTO> => {
    const response = await apiClient.post<CheckoutVerificationDTO>(
      '/api/v1/billing/checkout/verify',
      input,
    );
    return response.data;
  },

  /** Verified payment history for this workspace. */
  getPayments: async (limit: number = 24): Promise<PaymentRecordDTO[]> => {
    const response = await apiClient.get<{ payments: PaymentRecordDTO[] }>(
      '/api/v1/billing/payments',
      { params: { limit } },
    );
    return response.data.payments;
  },

  /** The workspace's evaluated entitlements and quotas. */
  getEntitlements: async (): Promise<EntitlementSummaryDTO> => {
    const response = await apiClient.get<EntitlementSummaryDTO>('/api/v1/entitlements');
    return response.data;
  },
};

export default billingConsoleApi;
