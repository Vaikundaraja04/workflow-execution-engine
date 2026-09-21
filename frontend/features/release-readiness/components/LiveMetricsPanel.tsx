'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type { LiveMetricsDTO } from '@/types/continuousMonitoring';

export interface LiveMetricsPanelProps {
  snapshot: LiveMetricsDTO;
  onRefresh?: () => Promise<LiveMetricsDTO>;
  autoRefreshMs?: number;
}

function formatPercent(value: number | null): string {
  return value === null ? 'n/a' : `${value}%`;
}

function formatAge(value: number | null): string {
  if (value === null) return 'unknown';
  if (value < 1000) return `${value} ms`;
  return `${Math.round(value / 1000)} s`;
}

export function LiveMetricsPanel({ snapshot, onRefresh, autoRefreshMs }: LiveMetricsPanelProps) {
  const [current, setCurrent] = useState<LiveMetricsDTO>(snapshot);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    setCurrent(snapshot);
  }, [snapshot]);

  const refresh = useCallback(async () => {
    if (!onRefresh) return;
    setRefreshing(true);
    try {
      setCurrent(await onRefresh());
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh]);

  useEffect(() => {
    if (!autoRefreshMs || !onRefresh) return undefined;
    const timer = setInterval(() => {
      void refresh();
    }, autoRefreshMs);
    return () => clearInterval(timer);
  }, [autoRefreshMs, onRefresh, refresh]);
  const metrics = [
    { label: 'CPU', value: formatPercent(current.cpuPercent) },
    { label: 'Memory RSS', value: `${current.memory.rssMb} MB` },
    { label: 'System memory', value: formatPercent(current.memory.systemUsedPercent) },
    {
      label: 'Redis',
      value: current.redis.status === 'skipped'
        ? 'skipped'
        : `${current.redis.status} (${current.redis.latencyMs} ms)`,
    },
    { label: 'Queue depth', value: current.queue.available ? String(current.queue.depth) : 'unavailable' },
    {
      label: 'Worker',
      value: current.worker.available ? `healthy (${formatAge(current.worker.heartbeatAgeMs)} ago)` : 'unavailable',
    },
    { label: 'Worker utilization', value: formatPercent(current.worker.utilizationPercent) },
    {
      label: 'WebSocket clients',
      value: current.websocket.connections === null ? 'n/a' : String(current.websocket.connections),
    },
    { label: 'API p95', value: `${current.api.p95Ms} ms` },
    { label: 'API error rate', value: formatPercent(current.api.errorRatePercent) },
    { label: 'Executions (1h)', value: String(current.executions.lastHour) },
    { label: 'Execution error rate', value: formatPercent(current.executions.errorRatePercent) },
  ];

  return (
    <section data-testid="live-metrics-panel" className="rounded-lg border bg-white p-4">
      <header className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Live production metrics</h2>
          <p className="text-xs text-gray-500">Snapshot {current.timestamp}</p>
        </div>
        {onRefresh ? (
          <button
            type="button"
            data-testid="live-metrics-refresh"
            onClick={() => void refresh()}
            disabled={refreshing}
            className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
          >
            Refresh
          </button>
        ) : null}
      </header>
      <dl data-testid="live-metrics-grid" className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded border p-2">
            <dt className="text-xs text-gray-500">{metric.label}</dt>
            <dd className="font-semibold">{metric.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export default LiveMetricsPanel;