'use client';

import React, { useState, useEffect } from 'react';
import { useOperationsStore } from '@/stores/operationsStore';
import { WorkflowAnalytics } from '@/features/enterprise-operations/WorkflowAnalytics';
import { ExecutionAnalytics } from '@/features/enterprise-operations/ExecutionAnalytics';
import { CostAnalytics } from '@/features/enterprise-operations/CostAnalytics';
import { Activity, BarChart3, DollarSign, Download, Clock } from 'lucide-react';

export default function AnalyticsPage() {
  const [timeframe, setTimeframe] = useState<'7d' | '30d' | '90d' | '1y'>('30d');
  const [activeSection, setActiveSection] = useState<'workflows' | 'executions' | 'cost'>('workflows');

  const {
    fetchWorkflowAnalytics,
    fetchExecutionAnalytics,
    fetchCostAnalytics,
    fetchOverviewAnalytics,
    exportAnalyticsData,
    isLoading,
  } = useOperationsStore();

  const workspaceId = 'workspace-1';

  useEffect(() => {
    fetchOverviewAnalytics(workspaceId, timeframe);
    fetchWorkflowAnalytics(workspaceId, timeframe);
    fetchExecutionAnalytics(workspaceId, timeframe);
    fetchCostAnalytics(workspaceId, timeframe);
  }, [timeframe, fetchOverviewAnalytics, fetchWorkflowAnalytics, fetchExecutionAnalytics, fetchCostAnalytics]);

  const handleExport = async (format: 'json' | 'csv') => {
    try {
      const { data, filename } = await exportAnalyticsData(workspaceId, activeSection, format);
      const url = window.URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error('Failed to export analytics data', err);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700 shadow-2xs">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-indigo-600" />
            Enterprise Analytics & Intelligence
          </h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Deep-dive operational metrics across workflow reliability, execution throughput, and cloud costs.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Timeframe Selector */}
          <div className="flex items-center bg-gray-100 dark:bg-gray-900 p-1 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-medium">
            {(['7d', '30d', '90d', '1y'] as const).map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`px-3 py-1.5 rounded-md transition ${
                  timeframe === tf
                    ? 'bg-white dark:bg-gray-800 text-indigo-600 dark:text-indigo-400 shadow-2xs font-semibold'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                {tf.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Export Dropdown / Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleExport('csv')}
              disabled={isLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg text-xs font-medium transition"
            >
              <Download className="w-3.5 h-3.5" />
              CSV
            </button>
            <button
              onClick={() => handleExport('json')}
              disabled={isLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-medium transition"
            >
              <Download className="w-3.5 h-3.5" />
              JSON
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 space-x-6 text-sm font-medium">
        <button
          onClick={() => setActiveSection('workflows')}
          className={`pb-3 flex items-center gap-2 border-b-2 transition ${
            activeSection === 'workflows'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 font-semibold'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          <Activity className="w-4 h-4" />
          Workflow Reliability
        </button>
        <button
          onClick={() => setActiveSection('executions')}
          className={`pb-3 flex items-center gap-2 border-b-2 transition ${
            activeSection === 'executions'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 font-semibold'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          <Clock className="w-4 h-4" />
          Execution Throughput & Latency
        </button>
        <button
          onClick={() => setActiveSection('cost')}
          className={`pb-3 flex items-center gap-2 border-b-2 transition ${
            activeSection === 'cost'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 font-semibold'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          <DollarSign className="w-4 h-4" />
          Cost Attribution
        </button>
      </div>

      {/* Active Tab Component */}
      <div>
        {activeSection === 'workflows' && <WorkflowAnalytics />}
        {activeSection === 'executions' && <ExecutionAnalytics />}
        {activeSection === 'cost' && <CostAnalytics />}
      </div>
    </div>
  );
}