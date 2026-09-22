'use client';

import * as React from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  Handle,
  Position,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useExecutionStore } from '@/features/execution-console/stores/executionStore';
import type { ExecutionNode, ExecutionStatus } from '@/features/execution-console/types/types';
import { Badge } from '@/components/ui/Badge';
import {
  CheckCircle2,
  XCircle,
  Clock,
  RotateCw,
  Ban,
  Activity,
  Calendar,
  Layers,
} from 'lucide-react';

interface ExecutionTimelineProps {
  nodes?: ExecutionNode[];
  selectedNodeId?: string | null;
  onSelectNode?: (node: ExecutionNode) => void;
  className?: string;
}

const statusBadgeConfig: Record<
  ExecutionStatus,
  { variant: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'info'; icon: React.ReactNode; bg: string; border: string }
> = {
  PENDING: {
    variant: 'secondary',
    icon: <Clock className="w-3.5 h-3.5 text-amber-600" />,
    bg: 'bg-amber-50/70',
    border: 'border-amber-300',
  },
  SUCCEEDED: {
    variant: 'success',
    icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />,
    bg: 'bg-emerald-50/70',
    border: 'border-emerald-300',
  },
  COMPLETED: {
    variant: 'success',
    icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />,
    bg: 'bg-emerald-50/70',
    border: 'border-emerald-300',
  },
  FAILED: {
    variant: 'destructive',
    icon: <XCircle className="w-3.5 h-3.5 text-rose-600" />,
    bg: 'bg-rose-50/70',
    border: 'border-rose-300',
  },
  RUNNING: {
    variant: 'default',
    icon: <RotateCw className="w-3.5 h-3.5 text-blue-600 animate-spin" />,
    bg: 'bg-blue-50/70',
    border: 'border-blue-300',
  },
  QUEUED: {
    variant: 'secondary',
    icon: <Clock className="w-3.5 h-3.5 text-amber-600" />,
    bg: 'bg-amber-50/70',
    border: 'border-amber-300',
  },
  QUEUING: {
    variant: 'secondary',
    icon: <Clock className="w-3.5 h-3.5 text-amber-600" />,
    bg: 'bg-amber-50/70',
    border: 'border-amber-300',
  },
  RETRYING: {
    variant: 'warning',
    icon: <RotateCw className="w-3.5 h-3.5 text-purple-600 animate-spin" />,
    bg: 'bg-purple-50/70',
    border: 'border-purple-300',
  },
  CANCELLED: {
    variant: 'outline',
    icon: <Ban className="w-3.5 h-3.5 text-gray-500" />,
    bg: 'bg-gray-50/70',
    border: 'border-gray-300',
  },
};

// Custom Node for React Flow execution view
const ExecutionNodeCard: React.FC<{
  data: ExecutionNode & { isSelected?: boolean; onSelectNode?: (node: ExecutionNode) => void };
}> = ({ data }) => {
  const cfg = statusBadgeConfig[data.status] || {
    variant: 'outline',
    icon: <Clock className="w-3.5 h-3.5 text-gray-500" />,
    bg: 'bg-gray-50/70',
    border: 'border-gray-200',
  };

  const formatDuration = (ms: number | null | undefined) => {
    if (ms === null || ms === undefined) {
      return data.startedAt && !data.finishedAt ? 'In progress' : '--';
    }
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const remSec = seconds % 60;
    return remSec > 0 ? `${mins}m ${remSec}s` : `${mins}m`;
  };

  const durationStr = formatDuration(data.duration);

  return (
    <div
      onClick={() => data.onSelectNode?.(data)}
      data-testid={`timeline-node-${data.id}`}
      className={`relative min-w-[240px] max-w-[280px] rounded-xl border-2 p-3 shadow-sm transition-all bg-white cursor-pointer ${
        data.isSelected
          ? 'border-blue-600 ring-2 ring-blue-500/20 shadow-md'
          : `${cfg.border} hover:border-gray-400`
      }`}
    >
      <Handle type="target" position={Position.Left} className="w-2 h-2 !bg-gray-400" />

      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center space-x-1.5 min-w-0">
          <span className="p-1 rounded-md bg-gray-100 text-gray-600 shrink-0">
            <Layers className="w-3.5 h-3.5" />
          </span>
          <div className="min-w-0">
            <h4 className="text-xs font-bold text-gray-900 truncate" title={data.name}>
              {data.name}
            </h4>
            <span className="text-[10px] text-gray-500 uppercase tracking-wider block font-mono">
              {data.type}
            </span>
          </div>
        </div>
        <Badge variant={cfg.variant} size="sm" className="shrink-0 flex items-center gap-1">
          {cfg.icon}
          <span>{data.status}</span>
        </Badge>
      </div>

      {/* Details */}
      <div className="space-y-1 text-[11px] text-gray-600 border-t border-gray-100 pt-2">
        <div className="flex justify-between items-center">
          <span className="text-gray-400 flex items-center gap-1">
            <Activity className="w-3 h-3" /> Duration
          </span>
          <span className="font-medium font-mono text-gray-700">{durationStr}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-gray-400 flex items-center gap-1">
            <RotateCw className="w-3 h-3" /> Attempt
          </span>
          <span className="font-medium font-mono text-gray-700">#{data.attempt || 1}</span>
        </div>
        {data.startedAt && (
          <div className="flex justify-between items-center">
            <span className="text-gray-400 flex items-center gap-1">
              <Calendar className="w-3 h-3" /> Started
            </span>
            <span className="font-mono text-[10px] text-gray-500">
              {new Date(data.startedAt).toLocaleTimeString()}
            </span>
          </div>
        )}
      </div>

      {/* Error preview if failed */}
      {data.error && (
        <div className="mt-2 text-[10px] bg-rose-50 text-rose-700 border border-rose-200 rounded p-1.5 truncate">
          {typeof data.error === 'string' ? data.error : JSON.stringify(data.error)}        </div>
      )}

      <Handle type="source" position={Position.Right} className="w-2 h-2 !bg-gray-400" />
    </div>
  );
};

