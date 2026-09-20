'use client';

import * as React from 'react';
import { Zap, Settings, Layout, Activity, List, Clock, X, Check, CircleDot, Pause, Play } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import { ExecutionTimeline, type DebugStep } from './ExecutionTimeline';
import { VariableWatchTable, type WatchVariable } from './VariableWatchTable';

interface DebuggerControlsProps {
  isPlaying: boolean;
  currentStep: number;
  totalSteps: number;
  onTogglePlay: () => void;
  onStepBack: () => void;
  onStepForward: () => void;
  onReset: () => void;
  onChangeSpeed: (speed: number) => void;
  breakpointCount: number;
}

export function DebuggerControls({
  isPlaying,
  currentStep,
  totalSteps,
  onTogglePlay,
  onStepBack,
  onStepForward,
  onReset,
  onChangeSpeed,
  breakpointCount,
}: DebuggerControlsProps) {
  return (
    <div className="flex items-center gap-3 p-4 bg-slate-950 border-t border-slate-800">
      <div className="flex items-center space-x-2">
        <Button
          size="sm"
          variant="outline"
          onClick={onReset}
          title="Reset debugger"
          className="h-8 px-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700"
        >
          <Settings className="w-3.5 h-3.5" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={currentStep <= 0}
          onClick={onStepBack}
          title="Step back"
          className="h-8 px-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700"
        >
          <Zap className="w-3.5 h-3.5" />
        </Button>
        <Button
          size="sm"
          variant="default"
          onClick={onTogglePlay}
          className="h-8 px-4 bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1.5"
        >
          {isPlaying ? (
            <>
              <Pause className="w-3.5 h-3.5" />
              Pause
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5 fill-white" />
              Play
            </>
          )}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={currentStep >= totalSteps - 1}
          onClick={onStepForward}
          title="Step forward"
          className="h-8 px-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700"
        >
          <Activity className="w-3.5 h-3.5" />
        </Button>
      </div>

      <div className="flex-1 flex items-center justify-center gap-4">
        <span className="text-xs text-slate-400">
          Step <strong className="text-white font-mono">{currentStep + 1}</strong> of{' '}
          <strong className="text-white font-mono">{totalSteps}</strong>
        </span>
        <div className="h-4 w-px bg-slate-800" />
        <span className="text-[11px] text-slate-400 flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-rose-500 inline-block" />
          {breakpointCount} breakpoints
        </span>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-xs text-slate-400">Speed:</span>
        <div className="relative w-24">
          <select
            onChange={(e) => onChangeSpeed(Number(e.target.value))}
            className="block w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white appearance-none"
          >
            <option value="0.5">0.5x</option>
            <option value="1" selected>
              1x
            </option>
            <option value="2">2x</option>
            <option value="4">4x</option>
          </select>
        </div>
      </div>
    </div>
  );
}

interface DebuggerPanelProps {
  isActive: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

function DebuggerPanel({
  isActive,
  onClose,
  title,
  children,
}: DebuggerPanelProps) {
  if (!isActive) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 bg-slate-950 border-b border-slate-800">
          <div className="flex items-center space-x-2">
            <Zap className="w-4 h-4 text-indigo-400" />
            <h2 className="text-sm font-bold text-white">{title}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-hidden p-4">{children}</div>
      </div>
    </div>
  );
}

