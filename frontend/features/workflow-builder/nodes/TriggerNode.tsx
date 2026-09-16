import * as React from 'react';
import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import { Play, Webhook, Clock } from 'lucide-react';
import type { BuilderNodeData } from '../types/workflowBuilder';

export const TriggerNode: React.FC<NodeProps> = ({ id, selected, data }) => {
  const nodeData = data as unknown as BuilderNodeData;
  const triggerType = nodeData.nodeType;

  let Icon = Play;
  let color = 'bg-blue-600';
  let subtitle = 'Starts the workflow';

  if (triggerType === 'webhook_trigger' || triggerType === 'webhook') {
    Icon = Webhook;
    color = 'bg-purple-600';
    subtitle = (nodeData.config?.path as string) || 'POST /webhook';
  } else if (triggerType === 'schedule_trigger') {
    Icon = Clock;
    color = 'bg-amber-600';
    subtitle = (nodeData.config?.cronExpression as string) || 'Scheduled trigger';
  }

  return (
    <BaseNode
      id={id}
      selected={selected}
      data={nodeData}
      icon={<Icon className="h-3.5 w-3.5" />}
      headerColor={color}
      hasInput={false}
      hasOutput={true}
    >
      <div className="text-[11px] font-mono text-gray-500 bg-gray-50 px-2 py-1 rounded truncate">
        {subtitle}
      </div>
    </BaseNode>
  );
};

export default TriggerNode;
