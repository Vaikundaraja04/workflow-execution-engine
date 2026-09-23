import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import DashboardPage from '@/app/(app)/dashboard/page';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { workspaceApi } from '@/services/workspaceApi';
import { workflowApi } from '@/services/workflowApi';
import { executionApi } from '@/services/executionApi';
import { analyticsApi } from '@/services/analyticsApi';
import { collaborationApi } from '@/services/collaborationApi';
import type { Workspace } from '@/types/workspace';
import type { Workflow } from '@/types/workflow';
import type { WorkflowExecution } from '@/types/execution';

const mockPush = vi.fn();
const mockRouter = {
  push: mockPush,
  replace: vi.fn(),
  prefetch: vi.fn(),
};
vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}));

vi.mock('@/services/workspaceApi', () => ({
  workspaceApi: {
    listWorkspaces: vi.fn(),
    getWorkspace: vi.fn(),
    createWorkspace: vi.fn(),
    updateWorkspace: vi.fn(),
    listMembers: vi.fn(),
    addMember: vi.fn(),
    updateMemberRole: vi.fn(),
    removeMember: vi.fn(),
  },
}));

vi.mock('@/services/workflowApi', () => ({
  workflowApi: {
    listWorkflows: vi.fn(),
    getWorkflow: vi.fn(),
    createWorkflow: vi.fn(),
    updateDraft: vi.fn(),
    validateDraft: vi.fn(),
    publishWorkflow: vi.fn(),
  },
}));

vi.mock('@/services/executionApi', () => ({
  executionApi: {
    listExecutions: vi.fn(),
    getExecution: vi.fn(),
    createExecution: vi.fn(),
    replayExecution: vi.fn(),
    cancelExecution: vi.fn(),
    listDeadLetters: vi.fn(),
  },
}));

vi.mock('@/services/analyticsApi', () => ({
  analyticsApi: {
    getWorkspaceAnalytics: vi.fn(),
    getWorkflowAnalytics: vi.fn(),
    getExecutionMetrics: vi.fn(),
  },
}));
 vi.mock('@/services/collaborationApi', () => ({   collaborationApi: {     getActivityFeed: vi.fn(),   }, }));

vi.mock('@/services/authService', () => ({
  authService: {
    logout: vi.fn(),
  },
}));

describe('Dashboard Page', () => {
  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
  };

  const mockWorkspace: Workspace = {
    _id: 'workspace-1',
    id: 'workspace-1',
    name: 'Test Workspace',
    slug: 'test-workspace',
    ownerId: 'user-1',
    role: 'OWNER',
    createdAt: '2023-01-01T00:00:00Z',
    updatedAt: '2023-01-01T00:00:00Z',
  };

  const mockWorkflows: Workflow[] = [
    {
      _id: 'workflow-1',
      id: 'workflow-1',
      workspaceId: 'workspace-1',
      ownerId: 'user-1',
      name: 'Order Processing',
      publishedVersion: 1,
      currentVersion: 1,
      createdAt: '2023-01-01T00:00:00Z',
      updatedAt: '2023-01-01T00:00:00Z',
    },
    {
      _id: 'workflow-2',
      id: 'workflow-2',
      workspaceId: 'workspace-1',
      ownerId: 'user-1',
      name: 'Invoice Generator',
      publishedVersion: 0,
      currentVersion: 0,
      createdAt: '2023-01-01T00:00:00Z',
      updatedAt: '2023-01-01T00:00:00Z',
    },
  ];

  const mockExecutions: WorkflowExecution[] = [
    {
      _id: 'execution-1',
      id: 'execution-1',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      status: 'COMPLETED',
      version: 1,
      startedAt: '2023-01-01T10:00:00Z',
      createdAt: '2023-01-01T10:00:00Z',
      updatedAt: '2023-01-01T10:00:00Z',
    },
    {
      _id: 'execution-2',
      id: 'execution-2',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      status: 'FAILED',
      version: 1,
      startedAt: '2023-01-01T11:00:00Z',
      createdAt: '2023-01-01T11:00:00Z',
      updatedAt: '2023-01-01T11:00:00Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    useAuthStore.setState({
      user: mockUser,
      accessToken: 'test-token',
      refreshToken: 'test-refresh-token',
      defaultWorkspaceId: 'workspace-1',
      isAuthenticated: true,
      isLoading: false,
    });

    useWorkspaceStore.setState({
      currentWorkspace: mockWorkspace,
      workspaces: [mockWorkspace],
      currentRole: 'OWNER',
      isLoading: false,
      error: null,
    });

    vi.mocked(workspaceApi.listWorkspaces).mockResolvedValue([mockWorkspace]);
    vi.mocked(workspaceApi.getWorkspace).mockResolvedValue(mockWorkspace);
    vi.mocked(workflowApi.listWorkflows).mockResolvedValue(mockWorkflows);
    vi.mocked(executionApi.listExecutions).mockImplementation(async (workflowId: string) =>
      workflowId === 'workflow-1' ? mockExecutions : [],
    );
    vi.mocked(analyticsApi.getWorkspaceAnalytics).mockResolvedValue({
      workspaceId: 'workspace-1',
      totalWorkflows: 2,
      activeWorkflows: 1,
      totalExecutions: 2,
      successRate: 50,
    });
    vi.mocked(collaborationApi.getActivityFeed).mockResolvedValue({ activities: [], total: 0 });
  });

  it('should redirect to login if not authenticated', () => {
    useAuthStore.setState({
      user: null,
      accessToken: null,
      refreshToken: null,
      defaultWorkspaceId: null,
      isAuthenticated: false,
      isLoading: false,
    });

    render(<DashboardPage />);
    expect(mockPush).toHaveBeenCalledWith('/login');
  });

  it('should render dashboard when authenticated', async () => {
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText(/welcome back, test!/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/welcome back, test!/i)).toBeInTheDocument();
    expect(screen.getByText(/workflow summary/i)).toBeInTheDocument();
    expect(screen.getByText(/execution summary/i)).toBeInTheDocument();
    expect(screen.getByText(/success rate/i)).toBeInTheDocument();
    expect(screen.getByText(/1 published/i)).toBeInTheDocument();
    expect(screen.getByText(/1 in draft/i)).toBeInTheDocument();
    expect(screen.getByText(/1 success/i)).toBeInTheDocument();
    expect(screen.getByText(/1 failed/i)).toBeInTheDocument();
  });

  it('should handle error state gracefully', async () => {
    vi.mocked(workflowApi.listWorkflows).mockRejectedValue(
      new Error('Failed to load workflows')
    );

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
    });
  });
});
