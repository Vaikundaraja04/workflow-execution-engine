import React, { useState, useEffect } from 'react';
import {
  KeyRound,
  Lock,
  Plus,
  RefreshCw,
  Trash2,
  Copy,
  Check,
  Eye,
  EyeOff,
  ShieldAlert,
  ShieldCheck,
  Search,
  Layers,
  Calendar,
  AlertCircle,
  Hash,
} from 'lucide-react';
import { useSecurityStore } from '@/stores/securityStore';
import { securityApi } from '@/services/securityApi';
import type { SecretMetadata } from '@/types/security.types';

export const SecretsVaultView: React.FC = () => {
  const {
    secrets,
    fetchSecrets,
    createSecret,
    rotateSecret,
    deleteSecret,
    isLoading,
    error,
  } = useSecurityStore();

  const [environment, setEnvironment] = useState<'development' | 'staging' | 'production'>('development');
  const [searchTerm, setSearchTerm] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [selectedSecret, setSelectedSecret] = useState<SecretMetadata | null>(null);
  const [revealedValue, setRevealedValue] = useState<{ id: string; value: string } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Form states
  const [newSecretName, setNewSecretName] = useState('');
  const [newSecretValue, setNewSecretValue] = useState('');
  const [rotateValue, setRotateValue] = useState('');

  useEffect(() => {
    fetchSecrets(environment);
  }, [environment, fetchSecrets]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSecretName || !newSecretValue) return;
    try {
      await createSecret(newSecretName, environment, newSecretValue);
      setIsCreating(false);
      setNewSecretName('');
      setNewSecretValue('');
    } catch (err) {
      console.error('Failed to create secret:', err);
    }
  };

  const handleRotate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSecret || !rotateValue) return;
    try {
      await rotateSecret(selectedSecret._id, rotateValue);
      setIsRotating(false);
      setSelectedSecret(null);
      setRotateValue('');
    } catch (err) {
      console.error('Failed to rotate secret:', err);
    }
  };

  const handleReveal = async (secretId: string) => {
    if (revealedValue?.id === secretId) {
      setRevealedValue(null);
      return;
    }
    try {
      const res = await securityApi.getSecretValue(secretId);
      setRevealedValue({ id: secretId, value: res.value });
    } catch (err) {
      console.error('Failed to retrieve secret value:', err);
    }
  };

  const handleCopy = (secretId: string, val: string) => {
    navigator.clipboard.writeText(val);
    setCopiedId(secretId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filteredSecrets = secrets.filter((s) =>
    s.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <KeyRound className="w-7 h-7 text-indigo-600 dark:text-indigo-400" />
            Enterprise Secrets Vault
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Envelope-encrypted secrets store (AES-256-GCM) with automated rotation and audit trails.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsCreating(true)}
            className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-2xs transition flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Create Secret
          </button>
        </div>
      </div>

      {/* Environment Selector & Filter */}
      <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-2xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-1">
          {(['development', 'staging', 'production'] as const).map((env) => (
            <button
              key={env}
              onClick={() => setEnvironment(env)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md capitalize transition ${
                environment === env
                  ? 'bg-white dark:bg-gray-800 text-indigo-600 dark:text-indigo-400 shadow-2xs'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              {env}
            </button>
          ))}
        </div>

        <div className="relative flex-1 max-w-xs">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search secrets by name..."
            className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>

      {/* Secrets Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-gray-500 dark:text-gray-400">
            <thead className="text-xs uppercase bg-gray-50 dark:bg-gray-900/50 text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="px-5 py-3.5 font-medium">Secret Name</th>
                <th className="px-5 py-3.5 font-medium">Environment</th>
                <th className="px-5 py-3.5 font-medium">Version</th>
                <th className="px-5 py-3.5 font-medium">Value (AES-256-GCM)</th>
                <th className="px-5 py-3.5 font-medium">Last Rotated</th>
                <th className="px-5 py-3.5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {filteredSecrets.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-gray-400">
                    No secrets configured in {environment} environment
                  </td>
                </tr>
              ) : (
                filteredSecrets.map((secret) => {
                  const isRevealed = revealedValue?.id === secret._id;
                  return (
                    <tr key={secret._id} className="hover:bg-gray-50/50 dark:hover:bg-gray-700/50">
                      <td className="px-5 py-3.5 font-mono text-xs font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <Lock className="w-3.5 h-3.5 text-indigo-500" />
                        {secret.name}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="px-2 py-0.5 text-xs font-semibold rounded-md uppercase bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                          {secret.environment}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs">
                        <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                          v{secret.version}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs bg-gray-100 dark:bg-gray-900 px-2 py-1 rounded text-gray-700 dark:text-gray-300">
                            {isRevealed ? revealedValue.value : '••••••••••••••••••••'}
                          </span>
                          <button
                            onClick={() => handleReveal(secret._id)}
                            className="p-1 hover:text-indigo-600 text-gray-400 transition"
                            title={isRevealed ? 'Hide secret' : 'Reveal secret'}
                          >
                            {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                          {isRevealed && (
                            <button
                              onClick={() => handleCopy(secret._id, revealedValue.value)}
                              className="p-1 hover:text-indigo-600 text-gray-400 transition"
                              title="Copy secret"
                            >
                              {copiedId === secret._id ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-xs whitespace-nowrap">
                        {new Date(secret.lastRotatedAt || secret.createdAt).toLocaleString()}
                      </td>
                      <td className="px-5 py-3.5 text-right flex items-center justify-end gap-2">
                        <button
                          onClick={() => {
                            setSelectedSecret(secret);
                            setIsRotating(true);
                          }}
                          className="p-1.5 text-xs font-medium text-amber-600 hover:text-amber-800 dark:text-amber-400 rounded hover:bg-amber-50 dark:hover:bg-amber-950/30 transition flex items-center gap-1"
                          title="Rotate secret value"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          Rotate
                        </button>
                        <button
                          onClick={() => deleteSecret(secret._id)}
                          className="p-1.5 text-xs font-medium text-rose-600 hover:text-rose-800 dark:text-rose-400 rounded hover:bg-rose-50 dark:hover:bg-rose-950/30 transition"
                          title="Delete secret"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Secret Modal */}
      {isCreating && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl max-w-md w-full p-6 shadow-xl border border-gray-200 dark:border-gray-700">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-indigo-600" />
              Store New Secret
            </h3>
            <p className="text-xs text-gray-500 mb-4">
              Stored with AES-256-GCM envelope encryption and PBKDF2 key derivation.
            </p>

            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Secret Identifier / Key
                </label>
                <input
                  type="text"
                  required
                  value={newSecretName}
                  onChange={(e) => setNewSecretName(e.target.value.toUpperCase().replace(/\s+/g, '_'))}
                  placeholder="e.g. STRIPE_API_KEY, AWS_SECRET_ACCESS_KEY"
                  className="w-full text-xs font-mono p-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Environment
                </label>
                <input
                  type="text"
                  disabled
                  value={environment.toUpperCase()}
                  className="w-full text-xs p-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-900 text-gray-500 dark:text-gray-400 font-semibold"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Plaintext Value
                </label>
                <textarea
                  required
                  value={newSecretValue}
                  onChange={(e) => setNewSecretValue(e.target.value)}
                  placeholder="Enter sensitive secret value here..."
                  rows={3}
                  className="w-full text-xs font-mono p-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreating(false)}
                  className="px-4 py-2 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-2xs transition"
                >
                  Save Secret
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rotate Secret Modal */}
      {isRotating && selectedSecret && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl max-w-md w-full p-6 shadow-xl border border-gray-200 dark:border-gray-700">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
              <RefreshCw className="w-5 h-5 text-amber-600" />
              Rotate Secret: {selectedSecret.name}
            </h3>
            <p className="text-xs text-gray-500 mb-4">
              Rotating creates version {selectedSecret.version + 1} and re-encrypts with a fresh Data Encryption Key (DEK).
            </p>

            <form onSubmit={handleRotate} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  New Plaintext Value
                </label>
                <textarea
                  required
                  value={rotateValue}
                  onChange={(e) => setRotateValue(e.target.value)}
                  placeholder="Enter new sensitive secret value..."
                  rows={3}
                  className="w-full text-xs font-mono p-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsRotating(false);
                    setSelectedSecret(null);
                  }}
                  className="px-4 py-2 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="px-4 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow-2xs transition"
                >
                  Confirm Rotation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
export default SecretsVaultView;