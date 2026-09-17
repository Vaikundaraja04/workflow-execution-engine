'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

interface UsageCardProps {
  label: string;
  value: string | number;
  hint?: string;
  icon?: React.ReactNode;
  accent?: 'indigo' | 'emerald' | 'amber' | 'gray';
  className?: string;
}

const ACCENTS: Record<NonNullable<UsageCardProps['accent']>, string> = {
  indigo: 'bg-indigo-50 text-indigo-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  amber: 'bg-amber-50 text-amber-600',
  gray: 'bg-gray-100 text-gray-600',
};

export function UsageCard({ label, value, hint, icon, accent = 'indigo', className }: UsageCardProps) {
  return (
    <div
      data-testid="ai-usage-card"
      className={cn('rounded-xl border border-gray-200 bg-white p-4 shadow-2xs', className)}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
        {icon && (
          <div className={cn('flex h-7 w-7 items-center justify-center rounded-lg', ACCENTS[accent])}>{icon}</div>
        )}
      </div>
      <p className="mt-2 text-xl font-bold text-gray-900">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-gray-500">{hint}</p>}
    </div>
  );
}

export default UsageCard;