import type { BillingProvider } from './billingProvider.js';
import { MockBillingProvider } from './mockBillingProvider.js';
import { StripeBillingProvider } from './stripeBillingProvider.js';
import { RazorpayBillingProvider } from './razorpayBillingProvider.js';

export type BillingProviderName = 'mock' | 'stripe' | 'razorpay';

export const BILLING_PROVIDER_NAMES: readonly BillingProviderName[] = ['mock', 'stripe', 'razorpay'];

export function isBillingProviderName(value: string): value is BillingProviderName {
  return (BILLING_PROVIDER_NAMES as readonly string[]).includes(value);
}

export function resolveBillingProviderName(name?: string): BillingProviderName {
  const resolved = (name ?? process.env.BILLING_PROVIDER ?? 'mock').trim().toLowerCase();
  if (!isBillingProviderName(resolved)) throw new Error('INVALID_BILLING_PROVIDER');
  return resolved;
}

export function createBillingProvider(name?: string): BillingProvider {
  switch (resolveBillingProviderName(name)) {
    case 'mock':
      return new MockBillingProvider();
    case 'stripe':
      return new StripeBillingProvider();
    case 'razorpay':
      return new RazorpayBillingProvider();
  }
}
