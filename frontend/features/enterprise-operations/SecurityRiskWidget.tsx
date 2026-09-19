import React from 'react';
import { useOperationsStore } from '@/stores/operationsStore';
import {
  ShieldAlert,
  AlertTriangle,
  Lock,
  UserX,
  Scan,
  CheckCircle2,
} from 'lucide-react';

export const SecurityRiskWidget: React.FC = () => {
  const {
    securityIntelligence,
    isLoading,
    error,
    scanSecurityIntelligence,
  } = useOperationsStore();

  const getThreatColor = (level?: string) => {
    switch (level) {
      case 'CRITICAL':
        return 'bg-rose-500 text-white';
      case 'HIGH':
        return 'bg-amber-500 text-white';
      case 'MEDIUM':
        return 'bg-yellow-500 text-black';
      case 'LOW':
        return 'bg-emerald-500 text-white';
      default:
        return 'bg-gray-500 text-white';
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Security Overview Card */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 dark:border-gray-700 pb-4">
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-indigo-600" />
              Enterprise Audit & Threat Intelligence
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Real-time anomaly scoring, authentication monitoring, and suspicious activity detection.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`px-3 py-1 rounded-full text-xs font-semibold ${getThreatColor(
                securityIntelligence?.threatLevel
              )}`}
            >
              Threat Level: {securityIntelligence?.threatLevel ?? 'LOW'}
            </span>
            <button
              onClick={() => {
                if (securityIntelligence?.workspaceId) {
                  scanSecurityIntelligence(securityIntelligence.workspaceId, 'system');
                }
              }}
              disabled={isLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700 transition disabled:opacity-50"
            >
              <Scan className="w-3.5 h-3.5" />
              Scan Now
            </button>
          </div>
        </div>

        {/* Metric tiles */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
          <div className="p-4 bg-gray-50 dark:bg-gray-900/60 rounded-lg">
            <div className="text-xs text-gray-500 dark:text-gray-400">Calculated Risk Score</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
              {securityIntelligence?.riskScore ?? 0}
              <span className="text-xs font-normal text-gray-400 ml-1">/ 100</span>
            </div>
            <p className="text-[11px] text-gray-500 mt-1">
              Higher score denotes hardened security posture.
            </p>
          </div>

          <div className="p-4 bg-gray-50 dark:bg-gray-900/60 rounded-lg">
            <div className="text-xs text-gray-500 dark:text-gray-400">Failed Auth Attempts</div>
            <div className="text-2xl font-bold text-rose-600 dark:text-rose-400 mt-1">
              {securityIntelligence?.failedAuthTrends?.totalFailedAttempts ?? 0}
            </div>
            <p className="text-[11px] text-gray-500 mt-1">
              From {securityIntelligence?.failedAuthTrends?.uniqueIpCount ?? 0} unique IP sources.
            </p>
          </div>

          <div className="p-4 bg-gray-50 dark:bg-gray-900/60 rounded-lg">
            <div className="text-xs text-gray-500 dark:text-gray-400">Anomaly Index</div>
            <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400 mt-1">
              {securityIntelligence?.anomalyScore ?? 0}%
            </div>
            <p className="text-[11px] text-gray-500 mt-1">
              Variance against 30-day behavioral baseline.
            </p>
          </div>
        </div>
      </div>

      {/* Security Insights & Anomalies List */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-2xs">
          <h4 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            Detected Intelligence Insights ({securityIntelligence?.insights?.length ?? 0})
          </h4>
          {securityIntelligence?.insights && securityIntelligence.insights.length > 0 ? (
            <div className="space-y-3">
              {securityIntelligence.insights.map((insight) => (
                <div
                  key={insight.id}
                  className="p-3 bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700 rounded-lg"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-xs text-gray-900 dark:text-white">
                      {insight.title}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${getThreatColor(
                        insight.severity
                      )}`}
                    >
                      {insight.severity}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                    {insight.description}
                  </p>
                  <p className="text-[11px] text-indigo-600 dark:text-indigo-400 mt-2 font-medium">
                    Recommendation: {insight.recommendation}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500 text-xs">
              <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
              No immediate security threats or anomalies detected.
            </div>
          )}
        </div>

        {/* Suspicious Activities Feed */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-2xs">
          <h4 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-3">
            <Lock className="w-4 h-4 text-rose-500" />
            Suspicious Activity Log ({securityIntelligence?.suspiciousActivities?.length ?? 0})
          </h4>
          {securityIntelligence?.suspiciousActivities &&
          securityIntelligence.suspiciousActivities.length > 0 ? (
            <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
              {securityIntelligence.suspiciousActivities.map((act) => (
                <div
                  key={act.id}
                  className="p-3 bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700 rounded-lg text-xs"
                >
                  <div className="flex items-center justify-between text-gray-900 dark:text-white font-medium">
                    <span>{act.action}</span>
                    <span className="text-[10px] text-gray-400">
                      {new Date(act.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-gray-600 dark:text-gray-300 mt-1">
                    <span className="text-gray-400">Reason:</span> {act.reason}
                  </p>
                  <div className="flex gap-3 text-[11px] text-gray-400 mt-1">
                    <span>Actor: {act.actor}</span>
                    {act.ipAddress && <span>IP: {act.ipAddress}</span>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500 text-xs">
              <UserX className="w-8 h-8 text-gray-400 mx-auto mb-2" />
              No suspicious actor activities recorded recently.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};