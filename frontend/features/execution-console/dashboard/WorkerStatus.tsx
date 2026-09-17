'use client';

import { useQuery } from '@tanstack/react-query';
import { executionConsoleApi } from '@/services/executionConsoleApi';
import type { WorkerMetrics } from '@/features/execution-console/types/types';
import { Badge } from '@/components/ui/Badge';
import {
  Activity,
  Users,
  Database,
  Zap,
  Circle,
  TrendingUp,
  TrendingDown,
  SlidersHorizontal,
} from 'lucide-react';

interface WorkerStatusProps {
  className?: string;
  refreshInterval?: number; // in seconds, default 30
}

export function WorkerStatus({
  className = '',
  refreshInterval = 30,
}: WorkerStatusProps) {
  const {
    data: metrics,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<WorkerMetrics, Error>({
    queryKey: ['workerMetrics'],
    queryFn: executionConsoleApi.getWorkerMetrics,
    refetchInterval: refreshInterval * 1000,
    refetchIntervalInBackground: true,
  });

  if (isLoading) {
    return (
      <div className={`min-h-[200px] flex flex-col items-center justify-center p-6 bg-gray-50 rounded-xl border border-gray-200 ${className}`}>
        <Activity className="h-6 w-6 animate-spin text-gray-400 mb-3" />
        <p className="text-sm text-gray-500">Loading worker metrics...</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className={`p-4 bg-rose-50 border border-rose-200 rounded-lg text-rose-600 ${className}`}>
        <div className="flex items-center space-x-2">
          <Activity className="h-4 w-4 text-rose-500" />
          <span className="text-sm">Error loading worker metrics: {(error as Error)?.message}</span>
        </div>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className={`text-center py-6 text-xs text-gray-500 ${className}`}>
        No worker metrics available
      </div>
    );
  }

  const getHeartbeatStatusBadge = (status: WorkerMetrics['heartbeatStatus']) => {
    switch (status) {
      case 'up':
        return { variant: 'success', text: 'Online' };
      case 'down':
        return { variant: 'destructive', text: 'Offline' };
      case 'skipped':
        return { variant: 'warning', text: 'Stale' };
      default:
        return { variant: 'secondary', text: 'Unknown' };
    }
  };

  const getScalingActionBadge = (action?: 'SCALE_UP' | 'SCALE_DOWN' | 'MAINTAIN' | string) => {
    switch (action) {
      case 'SCALE_UP':
        return { variant: 'default', text: 'Scale Up' };
      case 'SCALE_DOWN':
        return { variant: 'destructive', text: 'Scale Down' };
      case 'MAINTAIN':
        return { variant: 'secondary', text: 'Maintain' };
      default:
        return { variant: 'outline', text: action || 'Maintain' };
    }
  };

  return (
    <div className={`bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-100 bg-gray-50">
        <div className="flex items-center space-x-2">
          <Users className="w-4 h-4 text-blue-600" />
          <h3 className="text-sm font-semibold text-gray-900">Worker Status</h3>
        </div>
        <button
          onClick={() => refetch()}
          className="p-1 rounded-hover text-gray-400 hover:text-gray-600 transition-colors"
        >
          <Activity className="w-3 h-3" />
        </button>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 gap-4 p-4">
        {/* Worker Count */}
        <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-2">
              <Users className="w-4 h-4 text-blue-500" />
              <span className="text-xs font-medium text-gray-600">Active Workers</span>
            </div>
            <Badge variant="secondary" size="sm" className="text-[10px]">
              {metrics.totalWorkers} Total
            </Badge>
          </div>
          <div className="text-2xl font-bold text-gray-900">
            {metrics.activeWorkers}/{metrics.totalWorkers} Active
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {metrics.activeWorkers === metrics.totalWorkers
              ? 'All workers operational'
              : `${metrics.totalWorkers - metrics.activeWorkers} workers idle or unavailable`}
          </p>
        </div>

        {/* Queue Depth */}
        <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-2">
              <Database className="w-4 h-4 text-purple-500" />
              <span className="text-xs font-medium text-gray-600">Queue Depth</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <span className="text-gray-500">Execution Queue</span>
              <p className="font-mono font-medium text-gray-900">{metrics.queueDepth?.executions ?? 0}</p>
            </div>
            <div>
              <span className="text-gray-500">Webhook Queue</span>
              <p className="font-mono font-medium text-gray-900">{metrics.queueDepth?.webhooks ?? 0}</p>
            </div>
            <div className="col-span-2">
              <span className="text-gray-500">Total Queued Jobs</span>
              <p className="font-mono font-medium text-gray-900">{metrics.queueDepth?.total ?? ((metrics.queueDepth?.executions ?? 0) + (metrics.queueDepth?.webhooks ?? 0))}</p>
            </div>
          </div>
        </div>

        {/* Heartbeat & Scaling */}
        <div className="bg-gray-50 rounded-lg border border-gray-200 p-4 grid grid-cols-1 gap-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-2">
              <Zap className="w-4 h-4 text-indigo-500" />
              <span className="text-xs font-medium text-gray-600">Heartbeat</span>
            </div>
          </div>
          <div className="flex items-center space-x-3 text-sm">
            <div className="flex items-center space-x-1">
              <Circle
                className={`w-3 h-3 ${
                  metrics.heartbeatStatus === 'up'
                    ? 'text-emerald-500'
                    : metrics.heartbeatStatus === 'down'
                    ? 'text-rose-500'
                    : 'text-amber-500'
                }`}
              />
            </div>
            <span className="font-medium text-gray-700">
              {getHeartbeatStatusBadge(metrics.heartbeatStatus).text}
            </span>
          </div>
          <div className="flex items-center space-x-3 text-sm">
            <span className="text-gray-500">Heartbeat Latency:</span>
            <span className="font-mono font-medium text-gray-700">
              {metrics.heartbeatLatencyMs}ms
            </span>
          </div>
        </div>

        {/* Scaling Recommendation */}
        <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-2">
              <SlidersHorizontal className="w-4 h-4 text-green-600" />
              <span className="text-xs font-medium text-gray-600">Scaling Advice</span>
            </div>
          </div>
          <div className="flex items-center space-x-3 text-sm">
            {metrics.scalingRecommendation && getScalingActionBadge(metrics.scalingRecommendation.action).variant === 'destructive' && (
              <span className="text-xs font-medium text-rose-600">
                ▼
              </span>
            )}
            {metrics.scalingRecommendation && getScalingActionBadge(metrics.scalingRecommendation.action).variant === 'default' && (
              <span className="text-xs font-medium text-blue-600">
                ▲
              </span>
            )}
            {metrics.scalingRecommendation && getScalingActionBadge(metrics.scalingRecommendation.action).variant === 'secondary' && (
              <span className="text-xs font-medium text-gray-500">
                ●
              </span>
            )}
            <span className="flex-1 text-xs font-medium text-gray-700">
              {metrics.scalingRecommendation ? getScalingActionBadge(metrics.scalingRecommendation.action).text : 'Active'}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            {metrics.scalingRecommendation?.reason || ((metrics as any).recommendations && (metrics as any).recommendations[0]) || 'Fleet is healthy'}
          </p>
        </div>
      </div>

      {/* Footer with last updated timestamp */}
      <div className="px-4 py-2 text-xs text-gray-400 border-t border-gray-100 bg-gray-50">
        Last updated: {new Date().toLocaleTimeString()} • Refreshing every {refreshInterval}s
      </div>
    </div>
  );
}

export default WorkerStatus;