const customNodeTypes = {
  executionNode: ExecutionNodeCard,
};

export function ExecutionTimeline({
  nodes: propNodes,
  selectedNodeId: propSelectedNodeId,
  onSelectNode,
  className = 'h-[450px]',
}: ExecutionTimelineProps) {
  const { selectedNode, setSelectedNode } = useExecutionStore();

  const activeSelectedId = propSelectedNodeId !== undefined ? propSelectedNodeId : selectedNode?.id;

  // Transform execution nodes to React Flow nodes and edges
  const { flowNodes, flowEdges } = React.useMemo(() => {
    const list = propNodes || [];
    if (list.length === 0) {
      return { flowNodes: [], flowEdges: [] };
    }

    const flowNodes: Node[] = list.map((node, index) => ({
      id: node.id,
      type: 'executionNode',
      position: { x: index * 320 + 40, y: 150 },
      data: {
        ...node,
        isSelected: node.id === activeSelectedId,
      },
    }));

    const flowEdges: Edge[] = [];
    for (let i = 0; i < list.length - 1; i++) {
      const source = list[i];
      const target = list[i + 1];
      const isRunning = source.status === 'RUNNING' || target.status === 'RUNNING';
      const isFailed = source.status === 'FAILED';

      flowEdges.push({
        id: `e-${source.id}-${target.id}`,
        source: source.id,
        target: target.id,
        type: 'smoothstep',
        animated: isRunning,
        style: {
          stroke: isFailed ? '#f43f5e' : isRunning ? '#3b82f6' : '#94a3b8',
          strokeWidth: 2,
        },
      });
    }

    return { flowNodes, flowEdges };
  }, [propNodes, activeSelectedId]);

  const handleNodeClick = (_: React.MouseEvent, node: Node) => {
    const clickedNodeData = node.data as unknown as ExecutionNode;
    setSelectedNode(clickedNodeData);
    if (onSelectNode) {
      onSelectNode(clickedNodeData);
    }
  };

  if (!propNodes || propNodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 bg-gray-50/50 rounded-xl border border-gray-200 text-center">
        <Layers className="w-10 h-10 text-gray-400 mb-2" />
        <h4 className="text-sm font-semibold text-gray-700">No Node Execution Data</h4>
        <p className="text-xs text-gray-500 mt-1 max-w-sm">
          Node-level timeline will populate once the workflow begins executing nodes.
        </p>
      </div>
    );
  }

  return (
    <div className={`relative w-full rounded-xl border border-gray-200 bg-slate-50/50 overflow-hidden shadow-inner ${className}`}>
      {/* Top Banner with Summary */}
      <div className="absolute top-3 left-3 z-10 bg-white/90 backdrop-blur-xs px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-600 shadow-xs flex items-center space-x-3">
        <span className="font-semibold text-gray-800 flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5 text-blue-600" />
          Execution Graph
        </span>
        <span className="text-gray-300">|</span>
        <span>{propNodes.length} Total Nodes</span>
        <span className="text-gray-300">|</span>
        <span className="text-emerald-600">
          {propNodes.filter((n) => n.status === 'SUCCEEDED').length} Succeeded
        </span>
        {propNodes.some((n) => n.status === 'FAILED') && (
          <>
            <span className="text-gray-300">|</span>
            <span className="text-rose-600 font-medium">
              {propNodes.filter((n) => n.status === 'FAILED').length} Failed
            </span>
          </>
        )}
      </div>

      <ReactFlowProvider>
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          onNodeClick={handleNodeClick}
          nodeTypes={customNodeTypes}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          minZoom={0.2}
          maxZoom={1.5}
          nodesDraggable={false}
          nodesConnectable={false}
          className="w-full h-full"
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#cbd5e1" />
          <Controls className="!bg-white !border-gray-200 !shadow-sm !rounded-lg" />
          <MiniMap
            className="!border !border-gray-200 !bg-white/90 !rounded-lg !shadow-xs"
            zoomable
            pannable
            nodeColor={(node) => {
              const status = (node.data as any)?.status;
              if (status === 'SUCCEEDED') return '#10b981';
              if (status === 'FAILED') return '#f43f5e';
              if (status === 'RUNNING') return '#3b82f6';
              return '#94a3b8';
            }}
          />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}

export default ExecutionTimeline;
