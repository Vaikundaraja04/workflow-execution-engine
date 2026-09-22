'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { workspaceApi } from '@/services/workspaceApi';
import { useExecutionStore } from '@/features/execution-console/stores/executionStore';
import { executionConsoleApi } from '@/services/executionConsoleApi';
import type { DeadLetter } from '@/types/execution';
import type { ExecutionFilters as ExecutionFiltersType } from '@/features/execution-console/types/types';
import { Loading } from '@/components/ui/Loading';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ExecutionFilters } from '@/features/execution-console/components/ExecutionFilters';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import {
  Trash2,
  RefreshCw,
  Play,
  X,
} from 'lucide-react';

export default function DeadLettersPage() {
  const { isAuthenticated } = useAuthStore();
  const { currentWorkspace, setCurrentWorkspace } = useWorkspaceStore();
  const { filters, setFilters } = useExecutionStore();
  const router = useRouter();
  const [deadLetters, setDeadLetters] = React.useState<DeadLetter[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [retryModal, setRetryModal] = React.useState<{ id: string; workflowId: string } | null>(null);

  // Check auth on load
  React.useEffect(() => {
    if (!isAuthenticated) {
      useAuthStore.getState().initFromStorage();
      if (!useAuthStore.getState().isAuthenticated) {
        router.push('/login');
        return;
      }
    }
    // Fetch dead letters data
    fetchDeadLetters();
  }, [isAuthenticated, currentWorkspace?._id]);

  const fetchDeadLetters = async () => {
    setLoading(true);
    setError(null);
    try {
      let workspace = currentWorkspace;
      if (!workspace && typeof window !== 'undefined') {
        const workspaceId = localStorage.getItem('currentWorkspaceId') || localStorage.getItem('defaultWorkspaceId');
        if (workspaceId) {
          try {
            workspace = await workspaceApi.getWorkspace(workspaceId);
            setCurrentWorkspace(workspace);
          } catch {
            localStorage.removeItem('currentWorkspaceId');
          }
        }
      }

      const workspaceId = workspace?._id || workspace?.id || '';

      // Fetch dead letters for all workflows in the workspace
      const workflows = await executionConsoleApi.getWorkflows(undefined, workspaceId);
      const deadLettersPromises = workflows.map(workflow =>
        executionConsoleApi.getDeadLetters(workflow._id, workspaceId)
      );
      const deadLettersArrays = await Promise.all(deadLettersPromises);
      const allDeadLetters = deadLettersArrays.flat();

      // Apply filters
      let filtered = allDeadLetters;

      // Date range filter
      if (filters.dateRange) {
        const start = new Date(filters.dateRange.start);
        const end = new Date(filters.dateRange.end);
        filtered = filtered.filter(dl => {
          const createdAt = new Date(dl.createdAt);
          return createdAt >= start && createdAt <= end;
        });
      }

      // Search filter
      if (filters.search) {
        const searchTerm = filters.search.toLowerCase();
        filtered = filtered.filter(dl =>
          dl.executionId.toLowerCase().includes(searchTerm) ||
          (dl.workflowId || '').toLowerCase().includes(searchTerm) ||
          (dl.failureReason || dl.error || '').toLowerCase().includes(searchTerm)
        );
      }

      // Sort by createdAt descending (newest first)
      filtered.sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      setDeadLetters(filtered);
    } catch (err: any) {
      console.error('Failed to fetch dead letters:', err);
      setError(err.response?.data?.error?.message || 'Failed to load dead letters');
    } finally {
      setLoading(false);
    }
  };

  const handleRetryDeadLetter = async (deadLetterId: string, workflowId: string) => {
    setRetryModal({ id: deadLetterId, workflowId });
  };

  const handleConfirmRetry = async () => {
    if (!retryModal) return;
    setLoading(true);
    try {
      await executionConsoleApi.retryExecution(retryModal.id, {}, retryModal.workflowId);
      await fetchDeadLetters();
    } catch (err: any) {
      console.error('Failed to retry dead letter:', err);
      setError(err.response?.data?.error?.message || 'Failed to retry dead letter');
    } finally {
      setLoading(false);
      setRetryModal(null);
    }
  };

  if (loading) {
    return <Loading />;
  }

  if (error) {
    return <ErrorState message={error} onRetry={fetchDeadLetters} />;
  }

  return (
    <div className="space-y-6">

      {/* Main */}
        <div className="space-y-6">
          {/* Page header */}
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-gray-900">
              Failed Executions (DLQ)
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Monitor and manage failed workflow executions that have been moved to the dead letter queue.
            </p>
          </div>

          {/* Filters and actions */}
          <div className="mb-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <ExecutionFilters onFiltersChange={setFilters} />
            <div className="flex items-center space-x-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setFilters({
                    status: [],
                    workflowId: undefined,
                    dateRange: undefined,
                    search: undefined,
                  });
                  fetchDeadLetters();
                }}
              >
                Reset Filters
              </Button>
              <Button
                onClick={fetchDeadLetters}
              >
                Refresh
              </Button>
            </div>
          </div>

          {/* Dead letters table */}
          {deadLetters.length > 0 ? (
            <div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Execution ID
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Workflow
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Failure Reason
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Attempts
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Failed At
                      </th>
                      <th scope="col" className="relative px-6 py-3">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {deadLetters.map((dl) => (
                      <tr key={dl.executionId} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {dl.executionId?.substring(0, 8)}...{dl.executionId?.slice(-4)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          Workflow {dl.workflowId?.substring(0, 8)}...
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 break-all">
                          {dl.failureReason || dl.error || dl.message || 'Unknown error'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {dl.attempts ?? dl.attemptsMade ?? dl.retryCount ?? 0}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {new Date(dl.createdAt).toLocaleString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleRetryDeadLetter(dl.executionId, dl.workflowId)}
                            className="bg-white hover:bg-amber-50 text-amber-700 border-amber-300"
                          >
                            Retry
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <EmptyState
              title="No dead letters found"
              description="There are no executions in the dead letter queue. This indicates that all executions are completing successfully or being handled via retry/replay mechanisms."
            />
          )}
        </div>

      {/* Retry Confirmation Modal */}
      <Modal
        open={!!retryModal}
        onOpenChange={(open) => !open && setRetryModal(null)}
        title="Confirm Dead Letter Retry"
        description="This will re-trigger the failed execution from its failed state using its original inputs."
        footer={
          <div className="flex justify-end space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRetryModal(null)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleConfirmRetry}
              disabled={loading}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  Retrying...
                </>
              ) : (
                'Confirm Retry'
              )}
            </Button>
          </div>
        }
      >
        {retryModal && (
          <div className="text-xs text-gray-600 space-y-2">
            <p>
              Are you sure you want to retry execution <code className="font-mono bg-gray-100 px-1 py-0.5 rounded">{retryModal.id}</code>?
            </p>
            <p className="text-gray-500">
              A new attempt will be scheduled on the workflow worker queue immediately.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
