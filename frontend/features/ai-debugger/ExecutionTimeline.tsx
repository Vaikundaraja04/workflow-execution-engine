'use client';

import * as React from 'react';
import { Play, Pause, SkipForward, SkipBack, RotateCcw, AlertOctagon, CheckCircle2, Clock, CircleDot, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';

export interface DebugStep {
  id: string;
  nodeId: string;
  nodeName: string;
  nodeType: string;
  status: 'SUCCEEDED' | 'FAILED' | 'RUNNING' | 'PAUSED' | 'PENDING';
  durationMs?: number;
  hasBreakpoint?: boolean;
  timestamp: string;
  error?: string;
}

interface ExecutionTimelineProps {
  steps: DebugStep[];
  currentStepIndex: number;
  isPlaying: boolean;
  onStepChange: (index: number) => void;
  onTogglePlay: () => void;
  onReset: () => void;
  onToggleBreakpoint: (nodeId: string) => void;
  className?: string;
}

export function ExecutionTimeline({
  steps,
  currentStepIndex,
  isPlaying,
  onStepChange,
  onTogglePlay,
  onReset,
  onToggleBreakpoint,
  className,
}: ExecutionTimelineProps) {
  return (
    <div className={cn('bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl flex flex-col space-y-4', className)}>
      {/* Playback Controls Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="flex items-center space-x-2">
          <Button
            size="sm"
            variant="outline"
            onClick={onReset}
            title="Reset to beginning"
            className="h-8 px-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={currentStepIndex <= 0}
            onClick={() => onStepChange(Math.max(0, currentStepIndex - 1))}
            title="Step back"
            className="h-8 px-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700"
          >
            <SkipBack className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="sm"
            variant="default"
            onClick={onTogglePlay}
            className="h-8 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs flex items-center gap-1.5"
          >
            {isPlaying ? (
              <>
                <Pause className="w-3.5 h-3.5" />
                Pause
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-white" />
                Play Timeline
              </>
            )}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={currentStepIndex >= steps.length - 1}
            onClick={() => onStepChange(Math.min(steps.length - 1, currentStepIndex + 1))}
            title="Step forward"
            className="h-8 px-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700"
          >
            <SkipForward className="w-3.5 h-3.5" />
          </Button>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">
            Step <strong className="text-white font-mono">{currentStepIndex + 1}</strong> of{' '}
            <strong className="text-white font-mono">{steps.length}</strong>
          </span>
          <div className="h-4 w-px bg-slate-800" />
          <span className="text-[11px] text-slate-400 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-rose-500 inline-block" />
            Click dot to toggle breakpoint
          </span>
        </div>
      </div>

      {/* Visual Timeline Nodes */}
      <div className="relative py-2 overflow-x-auto">
        <div className="flex items-center min-w-max space-x-2 px-2">
          {steps.map((step, idx) => {
            const isCurrent = idx === currentStepIndex;
            const isPast = idx < currentStepIndex;

            return (
              <div key={step.id} className="flex items-center">
                {/* Node Pill */}
                <div
                  onClick={() => onStepChange(idx)}
                  className={cn(
                    'group relative flex flex-col p-3 rounded-xl border transition-all cursor-pointer min-w-[150px]',
                    isCurrent
                      ? 'bg-indigo-950/80 border-indigo-500 shadow-lg shadow-indigo-500/20 ring-2 ring-indigo-500/30'
                      : isPast
                        ? 'bg-slate-800/80 border-slate-700 text-slate-300 hover:border-slate-600'
                        : 'bg-slate-900/60 border-slate-800 text-slate-500 hover:border-slate-700'
                  )}
                >
                  {/* Breakpoint indicator toggle */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleBreakpoint(step.nodeId);
                    }}
                    title={step.hasBreakpoint ? 'Remove breakpoint' : 'Add breakpoint'}
                    className="absolute -top-1.5 -left-1.5 p-0.5 rounded-full bg-slate-900 border border-slate-700 hover:scale-125 transition-all cursor-pointer"
                  >
                    <div
                      className={cn(
                        'w-3 h-3 rounded-full',
                        step.hasBreakpoint ? 'bg-rose-500 shadow-sm shadow-rose-500/50 ring-2 ring-rose-500/30' : 'bg-slate-700 hover:bg-rose-400'
                      )}
                    />
                  </button>

                  <div className="flex items-center justify-between gap-1.5 mb-1">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                      #{idx + 1} {step.nodeType}
                    </span>
                    {step.status === 'SUCCEEDED' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                    {step.status === 'FAILED' && <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />}
                    {step.status === 'RUNNING' && <CircleDot className="w-3.5 h-3.5 text-amber-400 animate-pulse" />}
                  </div>

                  <span className="text-xs font-semibold truncate text-white max-w-[130px]">
                    {step.nodeName}
                  </span>

                  <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400 border-t border-slate-800/80 pt-1.5">
                    <span>{step.durationMs ? `${step.durationMs}ms` : '--'}</span>
                    <span className="capitalize">{step.status.toLowerCase()}</span>
                  </div>
                </div>

                {/* Arrow Connector */}
                {idx < steps.length - 1 && (
                  <div className="w-6 h-0.5 bg-slate-800 mx-1 flex items-center justify-center">
                    <div className={cn('w-1.5 h-1.5 rounded-full', isPast ? 'bg-indigo-500' : 'bg-slate-700')} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default ExecutionTimeline;
