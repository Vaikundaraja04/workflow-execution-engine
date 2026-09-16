import * as React from 'react';
import { Handle, Position } from '@xyflow/react';
import { cn } from '@/lib/utils';
import { Trash2, Copy, AlertCircle } from 'lucide-react';
import { useWorkflowBuilderStore } from '../stores/workflowBuilderStore';
import type { BuilderNodeData } from '../types/workflowBuilder';

interface BaseNodeProps {
  id: string;
  selected?: boolean;
  data: BuilderNodeData;
  icon?: React.ReactNode;
  headerColor?: string;
  hasInput?: boolean;
  hasOutput?: boolean;
  inputPosition?: Position;
  outputPosition?: Position;
  children?: React.ReactNode;
  customHandles?: React.ReactNode;
}

export const BaseNode: React.FC<BaseNodeProps> = ({
  id,
  selected = false,
  data,
  icon,
  headerColor = 'bg-blue-600',
  hasInput = true,
  hasOutput = true,
  inputPosition = Position.Top,
  outputPosition = Position.Bottom,
  children,
  customHandles,
}) => {
  const { deleteNode, duplicateNode, isReadOnly } = useWorkflowBuilderStore();

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isReadOnly) {
      deleteNode(id);
    }
  };

  const handleDuplicate = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isReadOnly) {
      duplicateNode(id);
    }
  };

  const hasError = !!data.validationError;

  return (
    <div
      data-testid={`workflow-node-${id}`}
      data-node-id={id}
      className={cn(
        'relative min-w-[220px] max-w-[280px] rounded-lg border bg-white shadow-sm transition-all duration-150',
        selected ? 'ring-2 ring-primary ring-offset-2 shadow-md border-primary' : 'border-gray-200 hover:border-gray-300',
        hasError && 'border-destructive ring-1 ring-destructive'
      )}
    >
      {/* Input Handle */}
      {hasInput && !customHandles && (
        <Handle
          type="target"
          position={inputPosition}
          className="!h-3 !w-3 !rounded-full !border-2 !border-white !bg-gray-500 hover:!bg-primary transition-colors"
        />
      )}

      {/* Node Header */}
      <div className="flex items-center justify-between border-b px-3 py-2 bg-gray-50 rounded-t-lg">
        <div className="flex items-center space-x-2 truncate">
          {icon && (
            <div className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded text-white text-xs', headerColor)}>
              {icon}
            </div>
          )}
          <span className="truncate text-xs font-semibold text-gray-800" title={data.label}>
            {data.label || id}
          </span>
        </div>

        {/* Quick Actions (only visible when not read-only) */}
        {!isReadOnly && (
          <div className="flex items-center space-x-1 opacity-60 hover:opacity-100 transition-opacity">
            <button
              onClick={handleDuplicate}
              className="p-1 hover:bg-gray-200 rounded text-gray-600 hover:text-gray-900"
              title="Duplicate Node"
              type="button"
            >
              <Copy className="h-3 w-3" />
            </button>
            <button
              onClick={handleDelete}
              className="p-1 hover:bg-destructive/10 rounded text-gray-600 hover:text-destructive"
              title="Delete Node"
              type="button"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      {/* Node Body */}
      <div className="p-3 text-xs text-gray-600 space-y-1">
        {data.description && (
          <p className="text-[11px] text-gray-500 line-clamp-2">{data.description}</p>
        )}
        {children}
        {hasError && (
          <div className="flex items-center space-x-1 text-destructive font-medium text-[11px] pt-1">
            <AlertCircle className="h-3 w-3 shrink-0" />
            <span className="truncate">{data.validationError}</span>
          </div>
        )}
      </div>

      {/* Custom handles (e.g. for Condition node true/false) or default Output Handle */}
      {customHandles ? (
        customHandles
      ) : (
        hasOutput && (
          <Handle
            type="source"
            position={outputPosition}
            className="!h-3 !w-3 !rounded-full !border-2 !border-white !bg-gray-500 hover:!bg-primary transition-colors"
          />
        )
      )}
    </div>
  );
};

export default BaseNode;
