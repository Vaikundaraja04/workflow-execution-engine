import React from 'react';
import { AlertTriangle, Lock, RefreshCw, Eye, ShieldAlert, X } from 'lucide-react';
import type { WorkflowLockState } from '@/types/collaboration';

interface ConflictResolverProps {
  isOpen: boolean;
  lockConflict: WorkflowLockState | null;
  onViewReadOnly: () => void;
  onForceTakeover?: () => Promise<void>;
  onReloadWorkflow: () => void;
  onClose: () => void;
  isTakingOver?: boolean;
}

export const ConflictResolver: React.FC<ConflictResolverProps> = ({
  isOpen,
  lockConflict,
  onViewReadOnly,
  onForceTakeover,
  onReloadWorkflow,
  onClose,
  isTakingOver = false,
}) => {
  if (!isOpen || !lockConflict) return null;

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '';
    try {
      return new Date(dateStr).toLocaleTimeString();
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-800 max-w-md w-full overflow-hidden">
        {/* Header */}
        <div className="p-4 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800/60 flex items-start justify-between">
          <div className="flex items-center space-x-2.5 text-amber-900 dark:text-amber-200">
            <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold">Editing Conflict Detected</h3>
              <p className="text-xs text-amber-700 dark:text-amber-400">
                This workflow is currently being edited by another user.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-amber-700 dark:text-amber-400 hover:text-amber-900 p-1 rounded-md"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 text-xs">
          <div className="bg-gray-50 dark:bg-gray-800/60 p-3 rounded-lg border border-gray-200 dark:border-gray-700/60 space-y-1.5">
            <div className="flex justify-between">
              <span className="text-gray-500">Current Editor:</span>
              <span className="font-semibold text-gray-900 dark:text-gray-100">
                {lockConflict.userName || lockConflict.userEmail || 'Team Member'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Email:</span>
              <span className="text-gray-700 dark:text-gray-300">{lockConflict.userEmail}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Lock Acquired:</span>
              <span className="text-gray-700 dark:text-gray-300">{formatDate(lockConflict.acquiredAt)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Lock Expiry:</span>
              <span className="text-gray-700 dark:text-gray-300">
                {Math.max(0, Math.round(lockConflict.ttlRemainingMs / 1000))}s remaining
              </span>
            </div>
          </div>

          <p className="text-gray-600 dark:text-gray-300 leading-relaxed">
            To prevent accidental overwrites, concurrent editing of this workflow is protected.
            You can view the workflow in read-only mode, reload to get the latest draft, or take over editing if you are an administrator.
          </p>

          {/* Action Buttons */}
          <div className="space-y-2 pt-2">
            <button
              onClick={onViewReadOnly}
              className="w-full flex items-center justify-center space-x-2 px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200 font-medium transition-colors"
            >
              <Eye className="w-4 h-4" />
              <span>Switch to Read-Only Mode</span>
            </button>

            <button
              onClick={onReloadWorkflow}
              className="w-full flex items-center justify-center space-x-2 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-medium transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Reload Latest Workflow Version</span>
            </button>

            {onForceTakeover && (
              <button
                onClick={onForceTakeover}
                disabled={isTakingOver}
                className="w-full flex items-center justify-center space-x-2 px-3 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-medium transition-colors disabled:opacity-50"
              >
                <ShieldAlert className="w-4 h-4" />
                <span>{isTakingOver ? 'Taking Over...' : 'Force Takeover & Acquire Lock'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConflictResolver;
