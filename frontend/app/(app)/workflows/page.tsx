'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Loading } from '@/components/ui/Loading';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/Table';
import { workflowApi } from '@/services/workflowApi';
import { executionApi } from '@/services/executionApi';
import { workspaceApi } from '@/services/workspaceApi';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { Workflow } from '@/types/workflow';
import { Bug, History, Pencil, Play, Plus, RefreshCw } from 'lucide-react';

function WorkflowsContent() {
  const { currentWorkspace, setCurrentWorkspace } = useWorkspaceStore();
  const router = useRouter();
  const [workflows, setWorkflows] = React.useState<Workflow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [runningId, setRunningId] = React.useState<string | null>(null);
  const [runTarget, setRunTarget] = React.useState<Workflow | null>(null);
  const [runInput, setRunInput] = React.useState('{}');
  const [runError, setRunError] = React.useState<string | null>(null);

  const fetchWorkflows = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let workspace = currentWorkspace;
      if (!workspace && typeof window !== 'undefined') {
        const workspaceId =
          localStorage.getItem('currentWorkspaceId') || localStorage.getItem('defaultWorkspaceId');
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
      const response = await workflowApi.listWorkflows(workspaceId);
      setWorkflows(response);
    } catch (err: any) {
      setError(err.response?.data?.error?.message || err.message || 'Failed to load workflows');
    } finally {
      setLoading(false);
    }
  }, [currentWorkspace, setCurrentWorkspace]);

  React.useEffect(() => {
    fetchWorkflows();
  }, [fetchWorkflows]);

  const openRunDialog = (workflow: Workflow) => {
    setRunTarget(workflow);
    setRunInput('{}');
    setRunError(null);
  };

  const confirmRun = async () => {
    if (!runTarget) return;
    const workflowId = runTarget._id || runTarget.id || '';
    if (!workflowId) return;
    let initialInput: Record<string, unknown> = {};
    const raw = runInput.trim();
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          setRunError('Input must be a JSON object');
          return;
        }
        initialInput = parsed as Record<string, unknown>;
      } catch {
        setRunError('Input must be valid JSON');
        return;
      }
    }
    const workspaceId = currentWorkspace?._id || currentWorkspace?.id || '';
    setRunningId(workflowId);
    setRunError(null);
    try {
      await executionApi.createExecution(workflowId, { initialInput }, workspaceId || undefined);
      setRunTarget(null);
      router.push('/executions');
    } catch (err: any) {
      setRunError(err.response?.data?.error?.message || err.message || 'Failed to start the workflow');
    } finally {
      setRunningId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Workflows</h1>
          <p className="mt-1 text-sm text-gray-500">
            Create, version and run the workflows in this workspace.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={fetchWorkflows} disabled={loading}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Link
            href="/workflows/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
          >
            <Plus className="h-4 w-4" />
            New Workflow
          </Link>
        </div>
      </div>

      {error && <ErrorState message={error} onRetry={fetchWorkflows} />}

      {loading && workflows.length === 0 && <Loading />}

      {!loading && !error && workflows.length === 0 && (
        <EmptyState
          title="No workflows yet"
          description="Create your first workflow to start automating your processes."
        />
      )}

      {workflows.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xs">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workflows.map((workflow) => {
                const workflowId = workflow._id || workflow.id || '';
                const published = (workflow.publishedVersion ?? 0) > 0;
                return (
                  <TableRow key={workflowId || workflow.name}>
                    <TableCell className="font-medium text-gray-900">{workflow.name}</TableCell>
                    <TableCell>
                      {published ? (
                        <Badge variant="success">Published</Badge>
                      ) : (
                        <Badge variant="outline">Draft</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-gray-500">
                      v{workflow.publishedVersion || workflow.currentVersion || 1}
                    </TableCell>
                    <TableCell className="text-xs text-gray-500">
                      {workflow.updatedAt ? new Date(workflow.updatedAt).toLocaleString() : '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => openRunDialog(workflow)}
                          disabled={runningId === workflowId}
                          className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50"
                        >
                          <Play className="h-3 w-3" />
                          {runningId === workflowId ? 'Starting...' : 'Run'}
                        </button>
                        <Link
                          href={`/workflows/${workflowId}/edit`}
                          className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50"
                        >
                          <Pencil className="h-3 w-3" />
                          Edit
                        </Link>
                        <Link
                          href={`/workflows/${workflowId}/versions`}
                          className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50"
                        >
                          <History className="h-3 w-3" />
                          Versions
                        </Link>
                        <Link
                          href={`/workflows/${workflowId}/debug`}
                          className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50"
                        >
                          <Bug className="h-3 w-3" />
                          Debug
                        </Link>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {runTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setRunTarget(null)}
            aria-hidden="true"
          />
          <div className="relative z-10 w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl">
            <h2 className="text-lg font-semibold text-foreground">Run &quot;{runTarget.name}&quot;</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Provide the workflow input as JSON. Use {'{}'} when the workflow needs no input.
            </p>
            <textarea
              value={runInput}
              onChange={(event) => setRunInput(event.target.value)}
              rows={6}
              spellCheck={false}
              className="mt-3 w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {runError && <p className="mt-2 text-xs font-medium text-red-600">{runError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setRunTarget(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => void confirmRun()}
                disabled={runningId === (runTarget._id || runTarget.id)}
              >
                {runningId === (runTarget._id || runTarget.id) ? 'Starting...' : 'Run Workflow'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function WorkflowsPage() {
  return (
    <AppShell>
      <WorkflowsContent />
    </AppShell>
  );
}
