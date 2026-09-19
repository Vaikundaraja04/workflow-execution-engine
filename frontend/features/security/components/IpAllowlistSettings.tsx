import React, { useState, useEffect } from 'react';
import {
  Globe,
  Lock,
  Shield,
  Plus,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Key,
  Clock,
  Users,
} from 'lucide-react';
import { useSecurityStore } from '@/stores/securityStore';
import type { WorkspaceSecurityPolicy } from '@/types/security.types';

export const IpAllowlistSettings: React.FC = () => {
  const { policy, fetchPolicy, updatePolicy, isLoading } = useSecurityStore();

  const [formData, setFormData] = useState<Partial<WorkspaceSecurityPolicy>>({
    ipAllowlistEnabled: false,
    ipAllowlist: [],
    enforceMfa: false,
    sessionTimeoutMinutes: 60,
    maxConcurrentSessions: 5,
    passwordMinLength: 12,
    passwordRequireUppercase: true,
    passwordRequireNumbers: true,
    passwordRequireSymbols: true,
    passwordExpiryDays: 90,
    passwordHistoryCount: 5,
  });

  const [newCidr, setNewCidr] = useState('');
  const [cidrError, setCidrError] = useState('');
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    fetchPolicy();
  }, [fetchPolicy]);

  useEffect(() => {
    if (policy) {
      setFormData({
        ipAllowlistEnabled: policy.ipAllowlistEnabled,
        ipAllowlist: policy.ipAllowlist || [],
        enforceMfa: policy.enforceMfa,
        sessionTimeoutMinutes: policy.sessionTimeoutMinutes || 60,
        maxConcurrentSessions: policy.maxConcurrentSessions || 5,
        passwordMinLength: policy.passwordMinLength || 12,
        passwordRequireUppercase: policy.passwordRequireUppercase ?? true,
        passwordRequireNumbers: policy.passwordRequireNumbers ?? true,
        passwordRequireSymbols: policy.passwordRequireSymbols ?? true,
        passwordExpiryDays: policy.passwordExpiryDays || 90,
        passwordHistoryCount: policy.passwordHistoryCount || 5,
      });
    }
  }, [policy]);

  const validateCidr = (cidr: string) => {
    const ipv4Regex = /^([0-9]{1,3}\.){3}[0-9]{1,3}(\/([0-9]|[1-2][0-9]|3[0-2]))?$/;
    return ipv4Regex.test(cidr.trim());
  };

  const handleAddCidr = () => {
    if (!newCidr) return;
    if (!validateCidr(newCidr)) {
      setCidrError('Invalid CIDR/IP format. (e.g. 192.168.1.0/24 or 10.0.0.1/32)');
      return;
    }
    setCidrError('');
    setFormData((prev) => ({
      ...prev,
      ipAllowlist: [...(prev.ipAllowlist || []), newCidr.trim()],
    }));
    setNewCidr('');
  };

  const handleRemoveCidr = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      ipAllowlist: (prev.ipAllowlist || []).filter((_, i) => i !== index),
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updatePolicy(formData);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch (err) {
      console.error('Failed to update workspace security policy:', err);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Globe className="w-7 h-7 text-indigo-600 dark:text-indigo-400" />
            Workspace Security Policy & IP Allowlist
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Enterprise network access controls, password complexity rules, and session lifecycle settings.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {savedSuccess && (
            <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-semibold">
              <CheckCircle2 className="w-4 h-4" />
              Policy Updated!
            </div>
          )}
          <button
            type="submit"
            disabled={isLoading}
            className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-2xs transition"
          >
            Save Security Policy
          </button>
        </div>
      </div>

      {/* Network Access & IP Allowlisting Card */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-2xs space-y-4">
        <div className="flex items-start justify-between border-b border-gray-100 dark:border-gray-700 pb-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Globe className="w-5 h-5 text-indigo-600" />
              IP CIDR Allowlist Enforcement
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Restrict workspace and API traffic strictly to authorized CIDR subnets or static IP addresses.
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={formData.ipAllowlistEnabled}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, ipAllowlistEnabled: e.target.checked }))
              }
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-hidden rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-indigo-600"></div>
          </label>
        </div>

        {formData.ipAllowlistEnabled && (
          <div className="space-y-4 pt-2">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newCidr}
                onChange={(e) => setNewCidr(e.target.value)}
                placeholder="e.g. 192.168.1.0/24 or 203.0.113.10/32"
                className="flex-1 text-xs font-mono p-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
              />
              <button
                type="button"
                onClick={handleAddCidr}
                className="px-4 py-2.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                Add CIDR
              </button>
            </div>

            {cidrError && (
              <p className="text-xs text-rose-500 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                {cidrError}
              </p>
            )}

            <div className="space-y-2 mt-3">
              {formData.ipAllowlist?.length === 0 ? (
                <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 p-3 rounded-lg border border-amber-200 dark:border-amber-800">
                  Warning: IP Allowlist is enabled but no CIDR ranges are added. All external requests will be blocked!
                </p>
              ) : (
                formData.ipAllowlist?.map((cidr, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-2.5 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700"
                  >
                    <span className="font-mono text-xs font-semibold text-gray-900 dark:text-white">
                      {cidr}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveCidr(idx)}
                      className="p-1 text-rose-600 hover:text-rose-800 rounded transition"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Authentication & MFA Policy */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-2xs space-y-4">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2 border-b border-gray-100 dark:border-gray-700 pb-3">
          <Key className="w-5 h-5 text-indigo-600" />
          MFA & Session Lifecycle Policies
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
          <div className="flex items-center justify-between p-3.5 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
            <div>
              <div className="text-xs font-semibold text-gray-900 dark:text-white">Enforce Workspace MFA</div>
              <div className="text-[11px] text-gray-500">Require 2FA/TOTP for all workspace members</div>
            </div>
            <input
              type="checkbox"
              checked={formData.enforceMfa}
              onChange={(e) => setFormData((prev) => ({ ...prev, enforceMfa: e.target.checked }))}
              className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
              Session Timeout (Minutes)
            </label>
            <input
              type="number"
              min={5}
              max={1440}
              value={formData.sessionTimeoutMinutes}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, sessionTimeoutMinutes: parseInt(e.target.value, 10) || 60 }))
              }
              className="w-full text-xs p-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
              Max Concurrent Sessions Per User
            </label>
            <input
              type="number"
              min={1}
              max={20}
              value={formData.maxConcurrentSessions}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, maxConcurrentSessions: parseInt(e.target.value, 10) || 5 }))
              }
              className="w-full text-xs p-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
        </div>
      </div>

      {/* Password Complexity Policy */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-2xs space-y-4">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2 border-b border-gray-100 dark:border-gray-700 pb-3">
          <Lock className="w-5 h-5 text-indigo-600" />
          Enterprise Password Standards
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
              Min Length (Characters)
            </label>
            <input
              type="number"
              min={8}
              max={64}
              value={formData.passwordMinLength}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, passwordMinLength: parseInt(e.target.value, 10) || 12 }))
              }
              className="w-full text-xs p-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
              Password Expiry (Days)
            </label>
            <input
              type="number"
              min={0}
              max={365}
              value={formData.passwordExpiryDays}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, passwordExpiryDays: parseInt(e.target.value, 10) || 90 }))
              }
              className="w-full text-xs p-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
              Password History Guard
            </label>
            <input
              type="number"
              min={0}
              max={24}
              value={formData.passwordHistoryCount}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, passwordHistoryCount: parseInt(e.target.value, 10) || 5 }))
              }
              className="w-full text-xs p-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
          <label className="flex items-center gap-2 text-xs font-medium text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={formData.passwordRequireUppercase}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, passwordRequireUppercase: e.target.checked }))
              }
              className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
            />
            Require Uppercase Letters
          </label>

          <label className="flex items-center gap-2 text-xs font-medium text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={formData.passwordRequireNumbers}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, passwordRequireNumbers: e.target.checked }))
              }
              className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
            />
            Require Numeric Digits
          </label>

          <label className="flex items-center gap-2 text-xs font-medium text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={formData.passwordRequireSymbols}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, passwordRequireSymbols: e.target.checked }))
              }
              className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
            />
            Require Special Characters
          </label>
        </div>
      </div>
    </form>
  );
};
export default IpAllowlistSettings;