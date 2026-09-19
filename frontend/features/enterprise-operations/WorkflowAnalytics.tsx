import React from 'react';
import { useOperationsStore } from '@/stores/operationsStore';
import {
  Activity,
  TrendingUp,
  TrendingDown,
  Zap,
  Shield,
  Users,
} from 'lucide-react';

interface WorkflowCardProps {
  title: string;
  value: string | number;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  description?: string;
}

const WorkflowCard: React.FC<WorkflowCardProps> = ({
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

interface WorkflowItemProps {
  workflow: {
    workflowId: string;
    name: string;
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    successRate: number;
    avgDurationMs: number;
    lastExecutedAt?: string;
  };
}

const WorkflowItem: React.FC<WorkflowItemProps> = ({ workflow }) => {
  const { name, totalExecutions, successfulExecutions, failedExecutions, successRate, avgDurationMs, lastExecutedAt } = workflow;
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{name}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            ID: {workflow.workflowId}
          </p>
          {lastExecutedAt && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Last executed: {new Date(lastExecutedAt).toLocaleDateString()}
            </p>
          )}
        </div>
        <div className="text-right space-y-2">
          <div className="text-sm font-medium">
            Success Rate: {successRate}%
          </div>
          <div className="text-sm">
            {totalExecutions} executions
          </div>
          <div className="text-sm">
            Avg Duration: {Math.round(avgDurationMs)}ms
          </div>
        </div>
      </div>
    </div>
  );
};

interface FailingNodeProps {
  node: {
    nodeId: string;
    nodeType: string;
    failureCount: number;
    errorSample?: string;
  };
}

const FailingNode: React.FC<FailingNodeProps> = ({ node }) => {
  const { nodeId, nodeType, failureCount, errorSample } = node;
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{nodeType}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            ID: {nodeId}
          </p>
        </div>
        <div className="text-right">
          <div className="text-sm font-medium text-red-600">
            {failureCount} failures
          </div>
          {errorSample && (
            <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              <span className="font-medium">Sample error:</span> {errorSample}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const WorkflowAnalytics: React.FC = () => {
  const {
    workflows,
    overview,
    isLoading,
    error,
  } = useOperationsStore((state) => ({
    workflows: state.workflows,
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
            <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">Loading workflow analytics...</p>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-2xs">
          <div className="text-center py-8">
            <div className="w-12 h-12 mx-auto animate-spin rounded-full border-4 border-indigo-600 border-t-transparent"></div>
            <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">Loading failing nodes...</p>
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
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">Error Loading Workflow Analytics</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{error}</p>
              </div>
            </div>
            <button
              onClick={() => {
                // In a real app, we would trigger a refetch
                console.log('Refetching workflow analytics...');
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
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">Error Loading Failing Nodes</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{error}</p>
              </div>
            </div>
            <button
              onClick={() => {
                console.log('Refetching failing nodes...');
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
        <WorkflowCard
          title="Total Workflows"
          value={overview?.totalWorkflows ?? 0}
          icon={Activity}
          trend={{
            value: 5,
            isPositive: true,
          }}
          description="Workflows in this workspace"
        />

        <WorkflowCard
          title="Active Workflows"
          value={overview?.activeWorkflows ?? 0}
          icon={TrendingUp}
          trend={{
            value: 3,
            isPositive: true,
          }}
          description="Workflows with executions in the last 30 days"
        />

        <WorkflowCard
          title="Total Executions"
          value={overview?.totalExecutions ?? 0}
          icon={Zap}
          trend={{
            value: 12,
            isPositive: true,
          }}
          description="Total workflow executions"
        />

        <WorkflowCard
          title="Success Rate"
          value={`${overview?.successRate ?? 0}%`}
          icon={Shield}
          trend={{
            value: 2,
            isPositive: true,
          }}
          description="Percentage of successful executions"
        />
      </div>

      {/* Top Workflows */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-2xs">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <Activity className="w-5 h-5 text-indigo-600" />
            <div>
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">Top Workflows by Volume</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Most executed workflows in the selected timeframe
              </p>
            </div>
          </div>
          <button
            className="text-xs text-indigo-600 hover:text-indigo-500"
          >
            View All
          </button>
        </div>

        {workflows?.workflows && workflows.workflows.length > 0 ? (
          <div className="space-y-4">
            {workflows.workflows.slice(0, 5).map((workflow) => (
              <WorkflowItem key={workflow.workflowId} workflow={workflow} />
            ))}
          </div>
        ) : (
          <p className="text-center text-gray-500 dark:text-gray-400 py-8">
            No workflow data available
          </p>
        )}
      </div>

      {/* Most Failing Nodes */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-2xs">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <Zap className="w-5 h-5 text-indigo-600" />
            <div>
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">Most Failing Nodes</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Node types with the highest failure rates
              </p>
            </div>
          </div>
          <button
            className="text-xs text-indigo-600 hover:text-indigo-500"
          >
            View All
          </button>
        </div>

        {workflows?.mostFailingNodes && workflows.mostFailingNodes.length > 0 ? (
          <div className="space-y-4">
            {workflows.mostFailingNodes.slice(0, 5).map((node) => (
              <FailingNode key={node.nodeId} node={node} />
            ))}
          </div>
        ) : (
          <p className="text-center text-gray-500 dark:text-gray-400 py-8">
            No failing node data available
          </p>
        )}
      </div>
    </div>
  );
};