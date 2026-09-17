'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Sparkles, CheckCircle2 } from 'lucide-react';

interface GenerationLoaderProps {
  label?: string;
  steps?: string[];
  activeStep?: number;
  className?: string;
}

const DEFAULT_STEPS = [
  'Interpreting prompt',
  'Generating workflow graph',
  'Validating nodes and connections',
  'Preparing DRAFT payload',
];

export function GenerationLoader({ label, steps = DEFAULT_STEPS, activeStep, className }: GenerationLoaderProps) {
  return (
    <div
      data-testid="ai-generation-loader"
      className={cn(
        'rounded-xl border border-indigo-200/80 bg-gradient-to-br from-indigo-50/60 via-white to-purple-50/60 p-5 shadow-sm',
        className
      )}
    >
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
          <Sparkles className="h-4 w-4 animate-spin" />
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-900">{label ?? 'AI is generating your workflow...'}</p>
          <p className="text-[11px] text-gray-500">This usually completes in a few seconds.</p>
        </div>
      </div>

      <ul className="mt-4 space-y-2">
        {steps.map((step, index) => {
          const isDone = activeStep !== undefined ? index < activeStep : false;
          const isActive = activeStep !== undefined ? index === activeStep : index === 1;

          return (
            <li key={step} className="flex items-center gap-2 text-[11px]">
              {isDone ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
              ) : (
                <span
                  className={cn(
                    'h-2 w-2 shrink-0 rounded-full',
                    isActive ? 'animate-pulse bg-indigo-600' : 'bg-gray-300'
                  )}
                />
              )}
              <span className={cn(isDone ? 'text-gray-400' : isActive ? 'font-medium text-gray-800' : 'text-gray-500')}>
                {step}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default GenerationLoader;