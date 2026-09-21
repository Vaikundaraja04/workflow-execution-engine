'use client';

import * as React from 'react';
import {
  UsageDashboard,
  METRIC_LABELS,
  formatValue,
} from '@/features/customer-console/components/UsageDashboard';
import { useUsage, useUsageHistory } from '@/features/customer-console/useCustomerData';
import { Loading } from '@/components/ui/Loading';
import { ErrorState } from '@/components/ui/ErrorState';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';

const HISTORY_DAYS = 30;

export default function CustomerUsagePage() {
  const usage = useUsage();
  const history = useUsageHistory(HISTORY_DAYS);

  if (usage.isLoading) {
    return <Loading message="Loading usage..." />;
  }

  if (usage.error || !usage.data) {
    return (
      <ErrorState
        title="Could not load usage"
        message={usage.error?.message}
        onRetry={usage.reload}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Usage</h2>
        <p className="mt-1 text-sm text-gray-500">
          Metered consumption for this workspace against plan limits.
        </p>
      </div>

      <UsageDashboard summary={usage.data} />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Last {HISTORY_DAYS} days</CardTitle>
          <CardDescription>Daily meter readings recorded by the usage service.</CardDescription>
        </CardHeader>
        <CardContent>
          {history.isLoading ? (
            <Loading message="Loading usage history..." />
          ) : history.error || !history.data ? (
            <ErrorState
              title="Could not load usage history"
              message={history.error?.message}
              onRetry={history.reload}
            />
          ) : (
            <div className="space-y-6">
              {history.data.series.map((series) => {
                const max = series.points.reduce((acc, point) => Math.max(acc, point.value), 0);
                return (
                  <section key={series.metric} aria-label={`${METRIC_LABELS[series.metric]} history`}>
                    <div className="flex items-baseline justify-between text-sm">
                      <h3 className="font-medium text-gray-700">{METRIC_LABELS[series.metric]}</h3>
                      <span className="text-gray-500">
                        peak {formatValue(max, series.metric)}
                      </span>
                    </div>
                    <div className="mt-2 flex h-16 items-end gap-1">
                      {series.points.map((point) => (
                        <div
                          key={point.periodKey}
                          title={`${point.periodKey}: ${formatValue(point.value, series.metric)}`}
                          className="flex-1 rounded-t bg-emerald-500/70"
                          style={{
                            height: `${max > 0 ? Math.max(4, Math.round((point.value / max) * 100)) : 4}%`,
                          }}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
              {history.data.series.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No meter history has been recorded for this workspace yet.
                </p>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
