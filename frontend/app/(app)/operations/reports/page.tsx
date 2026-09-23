'use client';

import React, { useState, useEffect } from 'react';
import { useOperationsStore } from '@/stores/operationsStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useAuthStore } from '@/stores/authStore';
import {
  FileText,
  Plus,
  Download,
  Trash2,
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  X,
} from 'lucide-react';
import type { CreateReportInput, ReportItem } from '@/types/operations.types';

export default function ReportsPage() {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [filterType, setFilterType] = useState<string>('all');
  const [reportName, setReportName] = useState('');
  const [reportType, setReportType] = useState('EXECUTION');
  const [reportFormat, setReportFormat] = useState('JSON');
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduleFreq, setScheduleFreq] = useState<'DAILY' | 'WEEKLY' | 'MONTHLY'>('WEEKLY');

  const {
    reports,
    getReports,
    createReport,
    deleteReport,
    exportReport,
    isLoading,
  } = useOperationsStore();

const { currentWorkspace } = useWorkspaceStore();
  const { user } = useAuthStore();
  const workspaceId = currentWorkspace?._id || currentWorkspace?.id || '';
  const userId = user?.id || '';

  useEffect(() => {
    if (!workspaceId) return;
    getReports(workspaceId, filterType !== 'all' ? { type: filterType } : {});
  }, [workspaceId, filterType, getReports]);

  const handleCreateReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportName.trim()) return;

    const input: CreateReportInput = {
      name: reportName,
      type: reportType,
      format: reportFormat,
      schedule: isScheduled
        ? {
            frequency: scheduleFreq,
            isActive: true,
          }
        : undefined,
    };

    try {
      await createReport(workspaceId, userId, input);
      setIsCreateModalOpen(false);
      setReportName('');
      setIsScheduled(false);
    } catch (err) {
      console.error('Failed to create report', err);
    }
  };

  const handleExport = async (reportId: string, formatOverride?: string) => {
    try {
      const { data, filename } = await exportReport(reportId, workspaceId, formatOverride);
      const url = window.URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error('Failed to export report', err);
    }
  };

  const handleDelete = async (reportId: string) => {
    if (confirm('Are you sure you want to delete this report?')) {
      try {
        await deleteReport(reportId, workspaceId, userId);
      } catch (err) {
        console.error('Failed to delete report', err);
      }
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return (
          <span className="flex items-center gap-1 text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-0.5 rounded-full text-xs font-medium">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Ready
          </span>
        );
      case 'GENERATING':
      case 'PENDING':
        return (
          <span className="flex items-center gap-1 text-amber-600 bg-amber-50 dark:bg-amber-950/40 px-2.5 py-0.5 rounded-full text-xs font-medium animate-pulse">
            <Clock className="w-3.5 h-3.5" />
            Generating
          </span>
        );
      case 'FAILED':
        return (
          <span className="flex items-center gap-1 text-rose-600 bg-rose-50 dark:bg-rose-950/40 px-2.5 py-0.5 rounded-full text-xs font-medium">
            <AlertCircle className="w-3.5 h-3.5" />
            Failed
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700 shadow-2xs">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <FileText className="w-6 h-6 text-indigo-600" />
            Executive & Operational Reports
          </h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Generate on-demand or automated compliance, execution health, security, and cost attribution reports.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-xs px-3 py-2 text-gray-800 dark:text-gray-200 font-medium"
          >
            <option value="all">All Report Types</option>
            <option value="EXECUTION">Execution History</option>
            <option value="WORKFLOW_HEALTH">Workflow Health</option>
            <option value="SECURITY">Security Posture</option>
            <option value="COMPLIANCE">Compliance Audit</option>
            <option value="USAGE">Workspace Usage</option>
            <option value="COST">Cost Attribution</option>
          </select>

          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition"
          >
            <Plus className="w-4 h-4" />
            Generate Report
          </button>
        </div>
      </div>

      {/* Reports Table / List */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-2xs overflow-hidden">
        {reports.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 dark:bg-gray-900/60 border-b border-gray-200 dark:border-gray-700 text-gray-500 font-medium">
                <tr>
                  <th className="py-3.5 px-4">Report Name</th>
                  <th className="py-3.5 px-4">Type</th>
                  <th className="py-3.5 px-4">Format</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4">Schedule</th>
                  <th className="py-3.5 px-4">Created</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
                {reports.map((report) => (
                  <tr key={report.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-750">
                    <td className="py-3.5 px-4 font-semibold text-gray-900 dark:text-white">
                      {report.name}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-[11px] font-medium text-gray-700 dark:text-gray-300">
                        {report.type}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-mono uppercase text-gray-600 dark:text-gray-400">
                      {report.format}
                    </td>
                    <td className="py-3.5 px-4">{getStatusBadge(report.status)}</td>
                    <td className="py-3.5 px-4">
                      {report.schedule?.isActive ? (
                        <span className="flex items-center gap-1 text-indigo-600 dark:text-indigo-400 text-[11px]">
                          <Calendar className="w-3.5 h-3.5" />
                          {report.schedule.frequency}
                        </span>
                      ) : (
                        <span className="text-gray-400 text-[11px]">One-time</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-gray-500">
                      {new Date(report.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-3.5 px-4 text-right space-x-2">
                      <button
                        onClick={() => handleExport(report.id)}
                        disabled={report.status !== 'COMPLETED'}
                        title="Download Report"
                        className="p-1.5 text-gray-600 hover:text-indigo-600 dark:text-gray-400 dark:hover:text-indigo-400 disabled:opacity-30"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(report.id)}
                        title="Delete Report"
                        className="p-1.5 text-gray-600 hover:text-rose-600 dark:text-gray-400 dark:hover:text-rose-400"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-16">
            <FileText className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">No reports found</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-sm mx-auto">
              Generate on-demand analytics summaries or schedule recurring weekly compliance audits.
            </p>
          </div>
        )}
      </div>

      {/* Create Report Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 max-w-md w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-700 pb-3">
              <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <FileText className="w-5 h-5 text-indigo-600" />
                Generate New Report
              </h3>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateReport} className="space-y-4 text-xs">
              <div>
                <label className="block font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Report Title
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Monthly Enterprise Execution Audit"
                  value={reportName}
                  onChange={(e) => setReportName(e.target.value)}
                  className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Report Domain / Type
                </label>
                <select
                  value={reportType}
                  onChange={(e) => setReportType(e.target.value)}
                  className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-gray-900 dark:text-white"
                >
                  <option value="EXECUTION">Execution History & Reliabilities</option>
                  <option value="WORKFLOW_HEALTH">Workflow Health & Failing Nodes</option>
                  <option value="SECURITY">Security Posture & Access Events</option>
                  <option value="COMPLIANCE">Compliance Audit Log Export</option>
                  <option value="USAGE">Workspace & User Utilization</option>
                  <option value="COST">Cost Attribution Breakdown</option>
                </select>
              </div>

              <div>
                <label className="block font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Output Format
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['JSON', 'CSV', 'PDF'] as const).map((fmt) => (
                    <button
                      type="button"
                      key={fmt}
                      onClick={() => setReportFormat(fmt)}
                      className={`py-2 text-center rounded-lg border font-semibold transition ${
                        reportFormat === fmt
                          ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400'
                          : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'
                      }`}
                    >
                      {fmt}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isScheduled}
                    onChange={(e) => setIsScheduled(e.target.checked)}
                    className="rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="font-medium text-gray-800 dark:text-gray-200">
                    Schedule Recurring Generation
                  </span>
                </label>

                {isScheduled && (
                  <div className="mt-2 pl-6">
                    <select
                      value={scheduleFreq}
                      onChange={(e) => setScheduleFreq(e.target.value as any)}
                      className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 text-gray-900 dark:text-white text-xs"
                    >
                      <option value="DAILY">Daily (Midnight UTC)</option>
                      <option value="WEEKLY">Weekly (Monday 00:00 UTC)</option>
                      <option value="MONTHLY">Monthly (1st of Month)</option>
                    </select>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-gray-100 dark:border-gray-700">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold shadow-xs transition"
                >
                  Generate
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}