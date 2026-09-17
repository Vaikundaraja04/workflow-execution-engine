import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render as rtlRender, screen, waitFor, fireEvent } from '@testing-library/react';
import { ExecutionTable } from '@/features/execution-console/components/ExecutionTable';
import { ExecutionStatusTracker } from '@/features/execution-console/components/ExecutionStatusTracker';
import { ExecutionTimeline } from '@/features/execution-console/timeline/ExecutionTimeline';
import { NodeInspector } from '@/features/execution-console/inspector/NodeInspector';
import { ExecutionLogs } from '@/features/execution-console/logs/ExecutionLogs';
import { FailureAnalysisPanel } from '@/features/execution-console/components/FailureAnalysisPanel';
import { ExecutionActions } from '@/features/execution-console/components/ExecutionActions';
import { WorkerStatus } from '@/features/execution-console/dashboard/WorkerStatus';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { executionConsoleApi } from '@/services/executionConsoleApi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock ResizeObserver for React Flow (needed for JSDOM)
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Create a query client for React Query
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});

// Custom render function that wraps components with QueryClientProvider
const render = (ui: React.ReactElement, options?: any) =>
  rtlRender(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>,
    options
  );

import type {
  WorkflowExecution,
  ExecutionStatus,
  ExecutionTableRow,
  ExecutionLog,
  ExecutionNode,
  FailureAnalysisResult,
  WorkerMetrics
} from '@/types/execution';

// Mock the execution console API
vi.mock('@/services/executionConsoleApi', () => ({
  executionConsoleApi: {
    listExecutionsInWorkspace: vi.fn(),
    getExecution: vi.fn(),
    getExecutionLogs: vi.fn(),
    retryExecution: vi.fn(),
    replayExecution: vi.fn(),
    cancelExecution: vi.fn(),
    getDeadLetters: vi.fn(),
    getWorkerMetrics: vi.fn(),
    getExecutionAnalysis: vi.fn(),
  },
}));

