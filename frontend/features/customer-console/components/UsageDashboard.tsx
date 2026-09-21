'use client';

import type { UsageMetricDTO, UsageSummaryDTO } from '@/types/saas';

export const METRIC_LABELS: Record<UsageMetricDTO, string> = {
  EXECUTIONS: 'Executions',
  AI_TOKENS: 'AI tokens',
  AGENT_RUNS: 'Agent runs',
  STORAGE_BYTES: 'Storage',
  API_REQUESTS: 'API requests',
};

const ALERT_CLASSES = {
  OK: 'bg-green-500',
  WARNING: 'bg-yellow-500',
  EXCEEDED: 'bg-red-500',
} as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** index;
  return `${index === 0 ? value : value.toFixed(1)} ${units[index]}`;
}

export function formatValue(value: number, metric: UsageMetricDTO): string {
  return metric === 'STORAGE_BYTES' ? formatBytes(value) : value.toLocaleString();
}

export function UsageDashboard({ summary }: { summary: UsageSummaryDTO }) {
  return (
    <section
      aria-label="Usage dashboard"
      className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
    >
      <header className="mb-4 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Usage</h2>
        <span className="text-sm text-gray-500">
          {summary.plan ?? 'No plan'} · {summary.periodKey}
        </span>
      </header>
      <ul className="space-y-4">
        {summary.metrics.map((metric) => (
          <li key={metric.metric}>
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-gray-700">
                {METRIC_LABELS[metric.metric] ?? metric.metric}
              </span>
              <span className="text-gray-500">
                {formatValue(metric.value, metric.metric)}
                {metric.limit !== null ? ` / ${formatValue(metric.limit, metric.metric)}` : ''}
              </span>
            </div>
            <div
              role="meter"
              aria-label={`${METRIC_LABELS[metric.metric] ?? metric.metric} usage`}
              aria-valuenow={Math.round(metric.percent)}
              aria-valuemin={0}
              aria-valuemax={100}
              className="mt-1 h-2 w-full overflow-hidden rounded-full bg-gray-100"
            >
              <div
                className={`h-full rounded-full ${ALERT_CLASSES[metric.alertState]}`}
                style={{ width: `${Math.min(100, metric.percent)}%` }}
              />
            </div>
            {metric.overage ? (
              <p className="mt-1 text-xs text-red-600">
                Overage — usage exceeds the plan limit for this period
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default UsageDashboard;
