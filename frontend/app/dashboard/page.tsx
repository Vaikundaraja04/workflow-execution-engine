'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { workspaceApi } from '@/services/workspaceApi';
import { workflowApi } from '@/services/workflowApi';
import { executionApi } from '@/services/executionApi';
import { analyticsApi } from '@/services/analyticsApi';
import { authService } from '@/services/authService';
import { Button } from '@/components/ui/Button';
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher';
import { WorkflowSummary } from '@/components/dashboard/WorkflowSummary';
import { ExecutionSummary } from '@/components/dashboard/ExecutionSummary';
import { SuccessRate } from '@/components/dashboard/SuccessRate';
import { RecentExecutions } from '@/components/dashboard/RecentExecutions';
import { RecentAuditEvents } from '@/components/dashboard/RecentAuditEvents';
import { Loading } from '@/components/ui/Loading';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';

export default function DashboardPage() {
  const { user, isAuthenticated, clearAuth } = useAuthStore();
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
      router.push('/login');
      return;
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
        const workspaceId = localStorage.getItem('currentWorkspaceId');
        if (workspaceId) {
          workspace = await workspaceApi.getWorkspace(workspaceId);
          setCurrentWorkspace(workspace);
        }
      }

      if (workspace) {
        const workspaceId = workspace._id || workspace.id || '';
        // Fetch workflows for the workspace
        const workflowsResponse = await workflowApi.listWorkflows(workspaceId);
        setWorkflows(workflowsResponse);

        // Fetch recent executions (across all workflows in workspace)
        if (workflowsResponse.length > 0) {
          const firstWorkflowId = workflowsResponse[0]._id || workflowsResponse[0].id || '';
          if (firstWorkflowId) {
            const executionsResponse = await executionApi.listExecutions(firstWorkflowId, workspaceId);
            setExecutions(executionsResponse);
          }
        }

        // Fetch recent audit events for the workspace
        if (workspaceId) {
          const auditResponse = await analyticsApi.getWorkspaceAnalytics(workspaceId);
          setAuditEvents([]); // Placeholder - would come from audit API
        }
      }
    } catch (err: any) {
      console.error('Failed to fetch dashboard data:', err);
      setError(err.response?.data?.error?.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      const refreshToken = localStorage.getItem('refreshToken');
      if (refreshToken) {
        await authService.logout(refreshToken);
      }
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      clearAuth();
      router.push('/login');
    }
  };

  if (loading) {
    return <Loading />;
  }

  if (error) {
    return <ErrorState message={error} onRetry={fetchDashboardData} />;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="border-b bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex">
              <div className="flex-shrink-0 flex items-center">
                <h1 className="text-xl font-semibold text-gray-900">
                  Workflow Execution Engine
                </h1>
              </div>
              <div className="hidden md:flex md:items-center md:space-x-4">
                <WorkspaceSwitcher workspace={currentWorkspace} onWorkspaceChange={fetchDashboardData} />
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex items-center text-sm text-gray-600">
                {user?.email && (
                  <>
                    <span className="mr-2">{user.email}</span>
                    <button
                      onClick={handleLogout}
                      className="text-gray-600 hover:text-gray-900"
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
      <main>
        <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
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
      </main>
    </div>
  );
}