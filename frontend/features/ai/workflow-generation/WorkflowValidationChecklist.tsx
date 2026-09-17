'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import type { AIDraftWorkflow, AIValidationResult } from '../types/types';
import { getNodeCategory } from './utils';
import { CheckCircle2, AlertCircle, Lock } from 'lucide-react';

interface WorkflowValidationChecklistProps {
  workflow: AIDraftWorkflow;
  validation: AIValidationResult | null;
  canCreate: boolean;
  className?: string;
}

interface CheckResult {
  label: string;
  passed: boolean;
  details: string[];
}

const GRAPH_ERROR_TYPES = [
  'DUPLICATE_NODE',
  'MISSING_SOURCE',
  'MISSING_TARGET',
  'SELF_CONNECTION',
  'DUPLICATE_EDGE',
  'INVALID_EDGE_CONDITION',
  'UNREACHABLE',
];

export function WorkflowValidationChecklist({
  workflow,
  validation,
  canCreate,
  className,
}: WorkflowValidationChecklistProps) {
  const errors = validation?.errors ?? [];
  const hasTrigger = (workflow.nodes ?? []).some((node) => getNodeCategory(node.type) === 'trigger');
  const checks: CheckResult[] = [
    {
      label: 'Valid graph',
      passed: !errors.some((error) => GRAPH_ERROR_TYPES.includes(error.type)),
      details: errors.filter((error) => GRAPH_ERROR_TYPES.includes(error.type)).map((error) => error.message),
    },
    {
      label: 'Trigger exists',
      passed: hasTrigger,
      details: hasTrigger ? [] : ['Workflow requires at least one trigger node (e.g. webhook trigger)'],
    },
    {
      label: 'No cycles',
      passed: !errors.some((error) => error.type === 'CYCLE' || error.type === 'CYCLE_DETECTED'),
      details: errors
        .filter((error) => error.type === 'CYCLE' || error.type === 'CYCLE_DETECTED')
        .map((error) => error.message),
    },
    {
      label: 'Required fields',
      passed: !errors.some((error) => error.type === 'INVALID_WORKFLOW_SCHEMA'),
      details: errors.filter((error) => error.type === 'INVALID_WORKFLOW_SCHEMA').map((error) => error.message),
    },
    {
      label: 'Trigger count',
      passed: !errors.some((error) => error.type === 'WEBHOOK_COUNT'),
      details: errors.filter((error) => error.type === 'WEBHOOK_COUNT').map((error) => error.message),
    },
    {
      label: 'Permissions',
      passed: canCreate,
      details: canCreate ? [] : ['AI_WORKFLOW_CREATE is required to create this draft'],
    },
  ];

  const remainingErrors = errors.filter(
    (error) =>
      !GRAPH_ERROR_TYPES.includes(error.type) &&
      error.type !== 'CYCLE' &&
      error.type !== 'CYCLE_DETECTED' &&
      error.type !== 'INVALID_WORKFLOW_SCHEMA' &&
      error.type !== 'WEBHOOK_COUNT'
  );

  const allPassed = checks.every((check) => check.passed) && remainingErrors.length === 0;

  return (
    <div
      data-testid="ai-validation-checklist"
      className={cn(
        'rounded-xl border p-4 shadow-2xs',
        allPassed ? 'border-emerald-200 bg-emerald-50/60' : 'border-rose-200 bg-rose-50/60',
        className
      )}
    >
      <div className="flex items-center justify-between">
        <p className={cn('text-xs font-bold', allPassed ? 'text-emerald-800' : 'text-rose-800')}>
          {allPassed ? 'Workflow ready' : 'Validation failed'}
        </p>
        <span className="text-[11px] font-medium text-gray-500">
          {checks.filter((check) => check.passed).length}/{checks.length} checks passed
        </span>
      </div>

      <ul className="mt-3 space-y-2">
        {checks.map((check) => (
          <li key={check.label} className="space-y-1">
            <div className="flex items-center gap-2 text-[11px]">
              {check.passed ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
              ) : (
                <AlertCircle className="h-3.5 w-3.5 shrink-0 text-rose-600" />
              )}
              <span className={cn('font-medium', check.passed ? 'text-gray-600' : 'text-rose-800')}>
                {check.label}
              </span>
            </div>

            {check.details.map((detail) => (
              <p key={detail} className="ml-5 font-mono text-[10px] leading-relaxed text-rose-700">
                {detail}
              </p>
            ))}
          </li>
        ))}
      </ul>

      {remainingErrors.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-rose-200/70 pt-2">
          {remainingErrors.map((error, index) => (
            <p key={`${error.type}_${index}`} className="font-mono text-[10px] text-rose-700">
              {error.message}
            </p>
          ))}
        </div>
      )}

      {!canCreate && (
        <p className="mt-3 flex items-center gap-1.5 border-t border-rose-200/70 pt-2 text-[11px] font-medium text-rose-800">
          <Lock className="h-3 w-3" />
          Draft creation is restricted for your role.
        </p>
      )}
    </div>
  );
}

export default WorkflowValidationChecklist;
