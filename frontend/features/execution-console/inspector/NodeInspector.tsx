'use client';

import * as React from 'react';
import { useExecutionStore } from '@/features/execution-console/stores/executionStore';
import type { ExecutionNode } from '@/features/execution-console/types/types';
import { Badge } from '@/components/ui/Badge';
import {
  Code2,
  Copy,
  Check,
  AlertTriangle,
  Clock,
  RotateCw,
  Layers,
  FileJson,
  Activity,
  Calendar,
  X,
} from 'lucide-react';

interface NodeInspectorProps {
  node?: ExecutionNode | null;
  onClose?: () => void;
}

export function NodeInspector({ node: propNode, onClose }: NodeInspectorProps) {
  const { selectedNode: storeNode, setSelectedNode } = useExecutionStore();
  const activeNode = propNode !== undefined ? propNode : storeNode;

  const [activeTab, setActiveTab] = React.useState<'input' | 'output' | 'metadata'>('input');
  const [copiedKey, setCopiedKey] = React.useState<string | null>(null);

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleClose = () => {
    if (onClose) {
      onClose();
    } else {
      setSelectedNode(null);
    }
  };

  if (!activeNode) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 bg-white rounded-xl border border-gray-200 text-center">
        <div className="p-3 bg-gray-50 rounded-full text-gray-400 mb-3">
          <Layers className="w-8 h-8" />
        </div>
        <h3 className="text-sm font-semibold text-gray-800">No Node Selected</h3>
        <p className="text-xs text-gray-500 mt-1 max-w-xs">
          Select a node from the execution timeline graph above to inspect its input parameters, output data, and execution metadata.
        </p>
      </div>
    );
  }

  const durationStr =
    activeNode.duration !== null && activeNode.duration !== undefined
      ? activeNode.duration >= 1000
        ? `${(activeNode.duration / 1000).toFixed(2)}s`
        : `${activeNode.duration}ms`
      : '--';

  const formatJson = (data: unknown) => {
    if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
      return '{}';
    }
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return String(data);
    }
  };

  const inputJson = formatJson(activeNode.input);
  const outputJson = formatJson(activeNode.output);

  return (
    <div className="h-full flex flex-col bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
        <div className="flex items-center space-x-2.5 min-w-0">
          <div className="p-1.5 rounded-lg bg-blue-100 text-blue-700 shrink-0">
            <Code2 className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-gray-900 truncate" title={activeNode.name}>
              {activeNode.name}
            </h3>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[11px] font-mono text-gray-500 uppercase">
                {activeNode.type}
              </span>
              <span className="text-gray-300">•</span>
              <span className="text-[11px] font-mono text-gray-400">
                ID: {activeNode.id}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          <Badge
            variant={
              activeNode.status === 'SUCCEEDED'
                ? 'success'
                : activeNode.status === 'FAILED'
                ? 'destructive'
                : activeNode.status === 'RUNNING'
                ? 'default'
                : 'secondary'
            }
            size="sm"
          >
            {activeNode.status}
          </Badge>
          <button
            onClick={handleClose}
            aria-label="Close inspector"
            className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 bg-white shrink-0 px-4">
        <button
          onClick={() => setActiveTab('input')}
          className={`py-2.5 px-3 text-xs font-semibold flex items-center space-x-1.5 border-b-2 transition-colors ${
            activeTab === 'input'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <FileJson className="w-3.5 h-3.5" />
          <span>Inputs</span>
        </button>
        <button
          onClick={() => setActiveTab('output')}
          className={`py-2.5 px-3 text-xs font-semibold flex items-center space-x-1.5 border-b-2 transition-colors ${
            activeTab === 'output'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <FileJson className="w-3.5 h-3.5" />
          <span>Outputs</span>
          {activeNode.error && (
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
          )}
        </button>
        <button
          onClick={() => setActiveTab('metadata')}
          className={`py-2.5 px-3 text-xs font-semibold flex items-center space-x-1.5 border-b-2 transition-colors ${
            activeTab === 'metadata'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>Metadata</span>
        </button>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-4 bg-slate-50/50">
        {activeTab === 'input' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-700">Node Input Payload</span>
              <button
                onClick={() => handleCopy(inputJson, 'input')}
                className="flex items-center space-x-1 text-xs text-gray-500 hover:text-gray-800 bg-white border border-gray-200 rounded px-2 py-1 shadow-2xs"
              >
                {copiedKey === 'input' ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-emerald-600">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy JSON</span>
                  </>
                )}
              </button>
            </div>
            <pre className="p-3 bg-gray-900 text-gray-100 rounded-lg text-xs font-mono overflow-x-auto border border-gray-800 max-h-[350px]">
              {inputJson}
            </pre>
          </div>
        )}

        {activeTab === 'output' && (
          <div className="space-y-4">
            {activeNode.error && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-xs">
                <div className="flex items-center space-x-2 font-semibold text-rose-900 mb-1">
                  <AlertTriangle className="w-4 h-4 text-rose-600" />
                  <span>Execution Error</span>
                </div>
                <div className="font-mono whitespace-pre-wrap">{activeNode.error}</div>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-700">Node Output Result</span>
                <button
                  onClick={() => handleCopy(outputJson, 'output')}
                  className="flex items-center space-x-1 text-xs text-gray-500 hover:text-gray-800 bg-white border border-gray-200 rounded px-2 py-1 shadow-2xs"
                >
                  {copiedKey === 'output' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="text-emerald-600">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy JSON</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="p-3 bg-gray-900 text-gray-100 rounded-lg text-xs font-mono overflow-x-auto border border-gray-800 max-h-[350px]">
                {outputJson}
              </pre>
            </div>
          </div>
        )}

        {activeTab === 'metadata' && (
          <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="text-gray-400 block text-[11px] font-medium">Node ID</span>
                <span className="font-mono font-medium text-gray-800">{activeNode.id}</span>
              </div>
              <div>
                <span className="text-gray-400 block text-[11px] font-medium">Node Type</span>
                <span className="font-mono font-medium text-gray-800 uppercase">{activeNode.type}</span>
              </div>
              <div>
                <span className="text-gray-400 block text-[11px] font-medium">Execution Status</span>
                <Badge
                  variant={
                    activeNode.status === 'SUCCEEDED'
                      ? 'success'
                      : activeNode.status === 'FAILED'
                      ? 'destructive'
                      : activeNode.status === 'RUNNING'
                      ? 'default'
                      : 'secondary'
                  }
                  size="sm"
                  className="mt-1"
                >
                  {activeNode.status}
                </Badge>
              </div>
              <div>
                <span className="text-gray-400 block text-[11px] font-medium">Attempt</span>
                <span className="font-mono font-medium text-gray-800">#{activeNode.attempt || 1}</span>
              </div>
              <div>
                <span className="text-gray-400 block text-[11px] font-medium">Duration</span>
                <span className="font-mono font-medium text-gray-800">{durationStr}</span>
              </div>
              <div>
                <span className="text-gray-400 block text-[11px] font-medium">Started At</span>
                <span className="font-mono text-gray-600">
                  {activeNode.startedAt ? new Date(activeNode.startedAt).toLocaleString() : '--'}
                </span>
              </div>
              <div>
                <span className="text-gray-400 block text-[11px] font-medium">Finished At</span>
                <span className="font-mono text-gray-600">
                  {activeNode.finishedAt ? new Date(activeNode.finishedAt).toLocaleString() : '--'}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default NodeInspector;
