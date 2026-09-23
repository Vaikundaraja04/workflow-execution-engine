'use client';

import * as React from 'react';
import { useCallback, useState } from 'react';
import { ErrorState } from '@/components/ui/ErrorState';
import { Loading } from '@/components/ui/Loading';
import { useResource } from '@/hooks/useResource';
import { MarketplaceAnalyticsDashboard } from '@/features/marketplace-analytics/components/MarketplaceAnalyticsDashboard';
import { marketplaceEcosystemApi } from '@/services/marketplaceEcosystemApi';

const WINDOWS = [7, 30, 90] as const;

export default function MarketplaceAnalyticsPage() {
  const [days, setDays] = useState<number>(30);
  const load = useCallback(() => marketplaceEcosystemApi.getPlatformReport({ days }), [days]);
  const report = useResource(load);
  const data = report.data;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Marketplace analytics</h1>
          <p className="mt-1 text-sm text-gray-500">
            Ecosystem-wide GMV, commission, adoption, top assets and publisher growth across every
            tenant. Platform administrators only; a window without transactions reports zeros, never
            estimates.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          Window
          <select
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm"
          >
            {WINDOWS.map((value) => (
              <option key={value} value={value}>
                Last {value} days
              </option>
            ))}
          </select>
        </label>
      </div>

      {report.isLoading ? (
        <Loading message="Loading marketplace analytics..." />
      ) : report.error || !data ? (
        <ErrorState
          title="Could not load marketplace analytics"
          message={report.error?.message}
          onRetry={report.reload}
        />
      ) : (
        <MarketplaceAnalyticsDashboard report={data} />
      )}
    </div>
  );
}