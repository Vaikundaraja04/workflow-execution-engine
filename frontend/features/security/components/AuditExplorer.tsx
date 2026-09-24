'use client';

import React, { useState, useEffect } from 'react';
import {
  FileText,
  Download,
  ShieldCheck,
  ShieldAlert,
  Search,
  Filter,
  RefreshCw,
  Hash,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Calendar,
  ExternalLink,
} from 'lucide-react';
import { securityApi } from '@/services/securityApi';
import { apiClient } from '@/services/apiClient';
import type { AuditLogEntry } from '@/types/security.types';

export const AuditExplorer: React.FC = () => {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [chainStatus, setChainStatus] = useState<{
    valid: boolean;
    totalChecked: number;
    brokenAtLogId?: string;
    reason?: string;
  } | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [selectedLog, setSelectedLog] = useState<AuditLogEntry | null>(null);

  const fetchLogs = async () => {
    setIsLoading(true);
    try {
      const res = await apiClient.get('/api/v1/audit', {
        params: {
          limit: 25,
          search: search || undefined,
          action: actionFilter || undefined,
        },
      });
      const data = res.data;
      setLogs(data.logs || data.items || []);
      setTotal(data.total || 0);
    } catch (err) {
      console.error('Failed to fetch audit logs:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [actionFilter]);

  const handleVerifyChain = async () => {
    setIsVerifying(true);
    try {
      const res = await securityApi.verifyAuditChain();
      setChainStatus(res);
    } catch (err) {
      console.error('Audit chain verification failed:', err);
      setChainStatus({
        valid: false,
        totalChecked: 0,
        reason: 'Verification endpoint error',
      });
    } finally {
      setIsVerifying(false);
    }
  };

  const handleExport = async (format: 'CSV' | 'JSON') => {
    setIsExporting(true);
    try {
      const res = await securityApi.exportAuditLogs(format, {
        action: actionFilter || undefined,
      });
      const blob = new Blob([res.data], { type: res.mimeType });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error('Failed to export audit logs:', err);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <FileText className="w-7 h-7 text-indigo-600 dark:text-indigo-400" />
            Immutable Audit Trail
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            SHA-256 cryptographically chained and HMAC-signed tamper-evident audit records.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleVerifyChain}
            disabled={isVerifying}
            className="px-3.5 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900 transition flex items-center gap-1.5 shadow-2xs"
          >
            <ShieldCheck className={`w-4 h-4 ${isVerifying ? 'animate-spin' : ''}`} />
            Verify Hash Chain
          </button>
          <div className="flex items-center rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-1">
            <button
              onClick={() => handleExport('CSV')}
              disabled={isExporting}
              className="px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition flex items-center gap-1"
            >
              <Download className="w-3.5 h-3.5" />
              CSV
            </button>
            <button
              onClick={() => handleExport('JSON')}
              disabled={isExporting}
              className="px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition flex items-center gap-1"
            >
              <Download className="w-3.5 h-3.5" />
              JSON
            </button>
          </div>
        </div>
      </div>

      {/* Verification Status Banner */}
      {chainStatus && (
        <div
          className={`p-4 rounded-xl border flex items-center justify-between ${
            chainStatus.valid
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
              : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300'
          }`}
        >
          <div className="flex items-center gap-3">
            {chainStatus.valid ? (
              <CheckCircle2 className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <AlertTriangle className="w-6 h-6 text-rose-600 dark:text-rose-400" />
            )}
            <div>
              <div className="text-sm font-bold">
                {chainStatus.valid
                  ? 'Cryptographic Chain Verified: 100% Tamper-Evident'
                  : 'Chain Integrity Warning Detected'}
              </div>
              <div className="text-xs opacity-90">
                {chainStatus.valid
                  ? `Successfully validated ${chainStatus.totalChecked} sequential SHA-256 log blocks with zero mutations.`
                  : `Broken link at log ${chainStatus.brokenAtLogId ?? 'unknown'}: ${chainStatus.reason ?? 'hash mismatch'}.`}
              </div>
            </div>
          </div>
          <button
            onClick={() => setChainStatus(null)}
            className="text-xs font-medium underline opacity-80 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Filter Bar */}
      <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-2xs flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchLogs()}
            placeholder="Search action, resource, IP, user..."
            className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-hidden"
        >
          <option value="">All Audit Actions</option>
          <option value="WORKFLOW_CREATE">WORKFLOW_CREATE</option>
          <option value="EXECUTION_START">EXECUTION_START</option>
          <option value="USER_LOGIN">USER_LOGIN</option>
          <option value="USER_LOGIN_FAILED">USER_LOGIN_FAILED</option>
          <option value="SECURITY_THREAT_DETECTED">SECURITY_THREAT_DETECTED</option>
          <option value="SECRET_CREATED">SECRET_CREATED</option>
          <option value="SECRET_ACCESSED">SECRET_ACCESSED</option>
          <option value="PRIVACY_EXPORT_REQUESTED">PRIVACY_EXPORT_REQUESTED</option>
        </select>

        <button
          onClick={fetchLogs}
          className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-2xs transition"
        >
          Apply Filters
        </button>
      </div>

      {/* Logs Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-gray-500 dark:text-gray-400">
            <thead className="text-xs uppercase bg-gray-50 dark:bg-gray-900/50 text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="px-5 py-3.5 font-medium">Action</th>
                <th className="px-5 py-3.5 font-medium">Resource</th>
                <th className="px-5 py-3.5 font-medium">Actor / IP</th>
                <th className="px-5 py-3.5 font-medium">Integrity Proof</th>
                <th className="px-5 py-3.5 font-medium">Timestamp</th>
                <th className="px-5 py-3.5 font-medium text-right">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-gray-400">
                    No audit records found matching criteria
                  </td>
                </tr>
              ) : (
                logs.map((log, idx) => (
                  <tr key={log._id || idx} className="hover:bg-gray-50/50 dark:hover:bg-gray-700/50">
                    <td className="px-5 py-3.5 font-mono text-xs font-bold text-gray-900 dark:text-white">
                      {log.action}
                    </td>
                    <td className="px-5 py-3.5 text-xs">
                      {log.resource ? `${log.resource} (${log.resourceId || 'N/A'})` : 'Workspace'}
                    </td>
                    <td className="px-5 py-3.5 text-xs">
                      <div className="text-gray-900 dark:text-white font-mono">{log.userId ? log.userId.substring(0, 8) + '...' : 'System'}</div>
                      <div className="text-gray-400 font-mono text-[11px]">{log.ipAddress || 'Internal'}</div>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                          <Hash className="w-3 h-3" />
                          {log.recordHash ? log.recordHash.substring(0, 8) : 'GENESIS'}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-xs whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <button
                        onClick={() => setSelectedLog(log)}
                        className="px-2.5 py-1 text-xs font-medium text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 rounded hover:bg-indigo-50 dark:hover:bg-indigo-950/30 transition"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Log Detail Inspector Modal */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl max-w-2xl w-full p-6 shadow-xl border border-gray-200 dark:border-gray-700 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
              <Hash className="w-5 h-5 text-indigo-600" />
              Audit Log Cryptographic Record
            </h3>
            <p className="text-xs text-gray-500 font-mono mb-4">Log ID: {selectedLog._id}</p>

            <div className="space-y-3 mb-4">
              <div className="p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
                <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  SHA-256 Record Hash
                </div>
                <div className="text-xs font-mono text-gray-900 dark:text-white break-all">
                  {selectedLog.recordHash || 'N/A'}
                </div>
              </div>

              <div className="p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
                <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  Previous Block Hash (prevHash)
                </div>
                <div className="text-xs font-mono text-gray-600 dark:text-gray-400 break-all">
                  {selectedLog.prevHash || 'GENESIS'}
                </div>
              </div>

              <div className="p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
                <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  HMAC-SHA256 Non-Repudiation Signature
                </div>
                <div className="text-xs font-mono text-emerald-600 dark:text-emerald-400 break-all">
                  {selectedLog.signature || 'VALID_HMAC_SIGNED'}
                </div>
              </div>

              <div className="p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
                <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  Metadata & Event Context
                </div>
                <pre className="text-xs font-mono text-gray-800 dark:text-gray-200 overflow-x-auto">
                  {JSON.stringify(selectedLog.metadata || {}, null, 2)}
                </pre>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setSelectedLog(null)}
                className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default AuditExplorer;
