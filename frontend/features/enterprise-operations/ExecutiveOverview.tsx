import React from 'react';
import { useOperationsStore } from '@/stores/operationsStore';
import {
  Activity,
  TrendingUp,
  TrendingDown,
  Users,
  DollarSign,
  Clock,
  Zap,
  Shield,
  Database,
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

export const ExecutiveOverview: React.FC = () => {
  const {
    overview,
    systemHealth,
    cost,
    securityIntelligence,
    isLoading,
    error,
  } = useOperationsStore((state) => ({
    overview: state.overview,
    systemHealth: state.systemHealth,
    cost: state.cost,
    securityIntelligence: state.securityIntelligence,
    isLoading: state.isLoading,
    error: state.error,
  }));

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-2xs">
        <div className="text-center py-8">
          <div className="w-12 h-12 mx-auto animate-spin rounded-full border-4 border-indigo-600 border-t-transparent"></div>
          <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">Loading overview...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-2xs">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <Zap className="w-5 h-5 text-red-500" />
            <div>
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">Error Loading Overview</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{error}</p>
            </div>
          </div>
          <button
            onClick={() => {
              // In a real app, we would trigger a refetch
              // For now, just console log
              console.log('Refetching overview...');
            }}
            className="text-xs text-indigo-600 hover:text-indigo-500"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Total Workflows */}
        <StatCard
          title="Total Workflows"
          value={overview?.totalWorkflows ?? 0}
          icon={Activity}
          trend={{
            value: overview?.executionTrend?.[overview.executionTrend.length - 1]?.total ?? 0 > 0 ? 5 : -2,
            isPositive: true,
          }}
          description="Workflows created in this workspace"
        />

        {/* Success Rate */}
        <StatCard
          title="Success Rate"
          value={`${overview?.successRate ?? 0}%`}
          icon={TrendingUp}
          trend={{
            value: 2,
            isPositive: true,
          }}
          description="Percentage of successful executions"
        />

        {/* Active Users */}
        <StatCard
          title="Active Users"
          value={overview?.activeUsersCount ?? 0}
          icon={Users}
          trend={{
            value: 3,
            isPositive: true,
          }}
          description="Users active in the last 30 days"
        />

        {/* Total Cost */}
        <StatCard
          title="Total Cost"
          value={`$${overview?.totalCostUsd?.toFixed(2) ?? '0.00'}`}
          icon={DollarSign}
          trend={{
            value: -1.5,
            isPositive: false,
          }}
          description="Estimated monthly cost"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
        {/* System Health */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-2xs">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <Database className="w-5 h-5 text-indigo-600" />
              <div>
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">System Health</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Overall system status and uptime
                </p>
              </div>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold">
                {systemHealth?.status === 'HEALTHY' ? 'Healthy' : systemHealth?.status === 'DEGRADED' ? 'Degraded' : 'Unhealthy'}
              </div>
              <div className={`px-3 py-1 rounded-full text-xs font-medium ${
                systemHealth?.status === 'HEALTHY'
                  ? 'bg-emerald-500 text-white'
                  : systemHealth?.status === 'DEGRADED'
                    ? 'bg-yellow-500 text-black'
                    : 'bg-rose-500 text-white'
              }`}
              >
                {systemHealth?.status}
              </div>
            </div>
          </div>
        </div>

        {/* Security Risk */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-2xs">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <Shield className="w-5 h-5 text-indigo-600" />
              <div>
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">Security Risk</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Current threat level and risk score
                </p>
              </div>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold">
                {securityIntelligence?.threatLevel ?? 'LOW'}
              </div>
              <div className={`px-3 py-1 rounded-full text-xs font-medium ${
                securityIntelligence?.threatLevel === 'LOW'
                  ? 'bg-emerald-500 text-white'
                  : securityIntelligence?.threatLevel === 'MEDIUM'
                    ? 'bg-yellow-500 text-black'
                    : securityIntelligence?.threatLevel === 'HIGH'
                      ? 'bg-amber-500 text-white'
                      : 'bg-rose-500 text-white'
              }`}
              >
                {securityIntelligence?.threatLevel}
              </div>
            </div>
          </div>
        </div>

        {/* Cost Trend */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-2xs">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <Clock className="w-5 h-5 text-indigo-600" />
              <div>
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">Cost Trend</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Estimated monthly cost trend
                </p>
              </div>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold">
                ${(cost?.totalCostUsd ?? 0).toFixed(2)}
              </div>
              <div className="flex items-center mt-2 text-sm text-green-600">
                <TrendingUp className="h-4 w-4" />
                <span>5.2%</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Execution Trend */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-2xs">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <TrendingUp className="w-5 h-5 text-indigo-600" />
            <div>
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">Execution Trend</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Daily execution count over the last 30 days
              </p>
            </div>
          </div>
          <button
            className="text-xs text-indigo-600 hover:text-indigo-500"
          >
            View All
          </button>
        </div>

        {/* In a real app, we would render a chart here */}
        <div className="h-40 bg-gray-50 dark:bg-gray-900 rounded-lg">
          <div className="flex h-full items-center justify-center text-gray-400 dark:text-gray-500">
            Chart placeholder - Execution trend over time
          </div>
        </div>
      </div>
    </div>
  );
};