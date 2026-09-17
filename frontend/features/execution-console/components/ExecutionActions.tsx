'use client';

import * as React from 'react';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { hasPermission } from '@/types/permissions';
import { executionConsoleApi } from '@/services/executionConsoleApi';
import type { ExecutionStatus } from '@/features/execution-console/types/types';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import {
  RotateCw,
  Play,
  Ban,
  AlertTriangle,
  CheckCircle2,
  Lock,
} from 'lucide-react';

interface ExecutionActionsProps {
  executionId: string;
  status: ExecutionStatus;
  workspaceId?: string;
  onActionComplete?: (action: 'retry' | 'replay' | 'cancel', result?: any) => void;
  className?: string;
}

type ActionType = 'retry' | 'replay' | 'cancel';

export function ExecutionActions({
  executionId,
  status,
  workspaceId,
  onActionComplete,
  className = '',
}: ExecutionActionsProps) {
  const { currentRole } = useWorkspaceStore();
  const canExecute = hasPermission(currentRole, 'WORKFLOW_EXECUTE');

  const [activeModal, setActiveModal] = React.useState<ActionType | null>(null);
  const [cancelReason, setCancelReason] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const isFailed = status === 'FAILED';
  const isRunning =
    status === 'RUNNING' ||
    status === 'QUEUED' ||
    status === 'QUEUING' ||
    status === 'RETRYING';
  const isCompleted = status === 'SUCCEEDED' || status === 'FAILED' || status === 'CANCELLED';

  const handleAction = async (action: ActionType) => {
    setLoading(true);
    setFeedback(null);
    try {
      let result;
      if (action === 'retry') {
        result = await executionConsoleApi.retryExecution(executionId, {}, workspaceId);
        setFeedback({ type: 'success', message: 'Execution retry triggered successfully.' });
      } else if (action === 'replay') {
        result = await executionConsoleApi.replayExecution(executionId, workspaceId);
        setFeedback({ type: 'success', message: 'Execution replayed successfully.' });
      } else if (action === 'cancel') {
        result = await executionConsoleApi.cancelExecution(executionId, cancelReason || undefined, workspaceId);
        setFeedback({ type: 'success', message: 'Execution cancellation requested.' });
      }

      setActiveModal(null);
      setCancelReason('');
      if (onActionComplete) {
        onActionComplete(action, result);
      }
    } catch (err: any) {
      console.error(`Failed to ${action} execution:`, err);
      setFeedback({
        type: 'error',
        message:
          err?.response?.data?.message ||
          err?.response?.data?.error?.message ||
          `Failed to ${action} execution.`,
      });
    } finally {
      setLoading(false);
    }
  };

  if (!canExecute) {
    return (
      <div className={`flex items-center space-x-2 text-xs text-gray-500 ${className}`}>
        <Lock className="w-3.5 h-3.5 text-gray-400" />
        <span>Execution controls restricted to Editors & Admins</span>
      </div>
    );
  }

  return (
    <div className={`flex items-center space-x-2.5 ${className}`}>
      {/* Toast Feedback */}
      {feedback && (
        <div
          className={`fixed top-16 right-6 z-50 flex items-center space-x-2 px-4 py-2.5 rounded-lg shadow-lg border text-xs font-medium ${
            feedback.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-rose-50 text-rose-800 border-rose-200'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Retry Button - only for FAILED */}
      {isFailed && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setActiveModal('retry')}
          className="bg-white hover:bg-amber-50 text-amber-700 border-amber-300 shadow-2xs text-xs h-8"
        >
          <RotateCw className="w-3.5 h-3.5 mr-1.5" />
          Retry Execution
        </Button>
      )}

      {/* Replay Button - for completed executions */}
      {isCompleted && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setActiveModal('replay')}
          className="bg-white hover:bg-blue-50 text-blue-700 border-blue-200 shadow-2xs text-xs h-8"
        >
          <Play className="w-3.5 h-3.5 mr-1.5" />
          Replay
        </Button>
      )}

      {/* Cancel Button - only for running executions */}
      {isRunning && (
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setActiveModal('cancel')}
          className="text-xs h-8"
        >
          <Ban className="w-3.5 h-3.5 mr-1.5" />
          Cancel Execution
        </Button>
      )}

      {/* Confirmation Modals */}
      {/* Retry Modal */}
      <Modal
        open={activeModal === 'retry'}
        onOpenChange={(open) => !open && setActiveModal(null)}
        title="Confirm Execution Retry"
        description="This will re-run the failed execution from its failed state using its original inputs."
        footer={
          <div className="flex justify-end space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setActiveModal(null)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => handleAction('retry')}
              disabled={loading}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {loading ? (
                <>
                  <RotateCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  Retrying...
                </>
              ) : (
                'Confirm Retry'
              )}
            </Button>
          </div>
        }
      >
        <div className="text-xs text-gray-600 space-y-2">
          <p>
            Are you sure you want to retry execution <code className="font-mono bg-gray-100 px-1 py-0.5 rounded">{executionId}</code>?
          </p>
          <p className="text-gray-500">
            A new attempt will be scheduled on the workflow worker queue immediately.
          </p>
        </div>
      </Modal>

      {/* Replay Modal */}
      <Modal
        open={activeModal === 'replay'}
        onOpenChange={(open) => !open && setActiveModal(null)}
        title="Confirm Execution Replay"
        description="Replays the execution pipeline as a fresh workflow run."
        footer={
          <div className="flex justify-end space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setActiveModal(null)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => handleAction('replay')}
              disabled={loading}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {loading ? (
                <>
                  <Play className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  Starting Replay...
                </>
              ) : (
                'Confirm Replay'
              )}
            </Button>
          </div>
        }
      >
        <div className="text-xs text-gray-600 space-y-2">
          <p>
            Are you sure you want to replay execution <code className="font-mono bg-gray-100 px-1 py-0.5 rounded">{executionId}</code>?
          </p>
          <p className="text-gray-500">
            This triggers a new execution with identical initial trigger parameters and inputs.
          </p>
        </div>
      </Modal>

      {/* Cancel Modal */}
      <Modal
        open={activeModal === 'cancel'}
        onOpenChange={(open) => !open && setActiveModal(null)}
        title="Cancel In-Progress Execution"
        description="Terminates currently running and queued node jobs for this execution."
        footer={
          <div className="flex justify-end space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setActiveModal(null)}
              disabled={loading}
            >
              Back
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => handleAction('cancel')}
              disabled={loading}
            >
              {loading ? (
                <>
                  <Ban className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  Cancelling...
                </>
              ) : (
                'Yes, Cancel Execution'
              )}
            </Button>
          </div>
        }
      >
        <div className="space-y-3 text-xs text-gray-600">
          <p>
            Are you sure you want to abort execution <code className="font-mono bg-gray-100 px-1 py-0.5 rounded">{executionId}</code>?
          </p>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Cancellation Reason (Optional)
            </label>
            <Input
              placeholder="e.g. Manual abort due to incorrect input data"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              className="text-xs"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default ExecutionActions;
