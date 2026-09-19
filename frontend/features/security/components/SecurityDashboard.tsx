'use client';

import React, { useState, useEffect } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart2,
  Clock,
  Globe,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react';
import { useSecurityStore } from '@/stores/securityStore';
import type { SecurityDashboardData, SecurityEvent, RiskScoreData } from '@/types/security.types';

export const SecurityDashboard: React.FC = () => {
  const {
    dashboard,
    riskScore,
    events,
    fetchDashboard,
    fetchRiskScore,
    fetchEvents,
    isLoading,
    error,
  } = useSecurityStore();

  useEffect(() => {
    fetchDashboard();
    fetchRiskScore();
    fetchEvents({ limit: 10 });
  }, [fetchDashboard, fetchRiskScore, fetchEvents]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getSeverityClass = (severity: string) => {
    switch (severity) {
      case 'CRITICAL':
        return 'text-rose-600 bg-rose-50 dark:bg-rose-950/40';
      case 'HIGH':
        return 'text-amber-600 bg-amber-50 dark:bg-amber-950/40';
      case 'MEDIUM':
        return 'text-yellow-600 bg-yellow-50 dark:bg-yellow-950/40';
      case 'LOW':
        return 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40';
      case 'INFO':
        return 'text-blue-600 bg-blue-50 dark:bg-blue-950/40';
      default:
        return 'text-gray-600 bg-gray-50 dark:bg-gray-950/40';
    }
  };

  if (isLoading) {
    return (
      <div className="text-center py-12">
        <div className="w-12 h-12 mx-auto animate-spin rounded-full border-4 border-indigo-600 border-t-transparent"></div>
        <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">Loading security dashboard...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 rounded-xl border bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300">
        <AlertTriangle className="w-5 h-5 mr-3" />
        <div>
          <p className="font-medium">Failed to load security data</p>
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <ShieldCheck className="w-7 h-7 text-indigo-600 dark:text-indigo-400" />
            Security Center Dashboard
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Real-time threat monitoring, risk scoring, and security event visibility.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              fetchDashboard();
              fetchRiskScore();
              fetchEvents({ limit: 10 });
            }}
            className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-2xs transition flex items-center gap-1.5"
          >
            <Activity className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* Risk Score Card */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-2xs">
        <div className="flex items-start justify-between border-b border-gray-100 dark:border-gray-700 pb-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-indigo-600" />
              Security Risk Score
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Composite risk score (0-100) across authentication, access control, data protection, and network security.
            </p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold">
              {riskScore?.overallScore ?? '--'}
            </div>
            <div className="text-xs font-medium text-gray-500 dark:text-gray-400 capitalize">
              {riskScore?.riskCategory ?? 'unknown'}
            </div>
          </div>
        </div>

        {riskScore?.breakdown && (
          <div className="mt-4 space-y-3">
            {Object.entries(riskScore.breakdown).map(([domain, data]) => (
              <div key={domain} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-indigo-500" />
                  <span className="font-medium capitalize">{domain.replace(/([A-Z])/g, ' $1')}</span>
                </div>
                <div className="text-right">
                  <span className="font-semibold">{data.score}/100</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {riskScore?.recommendations?.length ? (
          <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
            <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
              Actionable Recommendations
            </div>
            <ul className="text-xs space-y-1 text-gray-600 dark:text-gray-300 list-disc list-inside">
              {riskScore.recommendations.map((rec, idx) => (
                <li key={idx}>
                  <span className="font-medium">{typeof rec === 'string' ? rec : rec.title}:</span>{' '}
                  {typeof rec === 'string' ? '' : rec.description || rec.remediationAction}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {/* Key Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 shadow-2xs">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <ShieldAlert className="w-5 h-5 text-indigo-600" />
              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Open Threats</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {dashboard?.openThreatsCount ?? 0}
                </p>
              </div>
            </div>
            <div className="text-xs text-indigo-400 dark:text-indigo-300">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            Unresolved security threats
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 shadow-2xs">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <Activity className="w-5 h-5 text-indigo-600" />
              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Events (24h)</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {dashboard?.totalEvents24h ?? 0}
                </p>
              </div>
            </div>
            <div className="text-xs text-indigo-400 dark:text-indigo-300">
              <Zap className="w-4 h-4" />
            </div>
          </div>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            Security events logged in last 24h
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 shadow-2xs">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-600" />
              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Failed Logins (24h)</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {dashboard?.failedLogins24h ?? 0}
                </p>
              </div>
            </div>
            <div className="text-xs text-rose-400 dark:text-rose-300">
              <ShieldAlert className="w-4 h-4" />
            </div>
          </div>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            Failed authentication attempts
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 shadow-2xs">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <Users className="w-5 h-5 text-indigo-600" />
              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Active Sessions</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {dashboard?.activeSessionsCount ?? 0}
                </p>
              </div>
            </div>
            <div className="text-xs text-indigo-400 dark:text-indigo-300">
              <Globe className="w-4 h-4" />
            </div>
          </div>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            Currently active user sessions
          </p>
        </div>
      </div>

      {/* Recent Security Events */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-2xs">
        <div className="flex items-start justify-between border-b border-gray-100 dark:border-gray-700 pb-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Zap className="w-5 h-5 text-indigo-600" />
              Recent Security Events
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Latest detected threats and security anomalies requiring attention.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchEvents({ limit: 20 })}
              className="text-xs font-medium text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 hover:underline"
            >
              View All Events
            </button>
          </div>
        </div>

        <div className="space-y-3 mt-3">
          {events.length === 0 ? (
            <p className="text-center py-6 text-gray-500 dark:text-gray-400">
              No security events detected in the selected time range.
            </p>
          ) : (
            events.map((event) => (
              <div
                key={event._id}
                className="flex items-start gap-4 p-3 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition"
              >
                <div className="flex-shrink-0 mt-1 flex items-center">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${getSeverityClass(
                    event.severity
                  )}`}>
                    {event.severity === 'CRITICAL' && <AlertTriangle className="w-4 h-4" />}
                    {event.severity === 'HIGH' && <AlertTriangle className="w-4 h-4" />}
                    {event.severity === 'MEDIUM' && <AlertTriangle className="w-4 h-4" />}
                    {event.severity === 'LOW' && <AlertTriangle className="w-4 h-4" />}
                    {event.severity === 'INFO' && <AlertTriangle className="w-4 h-4" />}
                  </div>
                </div>
                <div className="flex-1">
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white truncate">
                    {event.eventType}
                  </h4>
                  <p className="text-xs text-gray-600 dark:text-gray-300 mt-1 line-clamp-2">
                    {event.description}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-300">
                      {event.eventType}
                    </span>
                    <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full ${getSeverityClass(
                      event.severity
                    )}`}>
                      {event.severity}
                    </span>
                    <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-300">
                      {event.status}
                    </span>
                  </div>
                </div>
                <div className="flex-shrink-0 text-right mt-1">
                  <p className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {formatDate(event.createdAt)}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default SecurityDashboard;