describe('Execution Console Components', () => {
  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
  };

  const mockWorkspace = {
    _id: 'workspace-1',
    id: 'workspace-1',
    name: 'Test Workspace',
    slug: 'test-workspace',
    ownerId: 'user-1',
    role: 'OWNER' as const,
    createdAt: '2023-01-01T10:00:00Z',
    updatedAt: '2023-01-01T10:00:00Z',
  };

  const mockExecutions: WorkflowExecution[] = [
    {
      _id: '11111111-1111-1111-1111-111111111111',
      id: '11111111-1111-1111-1111-111111111111',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      status: 'SUCCEEDED' as ExecutionStatus,
      version: 1,
      triggerType: 'manual',
      initialInput: { test: 'data' },
      output: { result: 'success' },
      startedAt: '2023-01-01T10:00:00Z',
      finishedAt: '2023-01-01T10:05:00Z',
      createdAt: '2023-01-01T10:00:00Z',
      updatedAt: '2023-01-01T10:05:00Z',
      attemptsMade: 1,
    },
    {
      _id: '22222222-2222-2222-2222-222222222222',
      id: '22222222-2222-2222-2222-222222222222',
      workflowId: 'workflow-2',
      workspaceId: 'workspace-1',
      status: 'FAILED' as ExecutionStatus,
      version: 1,
      triggerType: 'api',
      initialInput: { test: 'data' },
      error: 'Something went wrong',
      startedAt: '2023-01-01T11:00:00Z',
      finishedAt: '2023-01-01T11:02:00Z',
      createdAt: '2023-01-01T11:00:00Z',
      updatedAt: '2023-01-01T11:02:00Z',
      attemptsMade: 3,
    },
    {
      _id: '33333333-3333-3333-3333-333333333333',
      id: '33333333-3333-3333-3333-333333333333',
      workflowId: 'workflow-3',
      workspaceId: 'workspace-1',
      status: 'RUNNING' as ExecutionStatus,
      version: 1,
      triggerType: 'schedule',
      initialInput: { test: 'data' },
      startedAt: '2023-01-01T12:00:00Z',
      createdAt: '2023-01-01T12:00:00Z',
      updatedAt: '2023-01-01T12:00:00Z',
      attemptsMade: 1,
    },
  ];

  const mockExecutionTableRows: ExecutionTableRow[] = [
    {
      id: '11111111-1111-1111-1111-111111111111',
      workflowName: 'Test Workflow 1',
      status: 'SUCCEEDED',
      duration: 300000, // 5 minutes in ms = 300s (5m)
      startedAt: '2023-01-01T10:00:00Z',
      finishedAt: '2023-01-01T10:05:00Z',
      retries: 1,
      triggeredBy: 'manual',
    },
    {
      id: '22222222-2222-2222-2222-222222222222',
      workflowName: 'Test Workflow 2',
      status: 'FAILED',
      duration: 120000, // 2 minutes in ms
      startedAt: '2023-01-01T11:00:00Z',
      finishedAt: '2023-01-01T11:02:00Z',
      retries: 3,
      triggeredBy: 'api',
    },
    {
      id: '33333333-3333-3333-3333-333333333333',
      workflowName: 'Test Workflow 3',
      status: 'RUNNING',
      duration: null,
      startedAt: '2023-01-01T12:00:00Z',
      finishedAt: null,
      retries: 1,
      triggeredBy: 'schedule',
    },
  ];

  const mockLogs: ExecutionLog[] = [
    {
      timestamp: '2023-01-01T10:00:00Z',
      level: 'INFO' as const,
      message: 'Execution started',
    },
    {
      timestamp: '2023-01-01T10:01:00Z',
      level: 'INFO' as const,
      message: 'Processing data',
    },
    {
      timestamp: '2023-01-01T10:02:00Z',
      level: 'WARN' as const,
      message: 'High memory usage detected',
    },
    {
      timestamp: '2023-01-01T10:03:00Z',
      level: 'ERROR' as const,
      message: 'Failed to process item',
      nodeId: 'node-2',
    },
  ];

  const mockNodes: ExecutionNode[] = [
    {
      id: 'node-1',
      name: 'Start',
      type: 'trigger',
      status: 'SUCCEEDED' as ExecutionStatus,
      startedAt: '2023-01-01T10:00:00Z',
      finishedAt: '2023-01-01T10:00:30Z',
      duration: 30000,
      attempt: 1,
      input: { trigger: 'manual' },
      output: { initiated: true },
      error: null,
    },
    {
      id: 'node-2',
      name: 'Process Data',
      type: 'action',
      status: 'FAILED' as ExecutionStatus,
      startedAt: '2023-01-01T10:00:30Z',
      finishedAt: '2023-01-01T10:02:00Z',
      duration: 90000,
      attempt: 2,
      input: { data: 'input' },
      output: null,
      error: 'Processing failed',
    },
    {
      id: 'node-3',
      name: 'End',
      type: 'action',
      status: 'QUEUED' as ExecutionStatus,
      startedAt: null,
      finishedAt: null,
      duration: null,
      attempt: 0,
      input: {},
      output: {},
      error: null,
    },
  ];

  const mockFailureAnalysis: FailureAnalysisResult = {
    rootCause: 'Invalid input data format',
    affectedNode: 'node-2',
    resolution: 'Validate input data before processing',
    confidence: 0.85,
  };

  const mockWorkerMetrics: WorkerMetrics = {
    activeWorkers: 5,
    totalWorkers: 10,
    queueDepth: {
      executions: 3,
      webhooks: 1,
      total: 4,
    },
    heartbeatLatencyMs: 45,
    recommendations: [
      'Consider adding 2 more workers during peak hours',
      'Webhook queue is healthy',
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    // Clear query client cache to prevent pollution between tests
    queryClient.clear();

    // Set up auth store
    useAuthStore.setState({
      user: mockUser,
      accessToken: 'test-token',
      refreshToken: 'test-refresh-token',
      defaultWorkspaceId: 'workspace-1',
      isAuthenticated: true,
      isLoading: false,
    });

    // Set up workspace store
    useWorkspaceStore.setState({
      currentWorkspace: mockWorkspace,
      workspaces: [mockWorkspace],
      currentRole: 'OWNER' as const,
      isLoading: false,
      error: null,
    });

    // Mock API responses
    vi.mocked(executionConsoleApi.listExecutionsInWorkspace).mockResolvedValue(mockExecutionTableRows);
    vi.mocked(executionConsoleApi.getExecution).mockResolvedValue(mockExecutions[0]); // Succeeded execution by default
    vi.mocked(executionConsoleApi.getExecutionLogs).mockResolvedValue(mockLogs);
    vi.mocked(executionConsoleApi.getWorkerMetrics).mockResolvedValue(mockWorkerMetrics);
    vi.mocked(executionConsoleApi.getExecutionAnalysis).mockResolvedValue(mockFailureAnalysis);
    vi.mocked(executionConsoleApi.retryExecution).mockResolvedValue({ success: true } as any);
    vi.mocked(executionConsoleApi.replayExecution).mockResolvedValue({ success: true } as any);
    vi.mocked(executionConsoleApi.cancelExecution).mockResolvedValue({ success: true } as any);
  });

  describe('Execution Table', () => {
    it('should render executions table with data', () => {
      render(<ExecutionTable executions={mockExecutionTableRows} onExecutionSelect={vi.fn()} />);

      // Should show table headers
      expect(screen.getByText(/execution id/i)).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /workflow/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /status/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /duration/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /started/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /completed/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /retries/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /triggered by/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /actions/i })).toBeInTheDocument();

      // Should show execution rows
      expect(screen.getByText(/11111111.../)).toBeInTheDocument();
      expect(screen.getByText(/test workflow 1/i)).toBeInTheDocument();
      expect(screen.getAllByText(/succeeded/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/300s/)).toBeInTheDocument(); // 300000ms = 5min = 300s
      expect(screen.getByText(/test workflow 2/i)).toBeInTheDocument();
      expect(screen.getAllByText(/running/i).length).toBeGreaterThan(0);
    });

    it('should show empty state when no executions', () => {
      render(<ExecutionTable executions={[]} onExecutionSelect={vi.fn()} />);

      expect(screen.getByText(/no executions found/i)).toBeInTheDocument();
    });

    it('should handle pagination controls', () => {
      const manyExecutions = Array(25).fill(null).map((_, index) => ({
        ...mockExecutionTableRows[0],
        id: `execution-${index + 1}`,
        workflowName: `Test Workflow ${index + 1}`,
      }));

      render(
        <ExecutionTable
          executions={manyExecutions}
          currentPage={1}
          totalPages={3}
          pageSize={10}
          onPageChange={vi.fn()}
          onExecutionSelect={vi.fn()}
        />
      );

      expect(screen.getByText(/page 1 of 3/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled(); // First page
      expect(screen.getByRole('button', { name: /next/i })).toBeEnabled();
    });

    it('should call onExecutionSelect when row is clicked', () => {
      const onExecutionSelect = vi.fn();
      render(<ExecutionTable executions={mockExecutionTableRows} onExecutionSelect={onExecutionSelect} />);

      // Click first execution row
      const firstRow = screen.getByRole('row', { name: /11111111.*test workflow 1/i });
      fireEvent.click(firstRow);

      expect(onExecutionSelect).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111');
    });
  });

  describe('Execution Status Tracker', () => {
    it('should show loading state', () => {
      vi.mocked(executionConsoleApi.getExecution).mockImplementation(() => new Promise(() => {}));

      render(<ExecutionStatusTracker executionId="execution-1" workspaceId="workspace-1" />);

      expect(screen.getByText(/loading execution status/i)).toBeInTheDocument();
      expect(screen.getByTitle(/refresh/i)).toHaveClass('animate-spin');
    });

    it('should show error state', async () => {
      vi.mocked(executionConsoleApi.getExecution).mockRejectedValue(new Error('API Error'));

      render(<ExecutionStatusTracker executionId="execution-1" workspaceId="workspace-1" />);

      expect(await screen.findByText(/error loading status/i)).toBeInTheDocument();
    });

    it('should show execution not found', async () => {
      vi.mocked(executionConsoleApi.getExecution).mockResolvedValue(null as any);

      render(<ExecutionStatusTracker executionId="execution-1" workspaceId="workspace-1" />);

      expect(await screen.findByText(/execution not found/i)).toBeInTheDocument();
    });

    it('should display succeeded execution status', async () => {
      vi.mocked(executionConsoleApi.getExecution).mockResolvedValue(mockExecutions[0]); // SUCCEEDED

      render(<ExecutionStatusTracker executionId="execution-1" workspaceId="workspace-1" />);

      // Use getByTestId for the status text to avoid duplicate text matches
      expect(await screen.findByTestId('execution-status')).toHaveTextContent(/succeeded/i);
      expect(screen.getByTitle(/activity/i)).not.toHaveClass('animate-pulse');
    });

    it('should display running execution status with pulse animation', async () => {
      const runningExecution = { ...mockExecutions[0], status: 'RUNNING' as ExecutionStatus };
      vi.mocked(executionConsoleApi.getExecution).mockResolvedValue(runningExecution);

      render(<ExecutionStatusTracker executionId="execution-3" workspaceId="workspace-1" />);

      expect(await screen.findByText(/running/i)).toBeInTheDocument();
      expect(screen.getByTitle(/activity/i)).toHaveClass('animate-pulse');
    });

    it('should show duration and timestamps', async () => {
      vi.mocked(executionConsoleApi.getExecution).mockResolvedValue(mockExecutions[0]); // SUCCEEDED

      render(<ExecutionStatusTracker executionId="execution-1" workspaceId="workspace-1" />);

      expect(await screen.findByText(/started/i)).toBeInTheDocument();
      expect(await screen.findByText(/finished/i)).toBeInTheDocument();
      expect(await screen.findByText(/duration/i)).toBeInTheDocument();
      expect(await screen.findByText(/300s/i)).toBeInTheDocument(); // 300000ms = 5min = 300s
    });

    it('should show elapsed time for running executions', async () => {
      const runningExecution = { ...mockExecutions[0], status: 'RUNNING' as ExecutionStatus, finishedAt: null };
      vi.mocked(executionConsoleApi.getExecution).mockResolvedValue(runningExecution);

      render(<ExecutionStatusTracker executionId="execution-3" workspaceId="workspace-1" />);

      expect(await screen.findByText(/elapsed/i)).toBeInTheDocument();
    });

    it('should indicate websocket readiness', async () => {
      vi.mocked(executionConsoleApi.getExecution).mockResolvedValue(mockExecutions[0]);

      render(<ExecutionStatusTracker executionId="execution-1" workspaceId="workspace-1" />);

      expect(await screen.findByText(/websocket ready/i)).toBeInTheDocument();
    });
  });

  describe('Execution Timeline', () => {
    it('should render timeline with nodes', () => {
      render(<ExecutionTimeline nodes={mockNodes} selectedNodeId={null} onSelectNode={vi.fn()} className="h-[450px]" />);

      // Should show node elements by their test IDs
      expect(screen.getByTestId('timeline-node-node-1')).toHaveTextContent('Start');
      expect(screen.getByTestId('timeline-node-node-2')).toHaveTextContent('Process Data');
      expect(screen.getByTestId('timeline-node-node-3')).toHaveTextContent('End');

      // Should show status badges & durations
      expect(screen.getByTestId('timeline-node-node-1')).toHaveTextContent(/succeeded/i);
      expect(screen.getByTestId('timeline-node-node-1')).toHaveTextContent(/30s/i);
      expect(screen.getByTestId('timeline-node-node-2')).toHaveTextContent(/failed/i);
      expect(screen.getByTestId('timeline-node-node-2')).toHaveTextContent(/1m 30s/i);
      expect(screen.getByTestId('timeline-node-node-3')).toHaveTextContent(/queued/i);
    });

    it('should highlight selected node', () => {
      const onSelectNode = vi.fn();
      render(
        <ExecutionTimeline
          nodes={mockNodes}
          selectedNodeId="node-2"
          onSelectNode={onSelectNode}
          className="h-[450px]"
        />
      );

      // Click on node-2 card
      const nodeElement = screen.getByTestId('timeline-node-node-2');
      fireEvent.click(nodeElement);

      expect(onSelectNode).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'node-2',
          name: 'Process Data',
        })
      );
    });
  });

  describe('Node Inspector', () => {
    it('should show node inputs and outputs', () => {
      render(<NodeInspector node={mockNodes[0]} onClose={vi.fn()} />); // Start node

      expect(screen.getByRole('heading', { name: /^start$/i })).toBeInTheDocument();
      // Look for the input JSON in the pre tag
      expect(screen.getByText(/"trigger":\s*"manual"/i)).toBeInTheDocument();

      // Switch to outputs tab
      fireEvent.click(screen.getByRole('button', { name: /outputs/i }));
      expect(screen.getByText(/initiated/i)).toBeInTheDocument();
    });

    it('should show error information for failed nodes', () => {
      render(<NodeInspector node={mockNodes[1]} onClose={vi.fn()} />); // Process Data node (failed)

      expect(screen.getByRole('heading', { name: /process data/i })).toBeInTheDocument();

      // Switch to outputs tab where error is rendered
      fireEvent.click(screen.getByRole('button', { name: /outputs/i }));
      expect(screen.getByText(/processing failed/i)).toBeInTheDocument();

      // Switch to metadata tab where attempt count is rendered
      fireEvent.click(screen.getByRole('button', { name: /metadata/i }));
      expect(screen.getByText(/#2/i)).toBeInTheDocument(); // attempt count
    });

    it('should handle null node gracefully', () => {
      render(<NodeInspector node={null} onClose={vi.fn()} />);

      expect(screen.getByText(/no node selected/i)).toBeInTheDocument();
    });
  });

  describe('Execution Logs', () => {
    it('should render logs with timestamps and levels', () => {
      render(<ExecutionLogs logs={mockLogs} executionId="execution-1" workflowName="Test Workflow" />);

      expect(screen.getByText(/execution started/i)).toBeInTheDocument();
      expect(screen.getByText(/processing data/i)).toBeInTheDocument();
      expect(screen.getByText(/high memory usage detected/i)).toBeInTheDocument();
      expect(screen.getByText(/failed to process item/i)).toBeInTheDocument();

      // Check level indicators
      expect(screen.getAllByText(/info/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/warn/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/error/i).length).toBeGreaterThan(0);
    });

    it('should show empty state when no logs', () => {
      render(<ExecutionLogs logs={[]} executionId="execution-1" workflowName="Test Workflow" />);

      expect(screen.getByText(/no logs available/i)).toBeInTheDocument();
    });

    it('should show log count in badge', () => {
      render(<ExecutionLogs logs={mockLogs} executionId="execution-1" workflowName="Test Workflow" />);

      expect(screen.getByText(/\(4 \/ 4 lines\)/i)).toBeInTheDocument(); // 4 log entries
    });
  });

  describe('Failure Analysis Panel', () => {
    it('should show AI analysis for failed execution', async () => {
      render(
        <FailureAnalysisPanel
          executionId="execution-2"
          workspaceId="workspace-1"
          isFailed={true}
        />
      );

      expect(await screen.findByText(/invalid input data format/i)).toBeInTheDocument();
      expect(await screen.findByText(/node-2/i)).toBeInTheDocument();
      expect(await screen.findByText(/validate input data before processing/i)).toBeInTheDocument();
      expect(await screen.findByText(/85%/i)).toBeInTheDocument(); // confidence
    });

    it('should hide panel for non-failed executions', () => {
      render(
        <FailureAnalysisPanel
          executionId="execution-1"
          workspaceId="workspace-1"
          isFailed={false}
        />
      );

      expect(screen.queryByText(/invalid input data format/i)).not.toBeInTheDocument();
    });

    it('should require AI_ANALYSIS_READ permission', async () => {
      // Test with VIEWER role (has AI_ANALYSIS_READ)
      useWorkspaceStore.setState({ currentRole: 'VIEWER' });
      render(
        <FailureAnalysisPanel
          executionId="execution-2"
          workspaceId="workspace-1"
          isFailed={true}
        />
      );

      expect(await screen.findByText(/invalid input data format/i)).toBeInTheDocument();
    });
  });

  describe('Execution Actions', () => {
    it('should show retry button for failed executions', () => {
      render(
        <ExecutionActions
          executionId="execution-2"
          status="FAILED"
          workspaceId="workspace-1"
          onActionComplete={vi.fn()}
        />
      );

      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    });

    it('should hide retry button for non-failed executions', () => {
      render(
        <ExecutionActions
          executionId="execution-1"
          status="SUCCEEDED"
          workspaceId="workspace-1"
          onActionComplete={vi.fn()}
        />
      );

      expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    });

    it('should show replay button for completed executions', () => {
      render(
        <ExecutionActions
          executionId="execution-1"
          status="SUCCEEDED"
          workspaceId="workspace-1"
          onActionComplete={vi.fn()}
        />
      );

      expect(screen.getByRole('button', { name: /replay/i })).toBeInTheDocument();
    });

    it('should hide replay button for non-completed executions', () => {
      render(
        <ExecutionActions
          executionId="execution-3"
          status="RUNNING"
          workspaceId="workspace-1"
          onActionComplete={vi.fn()}
        />
      );

      expect(screen.queryByRole('button', { name: /replay/i })).not.toBeInTheDocument();
    });

    it('should show cancel button for running executions', () => {
      render(
        <ExecutionActions
          executionId="execution-3"
          status="RUNNING"
          workspaceId="workspace-1"
          onActionComplete={vi.fn()}
        />
      );

      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });

    it('should hide cancel button for non-running executions', () => {
      render(
        <ExecutionActions
          executionId="execution-1"
          status="SUCCEEDED"
          workspaceId="workspace-1"
          onActionComplete={vi.fn()}
        />
      );

      expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
    });

    it('should require WORKFLOW_EXECUTE permission for actions', () => {
      // Test with VIEWER role (does NOT have WORKFLOW_EXECUTE)
      useWorkspaceStore.setState({ currentRole: 'VIEWER' });
      render(
        <ExecutionActions
          executionId="execution-2"
          status="FAILED"
          workspaceId="workspace-1"
          onActionComplete={vi.fn()}
        />
      );

      expect(screen.getByText(/restricted to editors & admins/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    });

    it('should show confirmation modal for cancel action', async () => {
      const onActionComplete = vi.fn();
      render(
        <ExecutionActions
          executionId="execution-3"
          status="RUNNING"
          workspaceId="workspace-1"
          onActionComplete={onActionComplete}
        />
      );

      // Click cancel button
      const cancelButton = screen.getByRole('button', { name: /cancel execution/i });
      fireEvent.click(cancelButton);

      // Should show confirmation modal
      expect(screen.getByText(/are you sure you want to abort/i)).toBeInTheDocument();
      expect(screen.getByText(/cancellation reason/i)).toBeInTheDocument();

      // Confirm cancellation
      const confirmButton = screen.getByRole('button', { name: /yes, cancel execution/i });
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(onActionComplete).toHaveBeenCalledWith('cancel', { success: true });
      });
    });
  });

  describe('Worker Status Panel', () => {
    it('should render worker metrics', async () => {
      render(<WorkerStatus refreshInterval={30} />);

      expect(await screen.findByText(/active workers/i)).toBeInTheDocument();
      expect(await screen.findByText('5/10 Active')).toBeInTheDocument();
      expect(await screen.findByText('10 Total')).toBeInTheDocument();
      expect(await screen.findByText(/execution queue/i)).toBeInTheDocument();
      expect(await screen.findByText('3')).toBeInTheDocument(); // executions queue depth
      expect(await screen.findByText(/webhook queue/i)).toBeInTheDocument();
      expect(await screen.findByText('1')).toBeInTheDocument(); // webhooks queue depth
      expect(await screen.findByText(/heartbeat latency:/i)).toBeInTheDocument();
      expect(await screen.findByText(/45ms/i)).toBeInTheDocument();
      expect(await screen.findByText(/consider adding 2 more workers/i)).toBeInTheDocument();
    });
  });
});