'use client';

import React, { useEffect } from 'react';
import { useOperationsStore } from '@/stores/operationsStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useAuthStore } from '@/stores/authStore';
import { SecurityRiskWidget } from '@/features/enterprise-operations/SecurityRiskWidget';
import { ShieldAlert, Activity, BarChart3, Clock } from 'lucide-react';

export default function SecurityPage() {
  const {
    securityIntelligence,
    isLoading,
    error,
    fetchSecurityIntelligence,
    scanSecurityIntelligence,
  } = useOperationsStore();

  const { currentWorkspace } = useWorkspaceStore();
  const { user } = useAuthStore();
  const workspaceId = currentWorkspace?._id || currentWorkspace?.id || '';
  const userId = user?.id || 'system';

  useEffect(() => {
    if (!workspaceId) return;
    fetchSecurityIntelligence(workspaceId);
  }, [workspaceId, fetchSecurityIntelligence]);

  const handleScan = () => {
    if (!workspaceId) return;
    scanSecurityIntelligence(workspaceId, userId);
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-2xs">
        <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-700 pb-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <ShieldAlert className="w-6 h-6 text-indigo-600" />
              Enterprise Audit Intelligence & Threat Monitoring
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Real-time anomaly scoring, authentication monitoring, suspicious activity detection, and security insights.
            </p>
          </div>
          <button
            onClick={handleScan}
            disabled={isLoading || !workspaceId}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold shadow-xs transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Activity className="w-4 h-4" />
            Run Security Scan
          </button>
        </div>
      </div>

      {/* Security Intelligence Widget */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-2xs">
        {isLoading ? (
          <div className="text-center py-8">
            <div className="w-12 h-12 mx-auto animate-spin rounded-full border-4 border-indigo-600 border-t-transparent"></div>
            <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">Loading security intelligence...</p>
          </div>
        ) : error ? (
          <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-700 rounded-lg p-6">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <ShieldAlert className="w-5 h-5 text-rose-500" />
                <div>
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white">Error Loading Security Intelligence</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{error}</p>
                </div>
              </div>
              <button
                onClick={() => {
                  if (workspaceId) {
                    fetchSecurityIntelligence(workspaceId);
                  }
                }}
                className="text-xs text-indigo-600 hover:text-indigo-500"
              >
                Retry
              </button>
            </div>
          </div>
        ) : (
          <SecurityRiskWidget />
        )}
      </div>

      {/* Additional Security Metrics Section (placeholder for future expansion) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Authentication Trends */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-2xs">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <Activity className="w-5 h-5 text-indigo-600" />
              <div>
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">Authentication Trends</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Failed login attempts, brute force detection, and credential stuffing patterns.
                </p>
              </div>
            </div>
          </div>
          <div className="h-40 bg-gray-50 dark:bg-gray-900 rounded-lg">
            <div className="flex h-full items-center justify-center text-gray-400 dark:text-gray-500">
              Chart placeholder - Authentication attempts over time
            </div>
          </div>
        </div>

        {/* Workflow Security */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-2xs">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <ShieldAlert className="w-5 h-5 text-indigo-600" />
              <div>
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">Workflow Security</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Unusual execution patterns, permission escalation attempts, and anomalous workflow activities.
                </p>
              </div>
            </div>
          </div>
          <div className="h-40 bg-gray-50 dark:bg-gray-900 rounded-lg">
            <div className="flex h-full items-center justify-center text-gray-400 dark:text-gray-500">
              Chart placeholder - Workflow execution security events
            </div>
          </div>
        </div>
      </div>

      {/* System Security Metrics */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 dark:border-gray-700 pb-4">
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-indigo-600" />
              System Security Metrics
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              API security, queue security, and infrastructure threat monitoring.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Clock className="w-3.5 h-3.5 text-indigo-600" />
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Last scan: {securityIntelligence?.lastScannedAt ? new Date(securityIntelligence.lastScannedAt).toLocaleTimeString() : 'Never'}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
          <div className="p-4 bg-gray-50 dark:bg-gray-900/60 rounded-lg">
            <div className="text-xs text-gray-500 dark:text-gray-400">API Security Score</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
              {securityIntelligence?.apiSecurityScore ?? 0}/100
            </div>
            <p className="text-[11px] text-gray-500 mt-1">
              Based on rate limiting, injection attempts, and anomalous payloads.
            </p>
          </div>

          <div className="p-4 bg-gray-50 dark:bg-gray-900/60 rounded-lg">
            <div className="text-xs text-gray-500 dark:text-gray-400">Queue Threat Level</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
              {securityIntelligence?.queueThreatLevel ?? 'LOW'}
            </div>
            <p className="text-[11px] text-gray-500 mt-1">
              Suspicious job patterns and queue manipulation attempts.
            </p>
          </div>

          <div className="p-4 bg-gray-50 dark:bg-gray-900/60 rounded-lg">
            <div className="text-xs text-gray-500 dark:text-gray-400">Infrastructure Alerts</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
              {securityIntelligence?.infrastructureAlertsCount ?? 0}
            </div>
            <p className="text-[11px] text-gray-500 mt-1">
              Database, cache, and worker node security events.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}