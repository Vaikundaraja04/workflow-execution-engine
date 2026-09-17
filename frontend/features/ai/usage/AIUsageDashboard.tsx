'use client';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { AIErrorState } from '../components/AIErrorState';
import { UsageCard } from '../components/UsageCard';
import { useAIUsage } from '../hooks/useAIUsage';
import { Activity, Clock, Coins, Cpu, RefreshCw } from 'lucide-react';

const FEATURE_LABELS: Record<string, string> = {
  workflow_generation: 'Workflow Generation',
  failure_analysis: 'Failure Analysis',
  optimization: 'Optimization',
  template_generation: 'Template Generation',
};

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString('en-US') : '0';
}

function formatCost(value: number): string {
  return `$${(Number.isFinite(value) ? value : 0).toFixed(4)}`;
}

function formatTimestamp(value?: string | null): string {
  if (!value) return 'No activity yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
}

export function AIUsageDashboard({ className }: { className?: string }) {
  const { usage, loading, error, refetch, canManageConfiguration } = useAIUsage();

  if (!canManageConfiguration) {
    return (
      <AIErrorState
        variant="permission"
        title="AI usage restricted"
        message="Workspace AI usage is visible to OWNER and ADMIN roles."
        hint={
          <span>
            Requires{' '}
            <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[10px]">AI_CONFIGURATION_MANAGE</code>{' '}
            permission.
          </span>
        }
        className={className}
      />
    );
  }

  const records = usage?.records ?? [];
  const featureUsage = usage?.featureUsage ?? [];
  const maxRequests = featureUsage.reduce((max, feature) => Math.max(max, feature.requests), 0);

  return (
    <div data-testid="ai-usage-dashboard" className={cn('space-y-4', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-5 shadow-2xs">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-600 to-purple-600 text-white shadow-xs">
            <Activity className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-900">AI Usage & Consumption</h3>
            <p className="text-[11px] text-gray-500">
              Requests, tokens and estimated cost for this workspace
            </p>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={refetch}
          disabled={loading}
          className="h-8 border-indigo-200 bg-white text-xs text-indigo-700 hover:bg-indigo-50"
        >
          <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', loading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {loading && !usage && (
        <div className="flex items-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50/50 p-5 text-xs text-indigo-800">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          Loading AI usage records...
        </div>
      )}

      {error && <AIErrorState message={error} onRetry={refetch} retryLabel="Retry" />}

      {usage && !error && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <UsageCard
              label="Total Requests"
              value={formatNumber(usage.totalRequests)}
              hint="Across all AI features"
              icon={<Activity className="h-3.5 w-3.5" />}
              accent="indigo"
            />
            <UsageCard
              label="Tokens Used"
              value={formatNumber(usage.totalTokens)}
              hint="Prompt + completion tokens"
              icon={<Cpu className="h-3.5 w-3.5" />}
              accent="emerald"
            />
            <UsageCard
              label="Estimated Cost"
              value={formatCost(usage.estimatedCost)}
              hint="Based on provider pricing"
              icon={<Coins className="h-3.5 w-3.5" />}
              accent="amber"
            />
            <UsageCard
              label="Latest Activity"
              value={formatTimestamp(usage.latestActivity)}
              icon={<Clock className="h-3.5 w-3.5" />}
              accent="gray"
            />
          </div>

          {featureUsage.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-2xs" data-testid="ai-usage-features">
              <h4 className="text-xs font-bold text-gray-900">Usage by feature</h4>
              <ul className="mt-3 space-y-3">
                {featureUsage.map((feature) => (
                  <li key={feature.feature} className="space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-gray-800">
                        {FEATURE_LABELS[feature.feature] ?? feature.feature}
                      </span>
                      <span className="font-mono text-[11px] text-gray-500">
                        {feature.requests} request{feature.requests === 1 ? '' : 's'} / {formatNumber(feature.tokens)} tokens /{' '}
                        {formatCost(feature.cost)}
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-1.5 rounded-full bg-indigo-500"
                        style={{
                          width: `${
                            maxRequests > 0
                              ? Math.max(4, Math.round((feature.requests / maxRequests) * 100))
                              : 0
                          }%`,
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xs" data-testid="ai-usage-records">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
              <h4 className="text-xs font-bold text-gray-900">Recent AI requests</h4>
              <span className="text-[11px] text-gray-500">
                {records.length} record{records.length === 1 ? '' : 's'}
              </span>
            </div>

            {records.length === 0 ? (
              <p className="px-5 py-8 text-center text-xs text-gray-500">
                No AI usage recorded yet. Generation, analysis and optimization calls will appear here.
              </p>
            ) : (
              <table className="min-w-full divide-y divide-gray-100 text-xs">
                <thead className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-5 py-2 text-left font-semibold">Feature</th>
                    <th className="px-5 py-2 text-left font-semibold">Model</th>
                    <th className="px-5 py-2 text-right font-semibold">Requests</th>
                    <th className="px-5 py-2 text-right font-semibold">Tokens</th>
                    <th className="px-5 py-2 text-right font-semibold">Cost</th>
                    <th className="px-5 py-2 text-left font-semibold">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {records.slice(0, 15).map((record, index) => (
                    <tr key={record._id ?? `${record.feature}_${index}`} className="hover:bg-gray-50/60">
                      <td className="px-5 py-2">
                        <Badge variant="secondary" size="sm">
                          {FEATURE_LABELS[record.feature] ?? record.feature}
                        </Badge>
                      </td>
                      <td className="px-5 py-2 font-mono text-[11px] text-gray-500">{record.model ?? 'default'}</td>
                      <td className="px-5 py-2 text-right font-mono text-gray-700">{record.requests ?? 1}</td>
                      <td className="px-5 py-2 text-right font-mono text-gray-700">
                        {formatNumber(record.tokensUsed ?? 0)}
                      </td>
                      <td className="px-5 py-2 text-right font-mono text-gray-700">
                        {formatCost(record.costEstimate ?? 0)}
                      </td>
                      <td className="px-5 py-2 text-[11px] text-gray-500">{formatTimestamp(record.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default AIUsageDashboard;
