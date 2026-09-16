import * as React from 'react';
import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import { Webhook } from 'lucide-react';
import type { BuilderNodeData } from '../types/workflowBuilder';

export const WebhookNode: React.FC<NodeProps> = ({ id, selected, data }) => {
  const nodeData = data as unknown as BuilderNodeData;
  const path = (nodeData.config?.path as string) || '/webhook';
  const method = (nodeData.config?.method as string) || 'POST';

  return (
    <BaseNode
      id={id}
      selected={selected}
      data={nodeData}
      icon={<Webhook className="h-3.5 w-3.5" />}
      headerColor="bg-purple-600"
      hasInput={false}
      hasOutput={true}
    >
      <div className="text-[11px] font-mono text-purple-800 bg-purple-50 px-2 py-1 rounded truncate">
        {method} {path}
      </div>
    </BaseNode>
  );
};

export default WebhookNode;
