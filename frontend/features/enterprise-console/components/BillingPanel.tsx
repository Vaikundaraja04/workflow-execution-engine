'use client';

import { useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { ErrorState } from '@/components/ui/ErrorState';
import { Loading } from '@/components/ui/Loading';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import { useResource } from '@/hooks/useResource';
import { formatMoney } from '@/features/marketing/components/PackageCatalog';
import { businessAnalyticsApi } from '@/services/businessAnalyticsApi';

export function BillingPanel({ days }: { days: number }) {
  const load = useCallback(() => businessAnalyticsApi.getReport(days), [days]);
  const report = useResource(load);

  if (report.isLoading) return <Loading message="Loading billing analytics..." />;
  if (report.error || !report.data) {
    return (
      <ErrorState
        title="Could not load billing analytics"
        message={report.error?.message}
        onRetry={report.reload}
      />
    );
  }

  const data = report.data;
  const currency = data.revenue.currency;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Billing</CardTitle>
        <CardDescription>
          The Phase 15.8 book for the last {data.window.days} days: recurring revenue, the customer
          base and the health overlay
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 text-sm text-gray-700 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs text-gray-500">MRR</p>
            <p className="text-2xl font-semibold text-gray-900">{formatMoney(data.revenue.mrr, currency)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">ARR</p>
            <p className="text-2xl font-semibold text-gray-900">{formatMoney(data.revenue.arr, currency)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">ARPA</p>
            <p className="text-2xl font-semibold text-gray-900">{formatMoney(data.revenue.arpa, currency)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Paying customers</p>
            <p className="text-2xl font-semibold text-gray-900">{data.revenue.payingCustomers}</p>
          </div>
        </div>
        <div className="grid gap-4 text-xs text-gray-500 sm:grid-cols-3 lg:grid-cols-6">
          <p>Active: {data.customers.active}</p>
          <p>New: {data.customers.newInWindow}</p>
          <p>Trials ending soon: {data.customers.trialsEndingSoon}</p>
          <p>Churned: {data.customers.churned}</p>
          <p>Churn rate: {data.customers.churnRatePercent}%</p>
          <p>Trialing: {data.revenue.trialingCustomers}</p>
        </div>
        {data.revenue.planMix.length === 0 ? (
          <p className="text-sm text-gray-500">No subscriptions recorded in this window.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plan</TableHead>
                <TableHead>Subscriptions</TableHead>
                <TableHead>MRR</TableHead>
                <TableHead>Share</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.revenue.planMix.map((plan) => (
                <TableRow key={plan.packageId}>
                  <TableCell>{plan.name}</TableCell>
                  <TableCell>{plan.subscriptions}</TableCell>
                  <TableCell>{formatMoney(plan.mrr, currency)}</TableCell>
                  <TableCell>{plan.sharePercent}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <p className="text-xs text-gray-500">
          Health overlay: {data.health.healthy} healthy · {data.health.watch} watch ·{' '}
          {data.health.atRisk} at risk ({data.health.evaluated} evaluated)
        </p>
      </CardContent>
    </Card>
  );
}
