'use client';

import * as React from 'react';
import { useCallback, useState } from 'react';
import { ErrorState } from '@/components/ui/ErrorState';
import { Loading } from '@/components/ui/Loading';
import { useResource } from '@/hooks/useResource';
import { GrowthOverview } from '@/features/growth/components/GrowthOverview';
import { FunnelChart } from '@/features/growth/components/FunnelChart';
import { RevenueMetrics } from '@/features/growth/components/RevenueMetrics';
import { CustomerHealthWidget } from '@/features/growth/components/CustomerHealthWidget';
import { SalesPipeline } from '@/features/growth/components/SalesPipeline';
import { growthApi } from '@/services/growthApi';

const WINDOWS = [7, 30, 90] as const;

export default function GrowthDashboardPage() {
  const [days, setDays] = useState<number>(30);
  const load = useCallback(() => growthApi.getDashboard(days), [days]);
  const dashboard = useResource(load);
  const data = dashboard.data;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Growth dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">
            Acquisition through retention on one screen: funnel, revenue, customer health and the
            ranked pipeline, read from recorded events only.
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
        <Loading message="Loading growth dashboard..." />
      ) : dashboard.error || !data ? (
        <ErrorState
          title="Could not load the growth dashboard"
          message={dashboard.error?.message}
          onRetry={dashboard.reload}
        />
      ) : (
        <>
          <GrowthOverview funnel={data.funnel} />
          <div className="grid gap-6 lg:grid-cols-2">
            <FunnelChart funnel={data.funnel} />
            <SalesPipeline report={data.sales} />
          </div>
          <RevenueMetrics
            revenue={data.revenue}
            conversion={data.conversion}
            retention={data.retention}
          />
          <CustomerHealthWidget portfolio={data.customers} />
          <p className="text-xs text-gray-400">
            Funnel window {new Date(data.funnel.window.since).toLocaleDateString()} –{' '}
            {new Date(data.funnel.window.until).toLocaleDateString()} · generated{' '}
            {new Date(data.funnel.generatedAt).toLocaleString()}
          </p>
        </>
      )}
    </div>
  );
}
