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

  const failedTrend = securityIntelligence?.failedAuthTrends?.trend ?? [];
  const maxFailedCount = Math.max(1, ...failedTrend.map((bucket) => bucket.count));
  const suspiciousActivities = securityIntelligence?.suspiciousActivities ?? [];
  const activityDays = Array.from({ length: 7 }, (_, index) => {
    const day = new Date();
    day.setDate(day.getDate() - (6 - index));
    const key = day.toISOString().slice(0, 10);
    return { key, count: suspiciousActivities.filter((activity) => activity.timestamp.slice(0, 10) === key).length };
  });
  const maxActivityCount = Math.max(1, ...activityDays.map((day) => day.count));

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-2xs">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <ShieldAlert className="w-6 h-6 text-indigo-600" />
              Enterprise Audit Intelligence & Threat Monitoring
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Real-time anomaly scoring, authentication monitoring, suspicious activity detection, and security insights.
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-3">
            {securityIntelligence?.lastScannedAt ? (
              <span className="text-xs text-gray-500 dark:text-gray-400 text-right">
                Last scan: {new Date(securityIntelligence.lastScannedAt).toLocaleTimeString()}
              </span>
            ) : null}
            <button
              onClick={handleScan}
              disabled={isLoading || !workspaceId}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold shadow-xs transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Activity className={`w-4 h-4${isLoading ? ' animate-pulse' : ''}`} />
              {isLoading ? 'Scanning…' : 'Run Security Scan'}
            </button>
          </div>
        </div>
      </div>

      {/* Security Intelligence Widget (loading/error get their own card; the widget renders its own cards) */}
      {isLoading || error ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-2xs">
          {isLoading ? (
            <div className="text-center py-8">
              <div className="w-12 h-12 mx-auto animate-spin rounded-full border-4 border-indigo-600 border-t-transparent"></div>
              <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">Loading security intelligence...</p>
            </div>
          ) : (
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
          )}
        </div>
      ) : (
        <SecurityRiskWidget />
      )}

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
            {failedTrend.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-gray-400 dark:text-gray-500">
                No failed authentication attempts in the last 30 days
              </div>
            ) : (
              <div className="flex h-full items-end gap-1 px-3 pb-3">
                {failedTrend.slice(-40).map((bucket) => (
                  <div
                    key={bucket.timestamp}
                    title={`${bucket.timestamp}: ${bucket.count} failed attempt(s)`}
                    className="flex-1 max-w-[28px] rounded-t bg-indigo-500/80"
                    style={{ height: `${Math.max(4, Math.round((bucket.count / maxFailedCount) * 92))}%` }}
                  />
                ))}
              </div>
            )}
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
            {suspiciousActivities.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-gray-400 dark:text-gray-500">
                No sensitive workflow actions in the last 7 days
              </div>
            ) : (
              <div className="flex h-full flex-col px-3 pb-2 pt-3">
                <div className="flex flex-1 items-end gap-2">
                  {activityDays.map((day) => (
                    <div key={day.key} className="flex h-full flex-1 flex-col justify-end">
                      <div
                        title={`${day.key}: ${day.count} action(s)`}
                        className="mx-auto w-full max-w-[28px] rounded-t bg-amber-500/80"
                        style={{ height: `${Math.max(4, Math.round((day.count / maxActivityCount) * 92))}%` }}
                      />
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 pt-1">
                  {activityDays.map((day) => (
                    <span key={day.key} className="flex-1 text-center text-[10px] text-gray-400 dark:text-gray-500">
                      {day.key.slice(5)}
                    </span>
                  ))}
                </div>
              </div>
            )}
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
              Live counts from the latest audit intelligence scan, refreshed on demand.
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
            <div className="text-xs text-gray-500 dark:text-gray-400">Delivered Insights (30d)</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
              {securityIntelligence?.insights?.length ?? 0}
            </div>
            <p className="text-[11px] text-gray-500 mt-1">
              Anomalies and attack patterns detected from workspace audit data.
            </p>
          </div>

          <div className="p-4 bg-gray-50 dark:bg-gray-900/60 rounded-lg">
            <div className="text-xs text-gray-500 dark:text-gray-400">Sensitive Actions (7d)</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
              {suspiciousActivities.length}
            </div>
            <p className="text-[11px] text-gray-500 mt-1">
              Role changes, secret removals, and policy updates.
            </p>
          </div>

          <div className="p-4 bg-gray-50 dark:bg-gray-900/60 rounded-lg">
            <div className="text-xs text-gray-500 dark:text-gray-400">Failed Auth Attempts (30d)</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
              {securityIntelligence?.failedAuthTrends?.totalFailedAttempts ?? 0}
            </div>
            <p className="text-[11px] text-gray-500 mt-1">
              From {securityIntelligence?.failedAuthTrends?.uniqueIpCount ?? 0} unique IP sources.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}