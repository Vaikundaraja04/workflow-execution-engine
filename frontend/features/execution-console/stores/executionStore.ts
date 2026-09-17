import { create } from 'zustand';
import type {
  ExecutionFilters,
  ExecutionTableRow,
  ExecutionDetail,
  ExecutionNode,
  ExecutionLog,
  FailureAnalysisResult,
  WorkerMetrics
} from '@/features/execution-console/types/types';

interface ExecutionConsoleState {
  // State
  selectedExecution: ExecutionDetail | null;
  filters: ExecutionFilters;
  selectedNode: ExecutionNode | null;
  logSettings: {
    showTimestamp: boolean;
    showLevel: boolean;
    levels: Record<'INFO' | 'WARN' | 'ERROR' | 'DEBUG', boolean>;
  };
  refreshState: {
    isRefreshing: boolean;
    lastRefresh: Date | null;
  };
  workerMetrics: WorkerMetrics | null;

  // Actions
  setSelectedExecution: (execution: ExecutionDetail | null) => void;
  setFilters: (filters: ExecutionFilters) => void;
  setSelectedNode: (node: ExecutionNode | null) => void;
  updateLogSettings: (settings: Partial<ExecutionConsoleState['logSettings']>) => void;
  setRefreshState: (state: Partial<ExecutionConsoleState['refreshState']>) => void;
  setWorkerMetrics: (metrics: WorkerMetrics | null) => void;
  reset: () => void;
}

const defaultFilters: ExecutionFilters = {
  status: [],
  workflowId: undefined,
  dateRange: undefined,
  search: undefined,
};

const defaultLogSettings = {
  showTimestamp: true,
  showLevel: true,
  levels: {
    INFO: true,
    WARN: true,
    ERROR: true,
    DEBUG: false,
  },
};

const defaultRefreshState = {
  isRefreshing: false,
  lastRefresh: null,
};

export const useExecutionStore = create<ExecutionConsoleState>((set) => ({
  // Initial state
  selectedExecution: null,
  filters: defaultFilters,
  selectedNode: null,
  logSettings: defaultLogSettings,
  refreshState: defaultRefreshState,
  workerMetrics: null,

  // Actions
  setSelectedExecution: (execution) => set({ selectedExecution: execution }),
  setFilters: (filters) => set({ filters }),
  setSelectedNode: (node) => set({ selectedNode: node }),
  updateLogSettings: (settings) => set((state) => ({
    logSettings: { ...state.logSettings, ...settings },
  })),
  setRefreshState: (state) => set((state) => ({
    refreshState: { ...state.refreshState, ...state },
  })),
  setWorkerMetrics: (metrics) => set({ workerMetrics: metrics }),
  reset: () => set({
    selectedExecution: null,
    filters: defaultFilters,
    selectedNode: null,
    logSettings: defaultLogSettings,
    refreshState: defaultRefreshState,
    workerMetrics: null,
  }),
}));