import React from 'react';
import { useOperationsStore } from '@/stores/operationsStore';
import {
  DollarSign,
  Activity,
  TrendingUp,
  TrendingDown,
  Clock,
  Zap,
  Shield,
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

interface PerWorkflowCostProps {
  workflow: {
    workflowId: string;
    name: string;
    costUsd: number;
    executionsCount: number;
  };
}

const PerWorkflowCost: React.FC<PerWorkflowCostProps> = ({ workflow }) => {
  const { name, costUsd, executionsCount, workflowId } = workflow;
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{name}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            ID: {workflowId}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {executionsCount} executions
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-gray-900 dark:text-white">
            ${costUsd.toFixed(2)}
          </div>
        </div>
      </div>
    </div>
  );
};

export const CostAnalytics: React.FC = () => {
  const {
    cost,
    overview,
    isLoading,
    error,
  } = useOperationsStore((state) => ({
    cost: state.cost,
    overview: state.overview,
    isLoading: state.isLoading,
    error: state.error,
  }));

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-2xs">
          <div className="text-center py-8">
            <div className="w-12 h-12 mx-auto animate-spin rounded-full border-4 border-indigo-600 border-t-transparent"></div>
            <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">Loading cost analytics...</p>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-2xs">
          <div className="text-center py-8">
            <div className="w-12 h-12 mx-auto animate-spin rounded-full border-4 border-indigo-600 border-t-transparent"></div>
            <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">Loading per-workflow cost...</p>
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
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">Error Loading Cost Analytics</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{error}</p>
              </div>
            </div>
            <button
              onClick={() => {
                console.log('Refetching cost analytics...');
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
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">Error Loading Per-Workflow Cost</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{error}</p>
              </div>
            </div>
            <button
              onClick={() => {
                console.log('Refetching per-workflow cost...');
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
          title="Total Cost"
          value={`$${overview?.totalCostUsd?.toFixed(2) ?? '0.00'}`}
          icon={DollarSign}
          trend={{
            value: -1.5,
            isPositive: false,
          }}
          description="Estimated monthly cost"
        />

        <StatCard
          title="Compute Cost"
          value={`$${cost?.computeCostUsd?.toFixed(2) ?? '0.00'}`}
          icon={Activity}
          trend={{
            value: -0.5,
            isPositive: false,
          }}
          description="Execution and worker compute"
        />

        <StatCard
          title="AI Token Cost"
          value={`$${cost?.aiTokenCostUsd?.toFixed(2) ?? '0.00'}`}
          icon={Zap}
          trend={{
            value: 2.5,
            isPositive: true,
          }}
          description="LLM usage and processing"
        />

        <StatCard
          title="Storage Cost"
          value={`$${cost?.storageCostUsd?.toFixed(2) ?? '0.00'}`}
          icon={Shield}
          trend={{
            value: 0.5,
            isPositive: true,
          }}
          description="Data and artifact storage"
        />
      </div>

      {/* Per-Workflow Cost Breakdown */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-2xs">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <Activity className="w-5 h-5 text-indigo-600" />
            <div>
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">Per-Workflow Cost Breakdown</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Cost attribution by workflow
              </p>
            </div>
          </div>
          <button
            className="text-xs text-indigo-600 hover:text-indigo-500"
          >
            View All
          </button>
        </div>

        {cost?.perWorkflowCost && cost.perWorkflowCost.length > 0 ? (
          <div className="space-y-4">
            {cost.perWorkflowCost.map((workflow) => (
              <PerWorkflowCost key={workflow.workflowId} workflow={workflow} />
            ))}
          </div>
        ) : (
          <p className="text-center text-gray-500 dark:text-gray-400 py-8">
            No cost data available
          </p>
        )}
      </div>

      {/* Cost Trend Over Time (placeholder for chart) */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-2xs">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <Clock className="w-5 h-5 text-indigo-600" />
            <div>
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">Cost Trend</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Monthly cost trend over the last 6 months
              </p>
            </div>
          </div>
          <button
            className="text-xs text-indigo-600 hover:text-indigo-500"
          >
            View All
          </button>
        </div>

        <div className="h-40 bg-gray-50 dark:bg-gray-900 rounded-lg">
          <div className="flex h-full items-center justify-center text-gray-400 dark:text-gray-500">
            Chart placeholder - Cost trend over time
          </div>
        </div>
      </div>
    </div>
  );
};