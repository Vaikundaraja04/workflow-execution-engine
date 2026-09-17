'use client';

import { useEffect, useState } from 'react';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { workflowApi } from '@/services/workflowApi';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { ExecutionFilters as FiltersType, ExecutionStatus } from '@/features/execution-console/types/types';
import { Search, RotateCcw, Filter } from 'lucide-react';

interface ExecutionFiltersProps {
  onFiltersChange: (filters: FiltersType) => void;
  initialFilters?: FiltersType;
}

const STATUS_OPTIONS: { label: string; value: ExecutionStatus }[] = [
  { label: 'Queuing', value: 'QUEUING' },
  { label: 'Queued', value: 'QUEUED' },
  { label: 'Running', value: 'RUNNING' },
  { label: 'Succeeded', value: 'SUCCEEDED' },
  { label: 'Failed', value: 'FAILED' },
  { label: 'Cancelled', value: 'CANCELLED' },
  { label: 'Retrying', value: 'RETRYING' },
];

export function ExecutionFilters({ onFiltersChange, initialFilters }: ExecutionFiltersProps) {
  const { currentWorkspace } = useWorkspaceStore();
  const [workflows, setWorkflows] = useState<Array<{ id: string; name: string }>>([]);
  const [loadingWorkflows, setLoadingWorkflows] = useState(false);
  const [filters, setFilters] = useState<FiltersType>(
    initialFilters || {
      status: [],
      workflowId: undefined,
      dateRange: undefined,
      search: undefined,
    }
  );

  // Fetch workflows for the current workspace
  useEffect(() => {
    if (!currentWorkspace) {
      setWorkflows([]);
      return;
    }

    const workspaceId = currentWorkspace._id || currentWorkspace.id || '';
    if (!workspaceId) return;

    setLoadingWorkflows(true);
    workflowApi
      .listWorkflows(workspaceId)
      .then((workflowList) => {
        setWorkflows(
          workflowList.map((w: any) => ({
            id: w._id || w.id || '',
            name: w.name || 'Unnamed Workflow',
          }))
        );
      })
      .catch((error) => {
        console.error('Failed to fetch workflows for filters:', error);
        setWorkflows([]);
      })
      .finally(() => {
        setLoadingWorkflows(false);
      });
  }, [currentWorkspace]);

  const handleStatusToggle = (status: ExecutionStatus) => {
    const currentStatuses = filters.status || [];
    const newStatuses = currentStatuses.includes(status)
      ? currentStatuses.filter((s) => s !== status)
      : [...currentStatuses, status];

    const updated = { ...filters, status: newStatuses };
    setFilters(updated);
    onFiltersChange(updated);
  };

  const handleWorkflowChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const workflowId = e.target.value || undefined;
    const updated = { ...filters, workflowId };
    setFilters(updated);
    onFiltersChange(updated);
  };

  const handleStartDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const start = e.target.value;
    const currentEnd = filters.dateRange?.end || '';
    const dateRange = start || currentEnd ? { start: start || '', end: currentEnd } : undefined;
    const updated = { ...filters, dateRange };
    setFilters(updated);
    onFiltersChange(updated);
  };

  const handleEndDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const end = e.target.value;
    const currentStart = filters.dateRange?.start || '';
    const dateRange = currentStart || end ? { start: currentStart, end: end || '' } : undefined;
    const updated = { ...filters, dateRange };
    setFilters(updated);
    onFiltersChange(updated);
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const search = e.target.value || undefined;
    const updated = { ...filters, search };
    setFilters(updated);
    onFiltersChange(updated);
  };

  const handleReset = () => {
    const resetFilters: FiltersType = {
      status: [],
      workflowId: undefined,
      dateRange: undefined,
      search: undefined,
    };
    setFilters(resetFilters);
    onFiltersChange(resetFilters);
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm space-y-4">
      <div className="flex items-center justify-between border-b border-gray-100 pb-3">
        <div className="flex items-center space-x-2 text-sm font-semibold text-gray-700">
          <Filter className="w-4 h-4 text-blue-600" />
          <span>Execution Filters</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleReset}
          className="text-xs h-8 text-gray-600 hover:text-gray-900"
        >
          <RotateCcw className="w-3.5 h-3.5 mr-1" />
          Reset
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Search */}
        <div>
          <Input
            placeholder="Search by ID or workflow..."
            value={filters.search || ''}
            onChange={handleSearchChange}
            leftIcon={<Search className="w-4 h-4 text-gray-400" />}
            className="h-9 text-sm"
          />
        </div>

        {/* Workflow select */}
        <div>
          <select
            value={filters.workflowId || ''}
            onChange={handleWorkflowChange}
            aria-label="Filter by workflow"
            className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Workflows</option>
            {loadingWorkflows ? (
              <option disabled>Loading workflows...</option>
            ) : (
              workflows.map((wf) => (
                <option key={wf.id} value={wf.id}>
                  {wf.name}
                </option>
              ))
            )}
          </select>
        </div>

        {/* Date range start */}
        <div>
          <input
            type="date"
            placeholder="Start date"
            aria-label="Start date"
            value={filters.dateRange?.start || ''}
            onChange={handleStartDateChange}
            className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Date range end */}
        <div>
          <input
            type="date"
            placeholder="End date"
            aria-label="End date"
            value={filters.dateRange?.end || ''}
            onChange={handleEndDateChange}
            className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Status pills */}
      <div className="pt-1">
        <label className="block text-xs font-medium text-gray-500 mb-1.5">Status Filter</label>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_OPTIONS.map((opt) => {
            const isSelected = (filters.status || []).includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleStatusToggle(opt.value)}
                className={`px-2.5 py-1 text-xs rounded-full font-medium transition-all ${
                  isSelected
                    ? 'bg-blue-600 text-white shadow-sm ring-1 ring-blue-600'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
export default ExecutionFilters;
