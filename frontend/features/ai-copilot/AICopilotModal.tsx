'use client';

import * as React from 'react';
import { Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { CopilotChat } from './CopilotChat';

interface AICopilotModalProps {
  isOpen: boolean;
  onClose: () => void;
  workflowId?: string;
  onApplyWorkflowChanges?: (changes: any) => void;
}

export function AICopilotModal({
  isOpen,
  onClose,
  workflowId,
  onApplyWorkflowChanges,
}: AICopilotModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between px-5 py-3.5 bg-slate-950 border-b border-slate-800">
          <div className="flex items-center space-x-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-xs">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">AI Workspace Copilot</h2>
              <p className="text-[11px] text-slate-400">Enterprise generative workflow assistant</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-hidden p-3 bg-slate-900">
          <CopilotChat
            workflowId={workflowId}
            onApplyAction={(action) => {
              if (onApplyWorkflowChanges && action) {
                onApplyWorkflowChanges(action.payload);
              }
              onClose();
            }}
            className="border-0 shadow-none bg-transparent"
          />
        </div>
      </div>
    </div>
  );
}

export default AICopilotModal;
