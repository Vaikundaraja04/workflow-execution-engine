'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { workspaceApi } from '@/services/workspaceApi';
import { workflowApi } from '@/services/workflowApi';
import { executionApi } from '@/services/executionApi';
import { collaborationApi } from '@/services/collaborationApi';
import { Button } from '@/components/ui/Button';
import { WorkflowSummary } from '@/components/dashboard/WorkflowSummary';
import { ExecutionSummary } from '@/components/dashboard/ExecutionSummary';
import { SuccessRate } from '@/components/dashboard/SuccessRate';
import { RecentExecutions } from '@/components/dashboard/RecentExecutions';
import { RecentAuditEvents } from '@/components/dashboard/RecentAuditEvents';
import { Loading } from '@/components/ui/Loading';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';

export default function DashboardPage() {
  const { user, isAuthenticated } = useAuthStore();
  const { currentWorkspace, setCurrentWorkspace } = useWorkspaceStore();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [executions, setExecutions] = useState<any[]>([]);
  const [auditEvents, setAuditEvents] = useState<any[]>([]);

  // Check auth on load
  useEffect(() => {
    if (!isAuthenticated) {
      useAuthStore.getState().initFromStorage();
      if (!useAuthStore.getState().isAuthenticated) {
        router.push('/login');
        return;
      }
    }
    // Fetch dashboard data
    fetchDashboardData();
  }, [isAuthenticated]);

  const fetchDashboardData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch current workspace from storage or use the one from store
      let workspace = currentWorkspace;
      if (!workspace) {
        // Try to get from localStorage
        const storedWorkspaceId = localStorage.getItem('currentWorkspaceId');
        const defaultWorkspaceId = localStorage.getItem('defaultWorkspaceId');
        const workspaceId = storedWorkspaceId || defaultWorkspaceId;
        if (workspaceId) {
          try {
            workspace = await workspaceApi.getWorkspace(workspaceId);
          } catch {
            workspace = null;
            if (defaultWorkspaceId && defaultWorkspaceId !== workspaceId) {
              try {
                localStorage.removeItem('currentWorkspaceId');
                workspace = await workspaceApi.getWorkspace(defaultWorkspaceId);
              } catch {
                workspace = null;
              }
            }
          }
        }
        // Self-heal: stored IDs may be stale (e.g. the workspace was
        // recreated by the backend tenant fix). Fall back to the user's
        // first workspace and refresh localStorage.
        if (!workspace) {
          const workspaces = await workspaceApi.listWorkspaces();
          workspace = workspaces[0] ?? null;
          const healedId = workspace?._id || workspace?.id;
          if (healedId) {
            localStorage.setItem('currentWorkspaceId', healedId);
            localStorage.setItem('defaultWorkspaceId', healedId);
          }
        }
        if (workspace) {
          setCurrentWorkspace(workspace);
        }
      }

      if (workspace) {
        const workspaceId = workspace._id || workspace.id || '';
        // Fetch workflows for the workspace
        const workflowsResponse = await workflowApi.listWorkflows(workspaceId);
        setWorkflows(workflowsResponse);

        // Fetch recent executions (across all workflows in workspace)
        const executionLists = await Promise.all(
          workflowsResponse.slice(0, 20).map(async (workflow) => {
            const workflowId = workflow._id || workflow.id;
            if (!workflowId) return [];
            try {
              return await executionApi.listExecutions(workflowId, workspaceId);
            } catch {
              return [];
            }
          }),
        );
        const allExecutions = executionLists.flat();
        allExecutions.sort(
          (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
        );
        setExecutions(allExecutions);

        // Fetch recent audit events for the workspace
        if (workspaceId) {
          try {
            const activity = await collaborationApi.getActivityFeed({ limit: 5 }, workspaceId);
            setAuditEvents(
              activity.activities.map((item) => ({
                _id: item.id,
                id: item.id,
                action: item.action,
                userId: item.userId,
                workspaceId: item.workspaceId,
                resource: item.resource,
                resourceId: item.resourceId,
                ipAddress: item.ipAddress,
                createdAt: item.timestamp ?? item.createdAt,
              })),
            );
          } catch (auditError) {
            console.error('Failed to fetch activity feed:', auditError);
          }
        }
      }
    } catch (err: any) {
      console.error('Failed to fetch dashboard data:', err);
      setError(err?.message || err?.response?.data?.error?.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <Loading />;
  }

  if (error) {
    return <ErrorState message={error} onRetry={fetchDashboardData} />;
  }

  return (
    <div className="space-y-6">

      {/* Main */}
        <div className="space-y-6">
          {/* Welcome message */}
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-gray-900">
              Welcome back, {user?.email.split('@')[0]}!
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Here's an overview of your workspace activity.
            </p>
          </div>

          {/* Grid layout */}
          <div className="grid gap-6">
            {/* First row: Summary cards */}
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              <WorkflowSummary workflows={workflows} />
              <ExecutionSummary executions={executions} />
              <SuccessRate executions={executions} />
              {/* Placeholder for additional metric */}
              <div className="bg-white rounded-lg border p-6">
                <h3 className="text-lg font-medium text-gray-900">Workspaces</h3>
                <p className="mt-2 text-sm text-gray-500">
                  {currentWorkspace ? 1 : 0} active workspace
                </p>
              </div>
            </div>

            {/* Second row: Recent activity */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <RecentExecutions executions={executions} />
              <RecentAuditEvents events={auditEvents} />
            </div>
          </div>
        </div>
    </div>
  );
}