export interface InteractiveDebuggerProps {
  workflowId: string;
  executionId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function InteractiveDebugger({
  workflowId,
  executionId,
  isOpen,
  onClose,
}: InteractiveDebuggerProps) {
  // Mock debug data - in a real implementation, this would come from a debug API
  const [debugSession, setDebugSession] = React.useState({
    isInitialized: false,
    currentStep: 0,
    totalSteps: 0,
    isPlaying: false,
    speed: 1,
    steps: [] as DebugStep[],
    variables: [] as WatchVariable[],
    breakpointCount: 0,
  });

  React.useEffect(() => {
    // Initialize debug session with mock data
    const initializeDebugSession = async () => {
      // Simulate fetching debug data
      setTimeout(() => {
        const mockSteps: DebugStep[] = [
          {
            id: 'step-1',
            nodeId: 'node-trigger',
            nodeName: 'Workflow Trigger',
            nodeType: 'webhook',
            status: 'SUCCEEDED',
            durationMs: 120,
            hasBreakpoint: false,
            timestamp: new Date(Date.now() - 5000).toISOString(),
          },
          {
            id: 'step-2',
            nodeId: 'node-condition-1',
            nodeName: 'Validate Input',
            nodeType: 'condition',
            status: 'SUCCEEDED',
            durationMs: 80,
            hasBreakpoint: true,
            timestamp: new Date(Date.now() - 4500).toISOString(),
          },
          {
            id: 'step-3',
            nodeId: 'node-action-1',
            nodeName: 'Enrich Data',
            nodeType: 'action',
            status: 'RUNNING',
            durationMs: undefined,
            hasBreakpoint: false,
            timestamp: new Date(Date.now() - 3000).toISOString(),
          },
          {
            id: 'step-4',
            nodeId: 'node-action-2',
            nodeName: 'Call API',
            nodeType: 'action',
            status: 'PENDING',
            durationMs: undefined,
            hasBreakpoint: false,
            timestamp: '',
          },
          {
            id: 'step-5',
            nodeId: 'node-condition-2',
            nodeName: 'Check Response',
            nodeType: 'condition',
            status: 'PENDING',
            durationMs: undefined,
            hasBreakpoint: false,
            timestamp: '',
          },
          {
            id: 'step-6',
            nodeId: 'node-action-3',
            nodeName: 'Update DB',
            nodeType: 'action',
            status: 'PENDING',
            durationMs: undefined,
            hasBreakpoint: false,
            timestamp: '',
          },
          {
            id: 'step-7',
            nodeId: 'node-end',
            nodeName: 'Workflow End',
            nodeType: 'webhook',
            status: 'PENDING',
            durationMs: undefined,
            hasBreakpoint: false,
            timestamp: '',
          },
        ];

        const mockVariables: WatchVariable[] = [
          {
            id: 'var-1',
            name: 'payload',
            type: 'object',
            value: { orderId: 'ord_123', customerId: 'cus_456', amount: 99.99 },
            scope: 'global',
          },
          {
            id: 'var-2',
            name: 'validationResult',
            type: 'boolean',
            value: true,
            scope: 'step_output',
            previousValue: false,
            isModified: true,
          },
          {
            id: 'var-3',
            name: 'apiResponse',
            type: 'object',
            value: { status: 'success', transactionId: 'txn_789' },
            scope: 'step_output',
          },
          {
            id: 'var-4',
            name: 'retryCount',
            type: 'number',
            value: 0,
            scope: 'state',
          },
        ];

        setDebugSession({
          isInitialized: true,
          currentStep: 2, // Currently on step 3 (0-indexed)
          totalSteps: mockSteps.length,
          isPlaying: false,
          speed: 1,
          steps: mockSteps,
          variables: mockVariables,
          breakpointCount: 1,
        });
      }, 500);
    };

    initializeDebugSession();
  }, [workflowId, executionId]);

  const handleTogglePlay = () => {
    setDebugSession((prev) => ({ ...prev, isPlaying: !prev.isPlaying }));
  };

  const handleStepBack = () => {
    setDebugSession((prev) => ({
      ...prev,
      currentStep: Math.max(0, prev.currentStep - 1),
    }));
  };

  const handleStepForward = () => {
    setDebugSession((prev) => ({
      ...prev,
      currentStep: Math.min(prev.totalSteps - 1, prev.currentStep + 1),
    }));
  };

  const handleReset = () => {
    setDebugSession((prev) => ({
      ...prev,
      currentStep: 0,
      isPlaying: false,
    }));
  };

  const handleChangeSpeed = (speed: number) => {
    setDebugSession((prev) => ({ ...prev, speed }));
  };

  const handleToggleBreakpoint = (nodeId: string) => {
    setDebugSession((prev) => {
      const updatedSteps = prev.steps.map((step) => {
        if (step.nodeId === nodeId) {
          return { ...step, hasBreakpoint: !step.hasBreakpoint };
        }
        return step;
      });

      const breakpointCount = updatedSteps.filter((s) => s.hasBreakpoint).length;

      return { ...prev, steps: updatedSteps, breakpointCount };
    });
  };

  const handleAddWatch = (expression: string) => {
    // In a real implementation, this would add a watch expression
    console.log('Add watch:', expression);
  };

  const handleRemoveWatch = (id: string) => {
    setDebugSession((prev) => ({
      ...prev,
      variables: prev.variables.filter((v) => v.id !== id),
    }));
  };

  const handleMutateVariable = (name: string, newValue: any) => {
    setDebugSession((prev) => {
      const updatedVariables = prev.variables.map((varItem) => {
        if (varItem.name === name) {
          return { ...varItem, value: newValue, isModified: true };
        }
        return varItem;
      });

      return { ...prev, variables: updatedVariables };
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-[1400px] shadow-2xl overflow-hidden flex flex-col max-h-[95vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-950 border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-xs">
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-1.5">
                Interactive Debugger
                <Badge variant="default" size="sm" className="bg-indigo-500/20 text-indigo-300 border-indigo-500/30 text-[10px]">
                  Live
                </Badge>
              </h2>
              <p className="text-[11px] text-slate-400">
                Workflow: {workflowId.substring(0, 8)}... • Execution: {executionId.substring(0, 8)}...
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-hidden">
          <div className="grid grid-cols-12 gap-4 p-4 h-full">
            {/* Left Panel: Controls and Variables */}
            <div className="col-span-4 lg:col-span-3">
              <DebuggerControls
                isPlaying={debugSession.isPlaying}
                currentStep={debugSession.currentStep}
                totalSteps={debugSession.totalSteps}
                onTogglePlay={handleTogglePlay}
                onStepBack={handleStepBack}
                onStepForward={handleStepForward}
                onReset={handleReset}
                onChangeSpeed={handleChangeSpeed}
                breakpointCount={debugSession.breakpointCount}
              />
              <VariableWatchTable
                variables={debugSession.variables}
                onAddWatch={handleAddWatch}
                onRemoveWatch={handleRemoveWatch}
                onMutateVariable={handleMutateVariable}
                className="mt-4"
              />
            </div>

            {/* Center Panel: Execution Timeline */}
            <div className="col-span-8 lg:col-span-6">
              <ExecutionTimeline
                steps={debugSession.steps}
                currentStepIndex={debugSession.currentStep}
                isPlaying={debugSession.isPlaying}
                onStepChange={(index) => {
                  setDebugSession((prev) => ({ ...prev, currentStep: index }));
                }}
                onTogglePlay={handleTogglePlay}
                onReset={handleReset}
                onToggleBreakpoint={handleToggleBreakpoint}
                className="mt-4"
              />
            </div>

            {/* Right Panel: Debug Console and Insights */}
            <div className="col-span-12 lg:col-span-3">
              <div className="mt-4 space-y-4">
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <Activity className="w-3.5 h-3.5 text-indigo-400" />
                    Debug Console
                  </h3>
                  <div className="mt-2 h-[200px] overflow-y-auto text-xs font-mono bg-slate-900 p-3 rounded">
                    <div className="text-slate-300">[DEBUG] Starting execution workflow...</div>
                    <div className="text-slate-300">[DEBUG] Trigger received: webhook payload</div>
                    <div className="text-slate-300">[DEBUG] Evaluating condition: Validate Input</div>
                    <div className="text-slate-300">[DEBUG] Condition result: true (proceeding)</div>
                    <div className="text-slate-300">[DEBUG] Executing action: Enrich Data</div>
                    <div className="text-slate-300">[DEBUG] Action completed successfully</div>
                    <div className="text-slate-300">[DEBUG] Pausing at breakpoint: Validate Input</div>
                  </div>
                </div>

                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <CircleDot className="w-3.5 h-3.5 text-amber-400" />
                    Execution Insights
                  </h3>
                  <div className="mt-2 space-y-2 text-sm">
                    <div className="flex justify-between text-slate-300">
                      <span>Current Step Duration:</span>
                      <span className="font-mono">{debugSession.steps[debugSession.currentStep]?.durationMs ?? '--'}ms</span>
                    </div>
                    <div className="flex justify-between text-slate-300">
                      <span>Average Step Time:</span>
                      <span className="font-mono">145ms</span>
                    </div>
                    <div className="flex justify-between text-slate-300">
                      <span>Breakpoints Hit:</span>
                      <span className="font-mono">{debugSession.breakpointCount}</span>
                    </div>
                    <div className="flex justify-between text-slate-300">
                      <span>Variables Modified:</span>
                      <span className="font-mono">
                        {debugSession.variables.filter((v) => v.isModified).length}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default InteractiveDebugger;