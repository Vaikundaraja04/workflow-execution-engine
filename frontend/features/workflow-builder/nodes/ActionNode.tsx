import * as React from 'react';
import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import { Globe, Mail, Database, Bell, FileText } from 'lucide-react';
import type { BuilderNodeData } from '../types/workflowBuilder';

export const ActionNode: React.FC<NodeProps> = ({ id, selected, data }) => {
  const nodeData = data as unknown as BuilderNodeData;
  const actionType = nodeData.nodeType;

  let Icon = Globe;
  let color = 'bg-emerald-600';
  let summary = 'Action Step';

  if (actionType === 'http_request') {
    Icon = Globe;
    color = 'bg-emerald-600';
    const method = (nodeData.config?.method as string) || 'GET';
    const url = (nodeData.config?.url as string) || '';
    summary = `${method} ${url || 'https://api.example.com'}`;
  } else if (actionType === 'email') {
    Icon = Mail;
    color = 'bg-sky-600';
    const to = (nodeData.config?.recipient as string) || '';
    summary = `To: ${to || 'user@example.com'}`;
  } else if (actionType === 'database_query') {
    Icon = Database;
    color = 'bg-indigo-600';
    summary = (nodeData.config?.query as string) || 'SQL / MongoDB Query';
  } else if (actionType === 'notification') {
    Icon = Bell;
    color = 'bg-amber-600';
    const ch = (nodeData.config?.channel as string) || 'in_app';
    summary = `Channel: ${ch}`;
  } else if (actionType === 'log') {
    Icon = FileText;
    color = 'bg-slate-600';
    summary = (nodeData.config?.message as string) || 'Log message';
  }

  return (
    <BaseNode
      id={id}
      selected={selected}
      data={nodeData}
      icon={<Icon className="h-3.5 w-3.5" />}
      headerColor={color}
      hasInput={true}
      hasOutput={true}
    >
      <div className="text-[11px] font-mono text-gray-500 bg-gray-50 px-2 py-1 rounded truncate">
        {summary}
      </div>
    </BaseNode>
  );
};

export default ActionNode;
