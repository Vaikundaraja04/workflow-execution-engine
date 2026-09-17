import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import type { ExecutionTableRow, ExecutionStatus } from '@/features/execution-console/types/types';
import { ChevronRight } from 'lucide-react';

interface ExecutionTableProps {
  executions: ExecutionTableRow[];
  onExecutionSelect: (executionId: string) => void;
  currentPage?: number;
  totalPages?: number;
  onPageChange?: (page: number) => void;
  pageSize?: number;
}

export function ExecutionTable({
  executions,
  onExecutionSelect,
  currentPage = 1,
  totalPages = 1,
  onPageChange = () => {},
  pageSize = 10,
}: ExecutionTableProps) {
  const statusBadgeVariant: Record<ExecutionStatus, 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'info'> = {
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

  const getStatusText = (status: ExecutionStatus): string => {
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

  const paginatedExecutions = executions.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Execution ID
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Workflow
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Duration
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Started
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Completed
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Retries
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Triggered By
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {paginatedExecutions.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-6 py-4 text-center text-gray-500">
                  No executions found
                </td>
              </tr>
            ) : (
              paginatedExecutions.map((execution) => (
                <tr
                  key={execution.id}
                  className="cursor-pointer hover:bg-gray-50"
                  onClick={() => onExecutionSelect(execution.id)}
                >
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {execution.id}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {execution.workflowName}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <Badge variant={statusBadgeVariant[execution.status]} size="sm">
                      {getStatusText(execution.status)}
                    </Badge>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {execution.duration !== null ? `${Math.floor(execution.duration / 1000)}s` : '--'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(execution.startedAt).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {execution.finishedAt ? new Date(execution.finishedAt).toLocaleString() : '--'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {execution.retries}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {execution.triggeredBy}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-400">
                    <ChevronRight className="h-4 w-4" />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-2 text-sm text-gray-500">
          <div>
            Page {currentPage} of {totalPages}
          </div>
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(Math.max(1, currentPage - 1))}
              disabled={currentPage <= 1}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage >= totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}