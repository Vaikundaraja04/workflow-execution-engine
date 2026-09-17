'use client';

import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/Badge';
import { executionConsoleApi } from '@/services/executionConsoleApi';
import type { WorkflowExecution } from '@/types/execution';
import { Clock, RefreshCw, Activity } from 'lucide-react';

interface ExecutionStatusTrackerProps {
  executionId: string;
  workspaceId?: string;
  pollingInterval?: number; // in milliseconds
}

const DEFAULT_POLLING_INTERVAL = 5000; // 5 seconds

export function ExecutionStatusTracker({
  executionId,
  workspaceId,
  pollingInterval = DEFAULT_POLLING_INTERVAL,
}: ExecutionStatusTrackerProps) {
  const {
    data: execution,
    isLoading,
    isError,
    error,
    isFetching,
  } = useQuery<WorkflowExecution, Error>({
    queryKey: ['execution', executionId, workspaceId],
    queryFn: () =>
      executionConsoleApi.getExecution(executionId, workspaceId),
    refetchInterval: pollingInterval,
    refetchIntervalInBackground: true,
    enabled: !!executionId,
  });

  if (isLoading) {
    return (
      <div className="flex items-center space-x-3 text-sm text-gray-500">
        <RefreshCw className="h-4 w-4 animate-spin" {...({ title: 'refresh' } as any)} />
        <span>Loading execution status...</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center space-x-3 text-sm text-destructive">
        <Activity className="h-4 w-4" {...({ title: 'activity' } as any)} />
        <span>
          Error loading status: {(error as Error)?.message}
        </span>
      </div>
    );
  }

  if (!execution) {
    return (
      <div className="flex items-center space-x-3 text-sm text-gray-500">
        <Activity className="h-4 w-4" {...({ title: 'activity' } as any)} />
        <span>Execution not found</span>
      </div>
    );
  }

  const statusBadgeVariant: Record<
    WorkflowExecution['status'],
    'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'info'
  > = {
    PENDING: 'secondary',
    QUEUING: 'secondary',
    QUEUED: 'secondary',
    RUNNING: 'default',
    SUCCEEDED: 'success',
    COMPLETED: 'success',
    FAILED: 'destructive',
    CANCELLED: 'warning',
    RETRYING: 'secondary',
  };

  const getStatusText = (status: WorkflowExecution['status']): string => {
    switch (status) {
      case 'QUEUING':
        return 'Queuing';
      case 'QUEUED':
        return 'Queued';
      case 'RUNNING':
        return 'Running';
      case 'SUCCEEDED':
      case 'COMPLETED':
        return 'Succeeded';
      case 'FAILED':
        return 'Failed';
      case 'CANCELLED':
        return 'Cancelled';
      case 'RETRYING':
        return 'Retrying';
      default:
        return status;
    }
  };

  const startedAt = execution.startedAt ? new Date(execution.startedAt) : null;
  const finishedAt = execution.finishedAt ? new Date(execution.finishedAt) : null;
  const durationMs =
    finishedAt && startedAt ? finishedAt.getTime() - startedAt.getTime() : null;
  const isRunning =
    execution.status === 'RUNNING' ||
    execution.status === 'QUEUING' ||
    execution.status === 'QUEUED' ||
    execution.status === 'RETRYING';

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2">
            <Activity
              className={`h-4 w-4 ${isRunning ? 'animate-pulse text-blue-500' : 'text-gray-400'}`}
              {...({ title: 'activity' } as any)}
            />
            {!isRunning && (
              <Badge
                variant={statusBadgeVariant[execution.status]}
                size="sm"
              >
                {getStatusText(execution.status)}
              </Badge>
            )}
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900" data-testid="execution-status">
              {getStatusText(execution.status)}
            </p>
            <p className="text-xs text-gray-500">
              Execution ID: {execution._id?.substring(0, 8)}...
            </p>
          </div>
        </div>
        <div className="text-right text-sm space-x-2">
          {!isRunning && startedAt && (
            <>
              <Clock className="h-3.5 w-3.5 text-gray-400 inline" />
              <span className="ml-1">
                {startedAt.toLocaleString()}
              </span>
            </>
          )}
          {isRunning && (
            <>
              <RefreshCw className="h-3.5 w-3.5 text-blue-500 animate-spin inline" />
              <span className="ml-1">
                {isFetching ? 'Updating...' : 'Live'}
              </span>
            </>
          )}
        </div>
      </div>

      {execution.status !== 'QUEUING' && execution.status !== 'QUEUED' && (
        <div className="border-t border-gray-200 pt-4">
          <div className="flex items-center space-x-3 text-xs text-gray-500">
            <div className="flex-1">
              <p className="mb-1 font-medium text-gray-700">Started</p>
              <p className="text-gray-500">{startedAt ? startedAt.toLocaleString() : '--'}</p>
            </div>
            {finishedAt && (
              <div className="flex-1 border-l pl-4">
                <p className="mb-1 font-medium text-gray-700">Finished</p>
                <p className="text-gray-500">{finishedAt.toLocaleString()}</p>
              </div>
            )}
            {!finishedAt && execution.status !== 'SUCCEEDED' && (
              <div className="flex-1 border-l pl-4">
                <p className="mb-1 font-medium text-gray-700">Elapsed</p>
                <p className="text-gray-500" id="elapsed-timer">
                  Calculating...
                </p>
              </div>
            )}
          </div>
          {durationMs !== null && (
            <div className="mt-2 flex items-center space-x-3 text-xs text-gray-500">
              <p className="flex-1 font-medium text-gray-700">Duration</p>
              <p className="flex-1 text-gray-500">
                {Math.floor(durationMs / 1000)}s
              </p>
            </div>
          )}
        </div>
      )}

      {/* Polling status */}
      <div className="text-xs text-gray-400">
        <RefreshCw className="h-3 w-3 mr-1 inline" />
        Polling every {pollingInterval / 1000}s • WebSocket ready
      </div>
    </div>
  );
}

export default ExecutionStatusTracker;
