'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import type { AIDraftWorkflow, AIValidationResult } from '../types/types';
import { deriveWorkflowCategory } from '../workflow-generation/utils';
import { Boxes, GitBranch, Layers, ShieldCheck, ShieldAlert, FileText } from 'lucide-react';

interface WorkflowPreviewCardProps {
  workflow: AIDraftWorkflow;
  validation?: AIValidationResult | null;
  suggestedTemplateName?: string | null;
  children?: React.ReactNode;
  className?: string;
}

export function WorkflowPreviewCard({
  workflow,
  validation,
  suggestedTemplateName,
  children,
  className,
}: WorkflowPreviewCardProps) {
  const nodeCount = workflow.nodes?.length ?? 0;
  const connectionCount = workflow.connections?.length ?? workflow.definition?.edges?.length ?? 0;
  const variableCount = Object.keys(workflow.variables || {}).length;
  const isValid = validation?.isValid ?? false;
  const errorCount = validation?.errors?.length ?? 0;
  return (
    <Card className={cn('border-gray-200 p-5 shadow-2xs', className)} data-testid="workflow-preview-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 pb-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold text-gray-900">{workflow.workflowName}</h3>
            <Badge variant="secondary" size="sm" className="border-amber-200 bg-amber-100 text-amber-800">
              DRAFT
            </Badge>
            {isValid ? (
              <Badge variant="success" size="sm" className="gap-1">
                <ShieldCheck className="h-3 w-3" />
                Workflow ready
              </Badge>
            ) : (
              <Badge variant="destructive" size="sm" className="gap-1">
                <ShieldAlert className="h-3 w-3" />
                {errorCount} validation issue{errorCount === 1 ? '' : 's'}
              </Badge>
            )}
          </div>
          <p className="text-xs text-gray-500">{workflow.description}</p>
        </div>

        {suggestedTemplateName && (
          <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
            <FileText className="h-3.5 w-3.5 text-gray-400" />
            <span>
              Suggested template: <strong className="font-semibold text-gray-700">{suggestedTemplateName}</strong>
            </span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 py-3 sm:grid-cols-4">
        <Stat icon={<Boxes className="h-3.5 w-3.5 text-indigo-500" />} label="Nodes" value={nodeCount} />
        <Stat icon={<GitBranch className="h-3.5 w-3.5 text-blue-500" />} label="Connections" value={connectionCount} />
        <Stat icon={<Layers className="h-3.5 w-3.5 text-purple-500" />} label="Category" value={deriveWorkflowCategory(workflow.nodes || [])} />
        <Stat icon={<FileText className="h-3.5 w-3.5 text-gray-500" />} label="Variables" value={variableCount} />
      </div>

      <p className="border-t border-gray-100 pt-3 text-[11px] text-gray-500">
        Generated workflows stay in <strong className="font-semibold text-gray-700">DRAFT</strong> and must be published
        explicitly from the workflow builder.
      </p>

      {children && <div className="mt-4 flex flex-wrap items-center gap-2">{children}</div>}
    </Card>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
        {icon}
        {label}
      </div>
      <p className="mt-1 truncate text-xs font-bold text-gray-800">{value}</p>
    </div>
  );
}

export default WorkflowPreviewCard;
