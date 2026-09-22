'use client';

import * as React from 'react';
import { useAuthStore } from '@/stores/authStore';
import { MarketingShell } from '@/features/marketing/components/MarketingShell';
import { CallToAction, MarketingHero } from '@/features/marketing/components/MarketingSections';
import {
  PackageCards,
  UpgradeDeltas,
} from '@/features/marketing/components/PackageCatalog';
import { useResource } from '@/hooks/useResource';
import { marketingApi } from '@/services/marketingApi';
import type { MarketingPackageId, PlanComparisonDTO } from '@/services/marketingApi';
import { Loading } from '@/components/ui/Loading';
import { ErrorState } from '@/components/ui/ErrorState';

const COMPARISON_PAIRS: Array<{ from: MarketingPackageId; to: MarketingPackageId; label: string }> = [
  { from: 'STARTER', to: 'BUSINESS', label: 'Starter to Business' },
  { from: 'BUSINESS', to: 'ENTERPRISE', label: 'Business to Enterprise' },
];

const loadPricing = async () => {
  const catalog = await marketingApi.getPlans();
  const comparisons = await Promise.all(
    COMPARISON_PAIRS.map(async (pair) => {
      try {
        return { label: pair.label, comparison: await marketingApi.comparePlans(pair.from, pair.to) };
      } catch {
        return null;
      }
    }),
  );
  return {
    catalog,
    comparisons: comparisons.filter(
      (entry): entry is { label: string; comparison: PlanComparisonDTO } => entry !== null,
    ),
  };
};

export default function PricingPage() {
  const pricing = useResource(loadPricing);
  const { isAuthenticated } = useAuthStore();

  return (
    <MarketingShell>
      <MarketingHero
        eyebrow="Pricing"
        title="Plans priced against real limits"
        description="Every package is served live from the billing catalog: workflow, execution, AI, agent and storage limits, the support level and the entitlements it unlocks."
      />

      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8" aria-label="Package catalog">
        {pricing.isLoading ? (
          <Loading message="Loading plans..." />
        ) : pricing.error || !pricing.data ? (
          <ErrorState
            title="Could not load the plan catalog"
            message={pricing.error?.message}
            onRetry={pricing.reload}
          />
        ) : (
          <PackageCards
            plans={pricing.data.catalog.plans}
            freeTier={pricing.data.catalog.freeTier}
            authenticated={isAuthenticated}
          />
        )}
      </section>

      {pricing.data && pricing.data.comparisons.length > 0 ? (
        <section
          className="mx-auto max-w-6xl px-4 pb-12 sm:px-6 lg:px-8"
          aria-label="Upgrade comparison"
        >
          <h2 className="text-lg font-semibold text-slate-900">What changes when you grow</h2>
          <p className="mt-1 mb-6 text-sm text-slate-600">
            The price delta, new entitlements and higher limits between packages, straight from the
            catalog comparison.
          </p>
          <UpgradeDeltas comparisons={pricing.data.comparisons} />
        </section>
      ) : null}

      <CallToAction
        title="Start on the free plan"
        description="Upgrade, downgrade or cancel from the billing console whenever the plan stops fitting."
      />
    </MarketingShell>
  );
}
