import * as React from 'react';
import type { NodeProps } from '@xyflow/react';
import { Handle, Position } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import { GitBranch, Check, X } from 'lucide-react';
import type { BuilderNodeData } from '../types/workflowBuilder';

export const ConditionNode: React.FC<NodeProps> = ({ id, selected, data }) => {
  const nodeData = data as unknown as BuilderNodeData;
  const config = (nodeData.config || {}) as { field?: string; operator?: string; value?: unknown };

  const field = config.field || 'input.status';
  const op = config.operator || 'equals';
  const val = config.value !== undefined ? String(config.value) : 'success';

  return (
    <BaseNode
      id={id}
      selected={selected}
      data={nodeData}
      icon={<GitBranch className="h-3.5 w-3.5" />}
      headerColor="bg-amber-600"
      hasInput={true}
      hasOutput={false}
      customHandles={
        <div className="flex justify-between px-4 pb-1 pt-2 border-t mt-2 bg-gray-50/50 rounded-b-lg text-[10px] font-medium">
          {/* True Handle */}
          <div className="relative flex items-center space-x-1 text-emerald-600 font-semibold">
            <Check className="h-3 w-3" />
            <span>True</span>
            <Handle
              type="source"
              position={Position.Bottom}
              id="true"
              className="!h-3 !w-3 !rounded-full !border-2 !border-white !bg-emerald-500 hover:!bg-emerald-600 transition-colors !-bottom-1.5"
            />
          </div>

          {/* False Handle */}
          <div className="relative flex items-center space-x-1 text-rose-600 font-semibold">
            <span>False</span>
            <X className="h-3 w-3" />
            <Handle
              type="source"
              position={Position.Bottom}
              id="false"
              className="!h-3 !w-3 !rounded-full !border-2 !border-white !bg-rose-500 hover:!bg-rose-600 transition-colors !-bottom-1.5"
            />
          </div>
        </div>
      }
    >
      <div className="text-[11px] font-mono text-gray-600 bg-amber-50/60 border border-amber-100 px-2 py-1 rounded truncate">
        {field} {op} {val}
      </div>
    </BaseNode>
  );
};

export default ConditionNode;
