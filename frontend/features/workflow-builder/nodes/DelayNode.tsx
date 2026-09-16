import * as React from 'react';
import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import { Clock } from 'lucide-react';
import type { BuilderNodeData } from '../types/workflowBuilder';

export const DelayNode: React.FC<NodeProps> = ({ id, selected, data }) => {
  const nodeData = data as unknown as BuilderNodeData;
  const seconds = (nodeData.config?.durationSeconds as number) || 5;

  return (
    <BaseNode
      id={id}
      selected={selected}
      data={nodeData}
      icon={<Clock className="h-3.5 w-3.5" />}
      headerColor="bg-cyan-600"
      hasInput={true}
      hasOutput={true}
    >
      <div className="text-[11px] font-mono text-cyan-800 bg-cyan-50 px-2 py-1 rounded truncate">
        Wait: {seconds}s
      </div>
    </BaseNode>
  );
};

export default DelayNode;
