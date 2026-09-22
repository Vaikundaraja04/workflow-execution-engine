import React from 'react';
import { useOperationsStore } from '@/stores/operationsStore';
import { useShallow } from 'zustand/react/shallow';
import type { ExecutionAnalyticsData } from '@/types/operations.types';
import {
  Activity,
  TrendingUp,
  TrendingDown,
  Zap,
  Shield,
  Clock,
  RefreshCw,
} from 'lucide-react';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  description?: string;
}

const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  icon: Icon,
  trend,
  description,
}) => {
  const trendColor = trend?.isPositive ? 'text-green-600' : 'text-red-600';
  const trendIcon = trend?.isPositive ? (
    <TrendingUp className="h-4 w-4" />
  ) : (
    <TrendingDown className="h-4 w-4" />
  );

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-2xs">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Icon className="w-5 h-5 text-indigo-600" />
          <div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">{title}</h3>
            {description && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{description}</p>
            )}
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
          {trend && (
            <div className={`flex items-center mt-2 text-sm ${trendColor}`}>
              {trendIcon}
              <span>{Math.abs(trend.value)}%</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface HourlyThroughputItemProps {
  hour: string;
  count: number;
  successRate: number;
}

const HourlyThroughputItem: React.FC<HourlyThroughputItemProps> = ({ hour, count, successRate }) => {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{hour}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {count} executions
          </p>
        </div>
        <div className="text-right">
          <div className="text-sm font-medium">
            Success Rate: {successRate}%
          </div>
        </div>
      </div>
    </div>
  );
};

interface StatusBreakdownItemProps {
  status: keyof ExecutionAnalyticsData['statusBreakdown'];
  count: number;
}

const StatusBreakdownItem: React.FC<StatusBreakdownItemProps> = ({ status, count }) => {
  const statusColors: Record<string, string> = {
    succeeded: 'bg-emerald-500 text-white',
    failed: 'bg-rose-500 text-white',
    running: 'bg-blue-500 text-white',
    queued: 'bg-yellow-500 text-black',
    cancelled: 'bg-gray-500 text-white',
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {count} executions
          </p>
        </div>
        <div className="text-right">
          <div className={`px-3 py-1 rounded-full text-xs font-medium ${statusColors[status]}`}>
            {count}
          </div>
        </div>
      </div>
    </div>
  );
};

interface LatencyPercentilesProps {
  latencyPercentiles: ExecutionAnalyticsData['latencyPercentiles'];
}

const LatencyPercentiles: React.FC<LatencyPercentilesProps> = ({ latencyPercentiles }) => {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-2xs">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <Activity className="w-5 h-5 text-indigo-600" />
          <div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">Latency Percentiles</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Distribution of execution durations
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">P50 (Median)</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                50th percentile
              </p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {latencyPercentiles.p50}ms
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">P95</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                95th percentile
              </p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {latencyPercentiles.p95}ms
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">P99</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                99th percentile
              </p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {latencyPercentiles.p99}ms
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Average</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Mean duration
              </p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {latencyPercentiles.avg}ms
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

interface RetryStatsProps {
  retryStats: ExecutionAnalyticsData['retryStats'];
}

const RetryStats: React.FC<RetryStatsProps> = ({ retryStats }) => {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-2xs">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <RefreshCw className="w-5 h-5 text-indigo-600" />
          <div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">Retry Statistics</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Analysis of retry attempts
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Total Retries</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Across all executions
              </p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {retryStats.totalRetries}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Successful After Retry</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Initially failed, succeeded after retry
              </p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {retryStats.successfulAfterRetry}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Failed After Retry</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Still failed after retry attempts
              </p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {retryStats.failedAfterRetry}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Retry Success Rate</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Percentage of retries that succeeded
              </p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {retryStats.totalRetries > 0 ? Math.round((retryStats.successfulAfterRetry / retryStats.totalRetries) * 100) : 0}%
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const ExecutionAnalytics: React.FC = () => {
  const {
    executions,
    overview,
    isLoading,
    error,
  } = useOperationsStore(useShallow((state) => ({
    executions: state.executions,
    overview: state.overview,
    isLoading: state.isLoading,
    error: state.error,
  })));

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-2xs">
          <div className="text-center py-8">
            <div className="w-12 h-12 mx-auto animate-spin rounded-full border-4 border-indigo-600 border-t-transparent"></div>
            <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">Loading execution analytics...</p>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-2xs">
          <div className="text-center py-8">
            <div className="w-12 h-12 mx-auto animate-spin rounded-full border-4 border-indigo-600 border-t-transparent"></div>
            <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">Loading hourly throughput...</p>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-2xs">
          <div className="text-center py-8">
            <div className="w-12 h-12 mx-auto animate-spin rounded-full border-4 border-indigo-600 border-t-transparent"></div>
            <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">Loading status breakdown...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-2xs">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <Zap className="w-5 h-5 text-red-500" />
              <div>
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">Error Loading Execution Analytics</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{error}</p>
              </div>
            </div>
            <button
              onClick={() => {
                console.log('Refetching execution analytics...');
              }}
              className="text-xs text-indigo-600 hover:text-indigo-500"
            >
              Retry
            </button>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-2xs">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <Zap className="w-5 h-5 text-red-500" />
              <div>
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">Error Loading Hourly Throughput</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{error}</p>
              </div>
            </div>
            <button
              onClick={() => {
                console.log('Refetching hourly throughput...');
              }}
              className="text-xs text-indigo-600 hover:text-indigo-500"
            >
              Retry
            </button>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-2xs">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <Zap className="w-5 h-5 text-red-500" />
              <div>
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">Error Loading Status Breakdown</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{error}</p>
              </div>
            </div>
            <button
              onClick={() => {
                console.log('Refetching status breakdown...');
              }}
              className="text-xs text-indigo-600 hover:text-indigo-500"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Executions"
          value={overview?.totalExecutions ?? 0}
          icon={Activity}
          trend={{
            value: 12,
            isPositive: true,
          }}
          description="Total workflow executions"
        />

        <StatCard
          title="Success Rate"
          value={`${overview?.successRate ?? 0}%`}
          icon={Shield}
          trend={{
            value: 2,
            isPositive: true,
          }}
          description="Percentage of successful executions"
        />

        <StatCard
          title="Average Duration"
          value={`${overview?.averageDurationMs ?? 0}ms`}
          icon={Clock}
          trend={{
            value: -1.5,
            isPositive: false,
          }}
          description="Average execution time"
        />

        <StatCard
          title="P95 Duration"
          value={`${executions?.latencyPercentiles?.p95 ?? 0}ms`}
          icon={TrendingUp}
          trend={{
            value: -0.5,
            isPositive: false,
          }}
          description="95th percentile execution time"
        />
      </div>

      {/* Hourly Throughput */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-2xs">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <Zap className="w-5 h-5 text-indigo-600" />
            <div>
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">Hourly Throughput</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Executions per hour over the last 24 hours
              </p>
            </div>
          </div>
          <button
            className="text-xs text-indigo-600 hover:text-indigo-500"
          >
            View All
          </button>
        </div>

        {executions?.hourlyThroughput && executions.hourlyThroughput.length > 0 ? (
          <div className="space-y-4">
            {executions.hourlyThroughput.slice(0, 10).map((hour) => (
              <HourlyThroughputItem
                key={hour.hour}
                hour={hour.hour}
                count={hour.count}
                successRate={hour.successRate}
              />
            ))}
          </div>
        ) : (
          <p className="text-center text-gray-500 dark:text-gray-400 py-8">
            No hourly throughput data available
          </p>
        )}
      </div>

      {/* Status Breakdown and Latency Percentiles */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-2xs">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <Activity className="w-5 h-5 text-indigo-600" />
              <div>
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">Status Breakdown</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Distribution of execution statuses
                </p>
              </div>
            </div>
          </div>

          {executions?.statusBreakdown ? (
            <div className="space-y-4">
              {Object.entries(executions.statusBreakdown).map(([status, count]) => (
                <StatusBreakdownItem
                  key={status}
                  status={status as keyof ExecutionAnalyticsData['statusBreakdown']}
                  count={count}
                />
              ))}
            </div>
          ) : (
            <p className="text-center text-gray-500 dark:text-gray-400 py-8">
              No status breakdown data available
            </p>
          )}
        </div>

        {executions?.latencyPercentiles ? (
          <LatencyPercentiles latencyPercentiles={executions.latencyPercentiles} />
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-2xs">
            <div className="text-center py-8">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No latency percentile data available
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Retry Statistics */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-2xs">
        {executions?.retryStats ? (
          <RetryStats retryStats={executions.retryStats} />
        ) : (
          <div className="text-center py-8">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No retry statistics data available
            </p>
          </div>
        )}
      </div>
    </div>
  );
};