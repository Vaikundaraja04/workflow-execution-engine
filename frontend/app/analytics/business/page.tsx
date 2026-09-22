'use client';

import * as React from 'react';
import { useCallback, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Loading } from '@/components/ui/Loading';
import { ErrorState } from '@/components/ui/ErrorState';
import { useResource } from '@/hooks/useResource';
import { businessAnalyticsApi } from '@/services/businessAnalyticsApi';
import { formatMoney } from '@/features/marketing/components/PackageCatalog';

const WINDOWS = [7, 30, 90] as const;

export default function BusinessAnalyticsPage() {
  const [days, setDays] = useState<number>(30);
  const load = useCallback(() => businessAnalyticsApi.getReport(days), [days]);
  const report = useResource(load);
  const data = report.data;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Business analytics</h1>
          <p className="mt-1 text-sm text-gray-500">
            Funnel, revenue and customer health for the platform, read from real data only.
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
        <Loading message="Loading business analytics..." />
      ) : report.error || !data ? (
        <ErrorState
          title="Could not load business analytics"
          message={report.error?.message}
          onRetry={report.reload}
        />
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Acquisition</CardTitle>
                <CardDescription>
                  {data.window.days}-day funnel: visitors to subscriptions
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-gray-700">
                <p>Visitors: {data.acquisition.visitors.toLocaleString()}</p>
                <p>Signups: {data.acquisition.signups.toLocaleString()}</p>
                <p>Demos: {data.acquisition.demos.toLocaleString()}</p>
                <p>Subscriptions: {data.acquisition.subscriptions.toLocaleString()}</p>
                <p className="text-xs text-gray-500">
                  {data.acquisition.visitToSignupPercent}% visit to signup ·{' '}
                  {data.acquisition.signupToSubscriptionPercent}% signup to subscription
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Revenue</CardTitle>
                <CardDescription>Priced against the sellable catalog</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-gray-700">
                <p className="text-2xl font-semibold text-gray-900">
                  {formatMoney(data.revenue.mrr, data.revenue.currency)} MRR
                </p>
                <p>ARR: {formatMoney(data.revenue.arr, data.revenue.currency)}</p>
                <p>ARPA: {formatMoney(data.revenue.arpa, data.revenue.currency)}</p>
                <p>
                  {data.revenue.payingCustomers} paying ·{' '}
                  {data.revenue.trialingCustomers} trialing
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Customers</CardTitle>
                <CardDescription>Active base, movement and churn</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-gray-700">
                <p>Active: {data.customers.active.toLocaleString()}</p>
                <p>New in window: {data.customers.newInWindow.toLocaleString()}</p>
                <p>Trials ending soon: {data.customers.trialsEndingSoon.toLocaleString()}</p>
                <p>
                  Churned: {data.customers.churned.toLocaleString()} (
                  {data.customers.churnRatePercent}%)
                </p>
                <p className="text-xs text-gray-500">
                  At risk: {data.health.atRisk} of {data.health.evaluated} evaluated
                  customers
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Plan mix</CardTitle>
                <CardDescription>MRR by package</CardDescription>
              </CardHeader>
              <CardContent>
                {data.revenue.planMix.length === 0 ? (
                  <p className="text-sm text-gray-500">No priced subscriptions in this window.</p>
                ) : (
                  <table className="min-w-full divide-y text-sm">
                    <thead>
                      <tr>
                        <th scope="col" className="py-2 text-left font-medium text-gray-500">Package</th>
                        <th scope="col" className="py-2 text-right font-medium text-gray-500">Subscriptions</th>
                        <th scope="col" className="py-2 text-right font-medium text-gray-500">MRR</th>
                        <th scope="col" className="py-2 text-right font-medium text-gray-500">Share</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y text-gray-700">
                      {data.revenue.planMix.map((entry) => (
                        <tr key={entry.packageId}>
                          <td className="py-2">{entry.name}</td>
                          <td className="py-2 text-right">{entry.subscriptions}</td>
                          <td className="py-2 text-right">
                            {formatMoney(entry.mrr, data.revenue.currency)}
                          </td>
                          <td className="py-2 text-right">{entry.sharePercent}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Funnel by source</CardTitle>
                <CardDescription>Landing views, signups and subscriptions per source</CardDescription>
              </CardHeader>
              <CardContent>
                {data.acquisition.bySource.length === 0 ? (
                  <p className="text-sm text-gray-500">No funnel events in this window.</p>
                ) : (
                  <table className="min-w-full divide-y text-sm">
                    <thead>
                      <tr>
                        <th scope="col" className="py-2 text-left font-medium text-gray-500">Source</th>
                        <th scope="col" className="py-2 text-right font-medium text-gray-500">Landing</th>
                        <th scope="col" className="py-2 text-right font-medium text-gray-500">Signups</th>
                        <th scope="col" className="py-2 text-right font-medium text-gray-500">Subscriptions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y text-gray-700">
                      {data.acquisition.bySource.map((entry) => (
                        <tr key={entry.source}>
                          <td className="py-2">{entry.source}</td>
                          <td className="py-2 text-right">{entry.landing}</td>
                          <td className="py-2 text-right">{entry.signups}</td>
                          <td className="py-2 text-right">{entry.subscriptions}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </div>

          <p className="text-xs text-gray-400">
            Window {new Date(data.window.since).toLocaleDateString()} –{' '}
            {new Date(data.window.until).toLocaleDateString()} · generated{' '}
            {new Date(data.generatedAt).toLocaleString()}
          </p>
        </>
      )}
    </div>
  );
}
