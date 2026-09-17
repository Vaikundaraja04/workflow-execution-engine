'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useExecutionStore } from '@/features/execution-console/stores/executionStore';
import { executionConsoleApi } from '@/services/executionConsoleApi';
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher';
import { Button } from '@/components/ui/Button';
import { Loading } from '@/components/ui/Loading';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';
import { ExecutionTable } from '@/features/execution-console/components/ExecutionTable';
import { ExecutionFilters } from '@/features/execution-console/components/ExecutionFilters';
import { WorkerStatus } from '@/features/execution-console/dashboard/WorkerStatus';
import type { ExecutionTableRow, ExecutionFilters as ExecutionFiltersType } from '@/features/execution-console/types/types';
import { Server, AlertTriangle, RefreshCw, X } from 'lucide-react';

export default function ExecutionsPage() {
  const { user, isAuthenticated, clearAuth } = useAuthStore();
  const { currentWorkspace } = useWorkspaceStore();
  const { filters, setFilters } = useExecutionStore();
  const router = useRouter();
  const [executions, setExecutions] = useState<ExecutionTableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [showWorkerModal, setShowWorkerModal] = useState(false);
  const pageSize = 10;

  const fetchExecutions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let workspace = currentWorkspace;
      if (!workspace) {
        const workspaceId = typeof window !== 'undefined' ? localStorage.getItem('currentWorkspaceId') : null;
        if (workspaceId) {
          console.warn('Workspace not found in store, but we have an ID in localStorage');
        }
      }

      const workspaceId = workspace?._id || workspace?.id || '';
      const executionsResponse = await executionConsoleApi.listExecutionsInWorkspace({
        ...filters,
        workspaceId: workspaceId || undefined,
      });
      setExecutions(executionsResponse);
    } catch (err: any) {
      console.error('Failed to fetch executions:', err);
      setError(err.response?.data?.error?.message || err.message || 'Failed to load executions');
    } finally {
      setLoading(false);
    }
  }, [currentWorkspace, filters]);

  // Check auth on load
  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }
    fetchExecutions();
  }, [isAuthenticated, fetchExecutions]);

  const handleLogout = async () => {
    clearAuth();
    router.push('/login');
  };

  const handleFilterChange = (newFilters: ExecutionFiltersType) => {
    setFilters(newFilters);
    setCurrentPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(executions.length / pageSize));

  if (loading && executions.length === 0) {
    return <Loading />;
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="border-b bg-white sticky top-0 z-30 shadow-2xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center space-x-4">
              <div className="flex-shrink-0 flex items-center">
                <h1 className="text-xl font-bold text-gray-900">
                  Execution Console
                </h1>
              </div>
              <div className="hidden md:flex md:items-center md:space-x-4">
                <WorkspaceSwitcher workspace={currentWorkspace} onWorkspaceChange={fetchExecutions} />
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <Link
                href="/dead-letters"
                className="inline-flex items-center px-3 py-1.5 rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 text-xs font-semibold transition-colors gap-1.5"
              >
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                Dead Letters (DLQ)
              </Link>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowWorkerModal(true)}
                className="text-xs h-8 bg-white hover:bg-gray-50 text-gray-700 border-gray-300"
              >
                <Server className="w-3.5 h-3.5 mr-1.5 text-indigo-500" />
                Worker Fleet
              </Button>
              <div className="flex items-center text-sm text-gray-600 pl-2 border-l border-gray-200">
                {user?.email && (
                  <>
                    <span className="mr-2 text-xs font-medium text-gray-500 hidden sm:inline">{user.email}</span>
                    <button
                      onClick={handleLogout}
                      className="text-xs text-gray-600 hover:text-rose-600 font-medium cursor-pointer"
                    >
                      Sign out
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1">
        <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8 space-y-6">
          {/* Page header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">
                Workflow Executions
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                Monitor and inspect real-time workflow runs across your workspace.
              </p>
            </div>
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
                }}
              >
                Reset Filters
              </Button>
              <Button
                onClick={fetchExecutions}
                disabled={loading}
              >
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
          </div>

          {/* Filters Bar */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-2xs">
            <ExecutionFilters initialFilters={filters} onFiltersChange={handleFilterChange} />
          </div>

          {/* Error Message */}
          {error && (
            <ErrorState message={error} onRetry={fetchExecutions} />
          )}

          {/* Executions table */}
          {!error && executions.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-2xs overflow-hidden">
              <ExecutionTable
                executions={executions}
                currentPage={currentPage}
                totalPages={totalPages}
                pageSize={pageSize}
                onPageChange={setCurrentPage}
                onExecutionSelect={(executionId) => {
                  router.push(`/executions/${executionId}`);
                }}
              />
            </div>
          )}

          {!error && !loading && executions.length === 0 && (
            <EmptyState
              title="No executions found"
              description="There are no executions matching the current filters. Try adjusting your filters or triggering a workflow."
            />
          )}
        </div>
      </main>

      {/* Worker Fleet Modal */}
      {showWorkerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-gray-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between p-4 border-b border-gray-100 bg-gray-50">
              <div className="flex items-center space-x-2">
                <Server className="w-4 h-4 text-indigo-600" />
                <h3 className="text-sm font-bold text-gray-900">Worker Fleet Metrics & Capacity</h3>
              </div>
              <button
                onClick={() => setShowWorkerModal(false)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded-md transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5">
              <WorkerStatus refreshInterval={15} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}