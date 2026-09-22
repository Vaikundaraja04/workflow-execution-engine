'use client';

import * as React from 'react';
import { useCallback, useState } from 'react';
import { ErrorState } from '@/components/ui/ErrorState';
import { Loading } from '@/components/ui/Loading';
import { useResource } from '@/hooks/useResource';
import { ContentManager } from '@/features/publisher/components/ContentManager';
import { PublisherOverview } from '@/features/publisher/components/PublisherOverview';
import { RevenueChart } from '@/features/publisher/components/RevenueChart';
import { SalesAnalytics } from '@/features/publisher/components/SalesAnalytics';
import { marketplaceEcosystemApi } from '@/services/marketplaceEcosystemApi';

const WINDOWS = [7, 30, 90] as const;

export default function PublisherPortalPage() {
  const [days, setDays] = useState<number>(30);
  const load = useCallback(() => marketplaceEcosystemApi.getPublisherDashboard(days), [days]);
  const dashboard = useResource(load);
  const data = dashboard.data;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Publisher portal</h1>
          <p className="mt-1 text-sm text-gray-500">
            Everything this workspace sells on the marketplace: sales, commission, payouts, licenses
            and content status, folded from recorded transactions only.
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
      {dashboard.isLoading ? (
        <Loading message="Loading publisher dashboard..." />
      ) : dashboard.error || !data ? (
        <ErrorState
          title="Could not load the publisher dashboard"
          message={dashboard.error?.message}
          onRetry={dashboard.reload}
        />
      ) : (
        <>
          <PublisherOverview dashboard={data} />
          <div className="grid gap-6 lg:grid-cols-2">
            <RevenueChart series={data.revenue.series} />
            <SalesAnalytics dashboard={data} />
          </div>
          <ContentManager content={data.content} />
        </>
      )}
    </div>
  );
}