import { apiClient } from './apiClient';
import { workflowApi } from './workflowApi';
import { executionApi } from './executionApi';
import type {
  WorkflowExecution,
  DeadLetter,
  CreateExecutionPayload,
  ExecutionStatus
} from '@/types/execution';
import type {
  ExecutionFilters,
  ExecutionTableRow,
  ExecutionDetail,
  ExecutionNode,
  ExecutionLog,
  FailureAnalysisResult,
  WorkerMetrics
} from '@/features/execution-console/types/types';

// Helper to convert WorkflowExecution to ExecutionTableRow
const toExecutionTableRow = (execution: WorkflowExecution, workflowName: string): ExecutionTableRow => ({
  id: execution._id,
  workflowName,
  status: execution.status as ExecutionStatus,
  duration: execution.finishedAt && execution.startedAt
    ? new Date(execution.finishedAt).getTime() - new Date(execution.startedAt).getTime()
    : null,
  startedAt: execution.startedAt || '',
  finishedAt: execution.finishedAt || null,
  retries: execution.attemptsMade ?? execution.retryCount ?? 0,
  triggeredBy: execution.triggerType || 'unknown',
});

export const executionConsoleApi = {
  // Get workflows in workspace
  getWorkflows: async (_unused?: unknown, workspaceId?: string) => {
    return workflowApi.listWorkflows(workspaceId);
  },

  // List executions in the workspace with filtering
  listExecutionsInWorkspace: async (filters: ExecutionFilters = {}): Promise<ExecutionTableRow[]> => {
    try {
      // Get workflows in the workspace
      const workflows = await workflowApi.listWorkflows(filters.workspaceId);

      // For each workflow, get executions
      const executionPromises = workflows.map(workflow =>
        executionApi.listExecutions(workflow._id, filters.workspaceId)
          .then(executions => executions.map(exec => toExecutionTableRow(exec, workflow.name)))
      );

      const executionsArrays = await Promise.all(executionPromises);
      const allExecutions = executionsArrays.flat();

      // Apply filters
      let filtered = allExecutions;

      // Status filter
      if (filters.status && filters.status.length > 0) {
        filtered = filtered.filter(execution => filters.status!.includes(execution.status));
      }

      // Date range filter
      if (filters.dateRange) {
        const start = new Date(filters.dateRange.start);
        const end = new Date(filters.dateRange.end);
        filtered = filtered.filter(execution => {
          const startedAt = new Date(execution.startedAt);
          return startedAt >= start && startedAt <= end;
        });
      }

      // Search filter
      if (filters.search) {
        const searchTerm = filters.search.toLowerCase();
        filtered = filtered.filter(execution =>
          execution.workflowName.toLowerCase().includes(searchTerm) ||
          execution.id.includes(searchTerm)
        );
      }

      // Sort by startedAt descending (newest first)
      filtered.sort((a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
      );

      return filtered;
    } catch (error) {
      console.error('Failed to list executions:', error);
      throw error;
    }
  },

  // Get execution by ID
  getExecution: async (executionId: string, workspaceId?: string): Promise<WorkflowExecution> => {
    return executionApi.getExecution(executionId, workspaceId);
  },

  // Get execution logs
  getExecutionLogs: async (executionId: string, workspaceId?: string): Promise<ExecutionLog[]> => {
    const config = workspaceId ? { headers: { 'X-Workspace-Id': workspaceId } } : undefined;
    const response = await apiClient.get<ExecutionLog[]>(
      `/api/executions/${executionId}/logs`,
      config
    );
    return response.data;
  },

  // Retry a failed execution
  retryExecution: async (executionId: string, payload: CreateExecutionPayload = {}, workspaceId?: string): Promise<WorkflowExecution> => {
    const config = workspaceId ? { headers: { 'X-Workspace-Id': workspaceId } } : undefined;
    const response = await apiClient.post<WorkflowExecution>(
      `/api/executions/${executionId}/retry`,
      payload,
      config
    );
    return response.data;
  },

  // Replay a completed execution
  replayExecution: async (executionId: string, workspaceId?: string): Promise<WorkflowExecution> => {
    return executionApi.replayExecution(executionId, workspaceId);
  },

  // Cancel an execution
  cancelExecution: async (executionId: string, reason?: string, workspaceId?: string): Promise<WorkflowExecution> => {
    return executionApi.cancelExecution(executionId, reason, workspaceId);
  },

  // Get dead letters for a workflow
  getDeadLetters: async (workflowId: string, workspaceId?: string): Promise<DeadLetter[]> => {
    return executionApi.listDeadLetters(workflowId, workspaceId);
  },

  // Get worker metrics
  getWorkerMetrics: async (): Promise<WorkerMetrics> => {
    const response = await apiClient.get<WorkerMetrics>(
      `/api/v1/admin/system/workers/metrics`
    );
    return response.data;
  },

  // Get AI failure analysis for an execution
  getExecutionAnalysis: async (executionId: string, workspaceId?: string): Promise<FailureAnalysisResult> => {
    const config = workspaceId ? { headers: { 'X-Workspace-Id': workspaceId } } : undefined;
    const response = await apiClient.get<FailureAnalysisResult>(
      `/api/v1/ai/executions/${executionId}/analyze`,
      config
    );
    return response.data;
  },
};

export default executionConsoleApi;
