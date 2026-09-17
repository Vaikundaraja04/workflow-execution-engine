'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';
import { TrendingUp, Lightbulb } from 'lucide-react';

type Severity = 'low' | 'medium' | 'high';

interface RecommendationCardProps {
  title: string;
  description: string;
  impact?: string;
  action?: string;
  severity?: Severity;
  issueType?: string;
  affectedNodeId?: string;
  children?: React.ReactNode;
  className?: string;
}

const SEVERITY_VARIANT: Record<Severity, 'destructive' | 'warning' | 'info'> = {
  high: 'destructive',
  medium: 'warning',
  low: 'info',
};

export function RecommendationCard({
  title,
  description,
  impact,
  action,
  severity,
  issueType,
  affectedNodeId,
  children,
  className,
}: RecommendationCardProps) {
  return (
    <div
      data-testid="ai-recommendation-card"
      className={cn('rounded-xl border border-gray-200 bg-white p-4 shadow-2xs', className)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
            <Lightbulb className="h-3.5 w-3.5" />
          </div>
          <div className="space-y-1">
            <h4 className="text-xs font-bold text-gray-900">{title}</h4>
            <p className="text-xs leading-relaxed text-gray-600">{description}</p>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {severity && (
            <Badge variant={SEVERITY_VARIANT[severity]} size="sm" className="uppercase">
              {severity}
            </Badge>
          )}
          {issueType && (
            <span className="font-mono text-[10px] uppercase text-gray-400">{issueType}</span>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
        {impact && (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">
            <TrendingUp className="h-3 w-3" />
            {impact}
          </span>
        )}
        {affectedNodeId && (
          <span className="rounded-md bg-gray-100 px-2 py-1 font-mono text-[10px] text-gray-600">
            node: {affectedNodeId}
          </span>
        )}
        {action && (
          <span className="rounded-md border border-gray-200 px-2 py-1 font-mono text-[10px] text-gray-500">
            {action}
          </span>
        )}
      </div>

      {children && <div className="mt-3 flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export default RecommendationCard;
