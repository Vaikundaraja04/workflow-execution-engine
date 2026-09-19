'use client';

import React, { useState, useEffect } from 'react';
import {
  Users,
  RefreshCw,
  X,
  LogOut,
  Search,
  Calendar,
  ShieldAlert,
  ShieldCheck,
  Key,
  Globe,
  Settings,
  Lock,
} from 'lucide-react';
import { useSecurityStore } from '@/stores/securityStore';
import type { SessionData } from '@/types/security.types';

export const SessionManager: React.FC = () => {
  const {
    sessions,
    fetchSessions,
    revokeSession,
    revokeOtherSessions,
    isLoading,
    error,
  } = useSecurityStore();

  const [selectedSession, setSelectedSession] = useState<SessionData | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [isRevoking, setIsRevoking] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const handleRevokeSession = async () => {
    if (!selectedSession) return;
    setIsRevoking(true);
    try {
      await revokeSession(selectedSession._id, revokeReason || 'Revoked via Session Manager');
      setSelectedSession(null);
      setRevokeReason('');
      await fetchSessions();
    } catch (err) {
      console.error('Failed to revoke session:', err);
    } finally {
      setIsRevoking(false);
    }
  };

  const handleRevokeOthers = async () => {
    setIsRevoking(true);
    try {
      await revokeOtherSessions();
      await fetchSessions();
    } catch (err) {
      console.error('Failed to revoke other sessions:', err);
    } finally {
      setIsRevoking(false);
    }
  };

  const filteredSessions = sessions.filter(session => {
    if (!searchTerm) return true;
    const searchableFields = [
      session.ipAddress || '',
      session.userAgent || '',
      session.browser || '',
      session.os || '',
    ];
    return searchableFields.some(field =>
      field.toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Users className="w-7 h-7 text-indigo-600 dark:text-indigo-400" />
            Active Session Manager
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Monitor and manage active user sessions with device tracking and remote revocation.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by IP, browser, OS..."
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <button
            onClick={handleRevokeOthers}
            disabled={isRevoking}
            className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-2xs transition"
          >
            {isRevoking ? (
              <>
                <X className="w-4 h-4 mr-2 animate-spin" />
                Revoking...
              </>
            ) : (
              'Revoke All Others'
            )}
          </button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="p-4 rounded-xl border bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300 flex items-center gap-3">
          <ShieldAlert className="w-5 h-5 text-rose-600 dark:text-rose-400" />
          <div>
            <p className="font-medium">{error}</p>
          </div>
        </div>
      )}

      {/* Sessions Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-gray-500 dark:text-gray-400">
            <thead className="text-xs uppercase bg-gray-50 dark:bg-gray-900/50 text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="px-5 py-3.5 font-medium">Device</th>
                <th className="px-5 py-3.5 font-medium">Browser / OS</th>
                <th className="px-5 py-3.5 font-medium">IP Address</th>
                <th className="px-5 py-3.5 font-medium">Last Active</th>
                <th className="px-5 py-3.5 font-medium">Status</th>
                <th className="px-5 py-3.5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {filteredSessions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-gray-400">
                    No active sessions found
                  </td>
                </tr>
              ) : (
                filteredSessions.map((session) => (
                  <tr key={session._id} className="hover:bg-gray-50/50 dark:hover:bg-gray-700/50">
                    <td className="px-5 py-3.5 flex items-center gap-3">
                      <div className="flex items-center gap-2">
                        {session.isCurrent ? (
                          <div className="w-3 h-3 bg-indigo-600 dark:bg-indigo-400 rounded-full" />
                        ) : (
                          <div className="w-3 h-3 bg-gray-300 dark:bg-gray-600 rounded-full" />
                        )}
                        <div>
                          <div className="text-xs font-medium text-gray-900 dark:text-white">
                            {session.deviceType || 'Unknown Device'}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {session.isCurrent ? '(Current)' : ''}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-xs">
                      <div className="flex items-center gap-2">
                        <div className="text-[11px] font-medium text-gray-600 dark:text-gray-400">
                          {session.browser || 'Unknown'}
                        </div>
                        <div className="w-0.5 h-4 bg-gray-200 dark:bg-gray-600" />
                        <div className="text-[11px] font-medium text-gray-600 dark:text-gray-400">
                          {session.os || 'Unknown'}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 font-mono text-xs">
                      {session.ipAddress || 'Internal'}
                    </td>
                    <td className="px-5 py-3.5 text-xs whitespace-nowrap">
                      {new Date(session.lastActiveAt).toLocaleString()}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`px-2.5 py-0.5 text-xs font-semibold rounded-full ${
                        session.isActive
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-400'
                          : 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-400'
                      }`}>
                        {session.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      {!session.isCurrent && (
                        <button
                          onClick={() => {
                            setSelectedSession(session);
                            setRevokeReason('');
                          }}
                          className="px-2.5 py-1 text-xs font-medium text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 rounded hover:bg-indigo-50 dark:hover:bg-indigo-950/30 transition"
                        >
                          Revoke
                        </button>
                      )}
                      {session.isCurrent && (
                        <span className="text-xs text-gray-400">Current Session</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Session Detail & Revoke Modal */}
      {selectedSession && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl max-w-lg w-full p-6 shadow-xl border border-gray-200 dark:border-gray-700 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
              <LogOut className="w-5 h-5 text-indigo-600" />
              Revoke Session
            </h3>
            <p className="text-xs text-gray-500 font-mono mb-4">Session ID: {selectedSession._id}</p>

            <div className="space-y-3 mb-4">
              <div className="p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
                <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  Session Information
                </div>
                <div className="text-xs font-mono text-gray-800 dark:text-gray-200 space-y-1">
                  <div>Device: {selectedSession.deviceType || 'Unknown'}</div>
                  <div>Browser: {selectedSession.browser || 'Unknown'}</div>
                  <div>OS: {selectedSession.os || 'Unknown'}</div>
                  <div>IP Address: {selectedSession.ipAddress || 'Internal'}</div>
                  <div>Last Active: {new Date(selectedSession.lastActiveAt).toLocaleString()}</div>
                  <div>Expires At: {new Date(selectedSession.expiresAt).toLocaleString()}</div>
                </div>
              </div>

              <div className="p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
                <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  Revoke Reason
                </div>
                <textarea
                  value={revokeReason}
                  onChange={(e) => setRevokeReason(e.target.value)}
                  placeholder="Optional reason for revoking this session..."
                  className="w-full text-xs p-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                  rows={3}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => {
                  setSelectedSession(null);
                  setRevokeReason('');
                }}
                className="px-4 py-2 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                onClick={handleRevokeSession}
                disabled={isRevoking}
                className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs transition"
              >
                {isRevoking ? (
                  <>
                    <X className="w-4 h-4 mr-2 animate-spin" />
                    Revoking...
                  </>
                ) : (
                  'Confirm Revoke'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default SessionManager;