'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { workflowApi } from '@/services/workflowApi';
import { AIPageHeader } from '@/features/ai/components/AIPageHeader';
import { WorkflowOptimizer } from '@/features/ai/optimization/WorkflowOptimizer';
import { aiErrorMessage } from '@/features/ai/hooks/aiError';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import type { Workflow } from '@/types/workflow';

export default function AIOptimizationPage() {
  const { isAuthenticated } = useAuthStore();
  const { currentWorkspace } = useWorkspaceStore();
  const router = useRouter();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const workspaceId = currentWorkspace?._id || currentWorkspace?.id || undefined;

  const fetchWorkflows = useCallback(async () => {
    try {
      const result = await workflowApi.listWorkflows(workspaceId);
      setWorkflows(result);
      setSelectedId((current) => {
        if (current && result.some((workflow) => workflow._id === current)) {
          return current;
        }
        return result[0]?._id || '';
      });
      setError(null);
    } catch (err) {
      setError(aiErrorMessage(err, 'Failed to load workflows'));
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }
    fetchWorkflows();
  }, [isAuthenticated, router, fetchWorkflows]);

  const selectedWorkflow = workflows.find((workflow) => workflow._id === selectedId) || null;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <AIPageHeader
        title="AI Workflow Optimization"
        description="Find bottlenecks and improvement opportunities in your workflows"
      />

      <main className="flex-1">
        <div className="max-w-5xl mx-auto px-4 py-6 sm:px-6 lg:px-8 space-y-4">
          {error && (
            <ErrorState
              message={error}
              onRetry={() => {
                setLoading(true);
                fetchWorkflows();
              }}
            />
          )}

          {loading && !error && (
            <div className="rounded-xl border border-gray-200 bg-white p-5 text-xs text-gray-500 shadow-2xs">
              Loading workflows...
            </div>
          )}

          {!loading && !error && workflows.length === 0 && (
            <EmptyState
              title="No workflows found"
              description="Create a workflow first, then come back to run AI optimization analysis."
            />
          )}

          {!loading && !error && workflows.length > 0 && (
            <>
              <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-2xs">
                <label
                  htmlFor="optimization-workflow"
                  className="text-[10px] font-semibold uppercase tracking-wide text-gray-500"
                >
                  Workflow
                </label>
                <select
                  id="optimization-workflow"
                  data-testid="optimization-workflow-select"
                  value={selectedId}
                  onChange={(event) => setSelectedId(event.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-800 shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  {workflows.map((workflow) => (
                    <option key={workflow._id} value={workflow._id}>
                      {workflow.name}
                    </option>
                  ))}
                </select>
              </div>

              {selectedWorkflow && (
                <WorkflowOptimizer
                  key={selectedWorkflow._id}
                  workflowId={selectedWorkflow._id}
                  workflowName={selectedWorkflow.name}
                />
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
