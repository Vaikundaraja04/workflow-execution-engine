'use client';

import * as React from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  BackgroundVariant,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';
import type { AIDraftWorkflow, GeneratedNodeCategory } from '../types/types';
import { layoutPreviewNodes, toPreviewEdges, toPreviewNodes } from './utils';

const CATEGORY_COLORS: Record<GeneratedNodeCategory, string> = {
  trigger: '#8b5cf6',
  action: '#3b82f6',
  logic: '#f59e0b',
  unknown: '#6b7280',
};

interface PreviewNodeData {
  label: string;
  category: GeneratedNodeCategory;
  nodeType: string;
  [key: string]: unknown;
}

function PreviewNode({ data }: { data: PreviewNodeData }) {
  const color = CATEGORY_COLORS[data.category] ?? CATEGORY_COLORS.unknown;

  return (
    <div
      data-testid={`ai-preview-node-${data.label}`}
      className="min-w-[160px] max-w-[200px] rounded-lg border bg-white px-3 py-2 shadow-sm"
      style={{ borderColor: color }}
    >
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-0 !bg-gray-400" />
      <p className="truncate text-[11px] font-semibold text-gray-800" title={data.label}>
        {data.label}
      </p>
      <p className="mt-0.5 truncate font-mono text-[10px] uppercase" style={{ color }}>
        {data.nodeType}
      </p>
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-0 !bg-gray-400" />
    </div>
  );
}

const previewNodeTypes = { previewNode: PreviewNode };
interface GeneratedWorkflowPreviewProps {
  workflow: AIDraftWorkflow;
  height?: number;
  showStats?: boolean;
  className?: string;
}

export function GeneratedWorkflowPreview({
  workflow,
  height = 320,
  showStats = true,
  className,
}: GeneratedWorkflowPreviewProps) {
  const previewNodes = React.useMemo(() => toPreviewNodes(workflow), [workflow]);
  const previewEdges = React.useMemo(() => toPreviewEdges(workflow), [workflow]);

  const { nodes, edges } = React.useMemo(() => {
    const positions = layoutPreviewNodes(previewNodes, previewEdges);

    const flowNodes: Node[] = previewNodes.map((node) => ({
      id: node.id,
      type: 'previewNode',
      position: positions[node.id] || { x: 0, y: 0 },
      data: {
        label: node.label,
        category: node.category,
        nodeType: node.type,
        config: node.config,
      },
      draggable: false,
      connectable: false,
      selectable: false,
    }));

    const flowEdges: Edge[] = previewEdges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.condition ? `${edge.condition}` : undefined,
      animated: false,
      style: { stroke: edge.condition ? '#f59e0b' : '#94a3b8', strokeWidth: 1.5 },
      labelStyle: { fontSize: 10, fontWeight: 600, fill: '#6b7280' },
    }));

    return { nodes: flowNodes, edges: flowEdges };
  }, [previewNodes, previewEdges]);

  return (
    <div className={cn('space-y-3', className)} data-testid="ai-generated-workflow-preview">
      {showStats && (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="info" size="sm">
            {previewNodes.length} nodes
          </Badge>
          <Badge variant="secondary" size="sm">
            {previewEdges.length} connections
          </Badge>
          <div className="ml-auto flex flex-wrap items-center gap-3 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            <LegendDot color={CATEGORY_COLORS.trigger} label="Trigger" />
            <LegendDot color={CATEGORY_COLORS.action} label="Action" />
            <LegendDot color={CATEGORY_COLORS.logic} label="Condition" />
          </div>
        </div>
      )}

      <div
        className="overflow-hidden rounded-xl border border-gray-200 bg-slate-50/60"
        style={{ height }}
        data-testid="ai-preview-canvas"
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={previewNodeTypes}
          fitView
          fitViewOptions={{ padding: 0.25 }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnScroll
          zoomOnScroll={false}
          proOptions={{ hideAttribution: true }}
          className="h-full w-full"
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#cbd5e1" />
          <Controls showInteractive={false} className="!rounded-lg !border-gray-200 !bg-white !shadow-sm" />
        </ReactFlow>
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

export default GeneratedWorkflowPreview;
