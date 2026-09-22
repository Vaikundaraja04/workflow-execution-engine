'use client';

import * as React from 'react';
import { InteractiveDebugger } from '@/features/ai-debugger/InteractiveDebugger';
import { useParams, notFound } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Zap, ArrowLeft, Activity } from 'lucide-react';
import { workflowApi } from '@/services/workflowApi';
import { executionApi } from '@/services/executionApi';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { hasPermission } from '@/types/permissions';
import { useWorkspaceHydration } from '@/hooks/useWorkspaceHydration';
import { Spinner as Loader } from '@/components/ui/Loading';
import { Button } from '@/components/ui/Button';

export default function WorkflowDebugPage() {
  const params = useParams<{ id: string }>();
  const workflowId = params?.id;

  if (!workflowId) {
    notFound();
  }

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workflow, setWorkflow] = useState<any>(null);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const { currentRole } = useWorkspaceStore();
  const hydrated = useWorkspaceHydration();

  useEffect(() => {
    if (!workflowId || !hydrated) return;

    let isMounted = true;

    const loadWorkflowAndExecution = async () => {
      try {
        // Check permissions
        const canView =
          hasPermission(currentRole, 'WORKFLOW_READ') ||
          hasPermission(currentRole, 'WORKFLOW_UPDATE') ||
          hasPermission(currentRole, 'WORKFLOW_CREATE');

        if (!canView) {
          if (isMounted) notFound();
          return;
        }

        setLoading(true);
        setError(null);

        // Fetch workflow details
        const workflowData = await workflowApi.getWorkflow(workflowId);
        if (isMounted) setWorkflow(workflowData);

        // Fetch executions for this workflow
        const executions = await executionApi.listExecutions(workflowId);
        if (isMounted) {
          // Sort by startedAt descending and take the latest
          const sortedExecutions = [...executions].sort(
            (a, b) =>
              new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime()
          );
          if (sortedExecutions.length > 0) {
            setExecutionId(sortedExecutions[0]._id || sortedExecutions[0].id || null);
          } else {
            // If no executions, we can still open the debugger but it will show no data
            setExecutionId(null);
          }
        }
      } catch (err) {
        if (isMounted) {
          setError('Failed to load workflow or execution data');
          console.error(err);
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadWorkflowAndExecution();

    return () => {
      isMounted = false;
    };
  }, [workflowId, hydrated, currentRole]);

  if (loading) {
    return (
      <div className="min-h-[600px] flex items-center justify-center">
        <Loader />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-center">
        <h2 className="text-xl font-bold text-rose-400 mb-4">Loading Error</h2>
        <p className="text-slate-400 mb-6">{error}</p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => window.location.reload()}
          className="h-9 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700"
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Page Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-md shadow-indigo-500/20">
            <Zap className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Workflow Debugger</h1>
            <p className="text-slate-400">
              {workflow?.name} • {workflowId.substring(0, 8)}...
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              // Go back to workflow editor or list
              if (typeof window !== 'undefined') {
                window.history.back();
              }
            }}
            className="h-9 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700 text-xs"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back
          </Button>
        </div>
      </div>

      {/* Debugger Component */}
      {executionId ? (
        <InteractiveDebugger
          workflowId={workflowId}
          executionId={executionId}
          isOpen={true}
          onClose={() => {
            if (typeof window !== 'undefined') {
              window.history.back();
            }
          }}
        />
      ) : (
        <div className="text-center py-12">
          <Activity className="w-12 h-12 mx-auto mb-4 text-slate-500/50" />
          <h2 className="text-xl font-bold text-slate-400 mb-2">No Executions Found</h2>
          <p className="text-slate-500">
            There are no executions for this workflow yet. Run the workflow to generate execution data for debugging.
          </p>
          <Button
            size="sm"
            variant="default"
            onClick={() => {
              // Navigate to workflow run page or trigger execution
              // For now, just go back to workflow editor
              if (typeof window !== 'undefined') {
                window.history.back();
              }
            }}
            className="h-9 px-4 bg-indigo-600 hover:bg-indigo-500 text-white"
          >
            Go to Workflow
          </Button>
        </div>
      )}
    </div>
  );
}

// Import Zap and ArrowLeft from lucide-react (assuming they are available)
// If not, we need to import them. Let's add the import at the top.
// We'll adjust the imports accordingly.

// Actually, let's fix the imports by adding the missing icons.