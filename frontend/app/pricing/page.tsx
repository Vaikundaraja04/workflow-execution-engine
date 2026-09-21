'use client';

import * as React from 'react';
import Link from 'next/link';
import { MarketingShell } from '@/features/marketing/components/MarketingShell';
import { CallToAction, MarketingHero } from '@/features/marketing/components/MarketingSections';
import { usePlans } from '@/features/customer-console/useCustomerData';
import { formatPrice } from '@/features/customer-console/components/PlanComparison';
import { formatBytes } from '@/features/customer-console/components/UsageDashboard';
import { Loading } from '@/components/ui/Loading';
import { ErrorState } from '@/components/ui/ErrorState';

export default function PricingPage() {
  const plans = usePlans();

  return (
    <MarketingShell>
      <MarketingHero
        eyebrow="Pricing"
        title="Plans priced against real limits"
        description="Each plan sets workflow, execution, member, API key, webhook and storage limits. The catalog below is served live from the billing service."
      />

      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8" aria-label="Plan catalog">
        {plans.isLoading ? (
          <Loading message="Loading plans..." />
        ) : plans.error || !plans.data ? (
          <ErrorState
            title="Could not load the plan catalog"
            message={plans.error?.message}
            onRetry={plans.reload}
          />
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {plans.data.plans.map((plan) => (
              <div
                key={plan.id}
                className="flex flex-col justify-between rounded-xl border border-slate-200 p-5"
              >
                <div>
                  <h2 className="text-base font-semibold text-slate-900">{plan.name}</h2>
                  <p className="mt-1 text-sm text-slate-600">{plan.description}</p>
                  <p className="mt-4 text-2xl font-semibold text-slate-900">
                    {formatPrice(plan.priceMonthly)}
                    <span className="text-sm font-normal text-slate-500">/mo</span>
                  </p>
                  <ul className="mt-4 space-y-1.5 text-sm text-slate-600">
                    <li>{plan.limits.workflows.toLocaleString()} workflows</li>
                    <li>{plan.limits.executionsPerMonth.toLocaleString()} executions / month</li>
                    <li>{plan.limits.members.toLocaleString()} members</li>
                    <li>{plan.limits.apiKeys.toLocaleString()} API keys</li>
                    <li>{formatBytes(plan.limits.storageBytes)} storage</li>
                  </ul>
                </div>
                <Link
                  href="/register"
                  className="mt-6 rounded-lg bg-emerald-600 px-3 py-2 text-center text-sm font-medium text-white transition-colors hover:bg-emerald-700"
                >
                  Start with {plan.name}
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>

      <CallToAction
        title="Start on the free plan"
        description="Upgrade, downgrade or cancel from the customer console whenever the plan stops fitting."
      />
    </MarketingShell>
  );
}
