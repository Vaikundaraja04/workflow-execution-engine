'use client';

import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  FileText,
  Trash2,
  Loader2,
  CheckCircle2,
  X,
  Settings,
  RefreshCw,
  Clock,
  ExternalLink,
} from 'lucide-react';
import { useSecurityStore } from '@/stores/securityStore';
import type { PrivacyRequest, PrivacyPreferences } from '@/types/security.types';

export const PrivacyCenter: React.FC = () => {
  const {
    privacyRequests,
    privacyPreferences,
    fetchPrivacyRequests,
    requestDataExport,
    requestUserDeletion,
    fetchPrivacyPreferences,
    updatePrivacyPreferences,
    isLoading,
    error,
  } = useSecurityStore();

  const [selectedRequest, setSelectedRequest] = useState<PrivacyRequest | null>(null);
  const [isRequestingExport, setIsRequestingExport] = useState(false);
  const [isRequestingDeletion, setIsRequestingDeletion] = useState(false);
  const [isSavingPreferences, setIsSavingPreferences] = useState(false);
  const [showDeletionConfirm, setShowDeletionConfirm] = useState(false);
  const [preferences, setPreferences] = useState<PrivacyPreferences | null>(null);

  useEffect(() => {
    setPreferences(privacyPreferences);
  }, [privacyPreferences]);

  useEffect(() => {
    fetchPrivacyRequests();
    fetchPrivacyPreferences();
  }, [fetchPrivacyRequests, fetchPrivacyPreferences]);

  const handleRequestExport = async () => {
    setIsRequestingExport(true);
    try {
      await requestDataExport();
      await fetchPrivacyRequests();
    } catch (err) {
      console.error('Failed to request data export:', err);
    } finally {
      setIsRequestingExport(false);
    }
  };

  const handleRequestDeletion = async () => {
    setShowDeletionConfirm(true);
  };

  const handleConfirmDeletion = async () => {
    setIsRequestingDeletion(true);
    try {
      await requestUserDeletion();
      await fetchPrivacyRequests();
      setShowDeletionConfirm(false);
    } catch (err) {
      console.error('Failed to request user deletion:', err);
    } finally {
      setIsRequestingDeletion(false);
    }
  };

  const handleCancelDeletion = () => {
    setShowDeletionConfirm(false);
  };

  const handleSavePreferences = async () => {
    if (!preferences) return;
    setIsSavingPreferences(true);
    try {
      await updatePrivacyPreferences(preferences);
    } catch (err) {
      console.error('Failed to save privacy preferences:', err);
    } finally {
      setIsSavingPreferences(false);
    }
  };

  const defaultPreferences: PrivacyPreferences = {
    analyticsConsent: false,
    marketingConsent: false,
    diagnosticsConsent: false,
    retentionPeriodMonths: 12,
    updatedAt: new Date().toISOString(),
  };

  const handlePreferenceChange = (field: 'analyticsConsent' | 'marketingConsent' | 'diagnosticsConsent', value: boolean) => {
    setPreferences(prev => {
      const prevPrefs = prev || defaultPreferences;
      return {
        ...prevPrefs,
        [field]: value,
        updatedAt: new Date().toISOString(),
      };
    });
  };

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <ShieldCheck className="w-7 h-7 text-indigo-600 dark:text-indigo-400" />
            GDPR Privacy & Data Rights Center
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Exercise your data protection rights under GDPR Article 20 (portability) and Article 17 (right to be forgotten).
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleRequestExport}
            disabled={isRequestingExport}
            className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-2xs transition"
          >
            {isRequestingExport ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Requesting...
              </>
            ) : (
              'Request Data Export'
            )}
          </button>
          <button
            onClick={handleRequestDeletion}
            disabled={isRequestingDeletion}
            className="px-3 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-2xs transition"
          >
            {isRequestingDeletion ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              'Request Account Deletion'
            )}
          </button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="p-4 rounded-xl border bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400" />
          <div>
            <p className="font-medium">{error}</p>
          </div>
        </div>
      )}

      {/* Privacy Preferences */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-2xs overflow-hidden">
        <div className="p-5 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Settings className="w-5 h-5 text-indigo-600" />
            Privacy Preferences & Consents
          </h2>
        </div>
        <div className="p-4">
          {!privacyPreferences && !preferences && !isLoading ? (
            <div className="text-center py-8">
              <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin" />
              <p className="text-sm text-gray-500 dark:text-gray-400">Loading privacy preferences...</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 mt-1">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-medium text-gray-900 dark:text-white">
                    Analytics & Performance Data
                  </h3>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    Allow collection of anonymized usage data to improve product performance and reliability.
                  </p>
                  <label className="flex items-center gap-2 text-xs font-medium text-gray-700 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={(preferences || privacyPreferences)?.analyticsConsent ?? false}
                      onChange={(e) => handlePreferenceChange('analyticsConsent', e.target.checked)}
                      className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                    />
                    Enable
                  </label>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 mt-1">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-medium text-gray-900 dark:text-white">
                    Marketing Communications
                  </h3>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    Receive updates about new features, product announcements, and promotional offers.
                  </p>
                  <label className="flex items-center gap-2 text-xs font-medium text-gray-700 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={(preferences || privacyPreferences)?.marketingConsent ?? false}
                      onChange={(e) => handlePreferenceChange('marketingConsent', e.target.checked)}
                      className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                    />
                    Enable
                  </label>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 mt-1">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-medium text-gray-900 dark:text-white">
                    Diagnostic & Crash Reports
                  </h3>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    Share crash diagnostics and error reports to help us identify and fix issues faster.
                  </p>
                  <label className="flex items-center gap-2 text-xs font-medium text-gray-700 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={(preferences || privacyPreferences)?.diagnosticsConsent ?? false}
                      onChange={(e) => handlePreferenceChange('diagnosticsConsent', e.target.checked)}
                      className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                    />
                    Enable
                  </label>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 mt-1">
                  <Clock className="w-4 h-4 text-blue-500" />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-medium text-gray-900 dark:text-white">
                    Data Retention Period
                  </h3>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    Choose how long we retain your inactive account data before automatic deletion.
                  </p>
                  <div className="mt-1">
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Retention Period (months)
                    </label>
                    <select
                      value={(preferences || privacyPreferences)?.retentionPeriodMonths?.toString() || '12'}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        setPreferences(prev => {
                          const prevPrefs = prev || defaultPreferences;
                          return {
                            ...prevPrefs,
                            retentionPeriodMonths: val === 0 ? undefined : val,
                            updatedAt: new Date().toISOString(),
                          };
                        });
                      }}
                      className="w-full text-xs p-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                    >
                      <option value="0">Indefinite (until account deletion)</option>
                      <option value="3">3 months</option>
                      <option value="6">6 months</option>
                      <option value="12">12 months (default)</option>
                      <option value="24">24 months</option>
                      <option value="36">36 months</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="p-4 pt-0">
          <button
            onClick={handleSavePreferences}
            disabled={isSavingPreferences}
            className="w-full text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-2xs transition"
          >
            {isSavingPreferences ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Privacy Preferences'
            )}
          </button>
        </div>
      </div>

      {/* Privacy Requests History */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-2xs overflow-hidden">
        <div className="p-5 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <FileText className="w-5 h-5 text-indigo-600" />
            Privacy Requests History
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Track your data export and deletion requests with status updates and audit trails.
          </p>
        </div>
        <div className="p-4">
          {privacyRequests.length === 0 && !isLoading ? (
            <div className="text-center py-8">
              <ShieldCheck className="w-8 h-8 text-emerald-500 mx-auto mb-3" />
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No privacy requests found. Use the buttons above to submit a data export or deletion request.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {privacyRequests.map((request) => (
                <div
                  key={request._id}
                  className="flex items-start gap-4 p-3 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                  onClick={() => setSelectedRequest(request)}
                >
                  <div className="flex-shrink-0 mt-1">
                    {request.requestType === 'EXPORT' ? (
                      <FileText className="w-4 h-4 text-indigo-500" />
                    ) : (
                      <Trash2 className="w-4 h-4 text-rose-500" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-start justify-between">
                      <h4 className="text-sm font-medium text-gray-900 dark:text-white">
                        {request.requestType === 'EXPORT' ? 'Data Export Request' : 'Account Deletion Request'}
                      </h4>
                      <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                        request.status === 'COMPLETED'
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-400'
                          : request.status === 'PENDING'
                            ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-400'
                            : request.status === 'PROCESSING'
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-400'
                              : request.status === 'REJECTED'
                                ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-400'
                                : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
                      }`}>
                        {request.status}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                      Requested: {new Date(request.requestedAt).toLocaleString()}
                      {request.processedAt && (
                        <>
                          <br />
                          Processed: {new Date(request.processedAt).toLocaleString()}
                        </>
                      )}
                      {request.completedAt && (
                        <>
                          <br />
                          Completed: {new Date(request.completedAt).toLocaleString()}
                        </>
                      )}
                    </p>
                    {request.errorMessage && (
                      <p className="text-xs text-rose-500 mt-1 font-mono">
                        Error: {request.errorMessage}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Privacy Request Detail Modal */}
      {selectedRequest && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl max-w-lg w-full p-6 shadow-xl border border-gray-200 dark:border-gray-700 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
              {selectedRequest.requestType === 'EXPORT' ? (
                <FileText className="w-5 h-5 text-indigo-600" />
              ) : (
                <Trash2 className="w-5 h-5 text-rose-600" />
              )}
              Privacy Request Details
            </h3>
            <p className="text-xs text-gray-500 font-mono mb-4">Request ID: {selectedRequest._id}</p>

            <div className="space-y-3 mb-4">
              <div className="p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
                <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  Request Information
                </div>
                <div className="text-xs font-mono text-gray-800 dark:text-gray-200 space-y-1">
                  <div>Type: {selectedRequest.requestType === 'EXPORT' ? 'Data Export (GDPR Article 20)' : 'Account Deletion (GDPR Article 17)'}</div>
                  <div>Status: {selectedRequest.status}</div>
                  <div>Requested: {new Date(selectedRequest.requestedAt).toLocaleString()}</div>
                  {selectedRequest.processedAt && (
                    <div>Processed: {new Date(selectedRequest.processedAt).toLocaleString()}</div>
                  )}
                  {selectedRequest.completedAt && (
                    <div>Completed: {new Date(selectedRequest.completedAt).toLocaleString()}</div>
                  )}
                  {selectedRequest.expiresAt && (
                    <div>Expires: {new Date(selectedRequest.expiresAt).toLocaleString()}</div>
                  )}
                </div>
              </div>

              {selectedRequest.metadata && Object.keys(selectedRequest.metadata).length > 0 && (
                <div className="p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
                  <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    Request Metadata
                  </div>
                  <pre className="text-xs font-mono text-gray-800 dark:text-gray-200 overflow-x-auto">
                    {JSON.stringify(selectedRequest.metadata, null, 2)}
                  </pre>
                </div>
              )}

              {selectedRequest.errorMessage && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/40 rounded-lg border border-rose-200 dark:border-rose-800">
                  <div className="text-[11px] font-semibold text-rose-500 uppercase tracking-wider mb-1">
                    Error Details
                  </div>
                  <p className="text-xs text-rose-700 dark:text-rose-300 break-all">
                    {selectedRequest.errorMessage}
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setSelectedRequest(null)}
                className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition"
              >
                Close Details
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Deletion Confirmation Modal */}
      {showDeletionConfirm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl max-w-lg w-full p-6 shadow-xl border border-gray-200 dark:border-gray-700">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
              Confirm Account Deletion
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
              This action will initiate the GDPR Right to be Forgotten (Article 17) process. Your account and associated data will be queued for deletion.
            </p>

            <div className="space-y-4">
              <div className="p-4 bg-rose-50 dark:bg-rose-950/40 rounded-lg border border-rose-200 dark:border-rose-800">
                <h4 className="text-sm font-medium text-rose-800 dark:text-rose-300 mb-2">
                  What happens next:
                </h4>
                <ol className="list-decimal list-inside text-xs text-gray-700 dark:text-gray-300 space-y-1">
                  <li>Your deletion request is recorded with audit trail</li>
                  <li>A grace period begins (configurable in settings)</li>
                  <li>During grace period, you can cancel the deletion request</li>
                  <li>After grace period, data deletion begins:</li>
                  <ol className="list-lower-alpha list-inside pl-4 text-xs text-gray-600 dark:text-gray-400 space-y-1">
                    <li>Personal identifiers are anonymized in audit logs</li>
                    <li>Account data is marked for deletion</li>
                    <li>Shared workspace assets are reviewed for transfer</li>
                    <li>Secrets and API keys are rotated/revoked</li>
                    <li>Final deletion confirmation is recorded</li>
                  </ol>
                </ol>
              </div>

              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-1">
                  <AlertTriangle className="w-4 h-4 text-rose-600" />
                </div>
                <div className="flex-1">
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    <strong>This action cannot be undone</strong> after the grace period completes. All your data will be permanently deleted according to our data retention policy.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6">
              <button
                onClick={handleCancelDeletion}
                className="px-4 py-2 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDeletion}
                disabled={isRequestingDeletion}
                className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-xs transition"
              >
                {isRequestingDeletion ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  'Confirm Deletion Request'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default PrivacyCenter;