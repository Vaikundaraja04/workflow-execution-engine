'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';
import { Zap } from 'lucide-react';

interface ConfidenceBadgeProps {
  confidence: number;
  showBar?: boolean;
  className?: string;
}

export function ConfidenceBadge({ confidence, showBar = false, className }: ConfidenceBadgeProps) {
  const normalized = Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0;
  const percentage = Math.round(normalized * 100);

  const variant = percentage >= 80 ? 'success' : percentage >= 50 ? 'warning' : 'destructive';

  return (
    <div className={cn('flex items-center gap-2', className)} data-testid="confidence-badge">
      <Badge variant={variant} size="sm" className="gap-1 font-mono">
        <Zap className="h-3 w-3" />
        {percentage}% confidence
      </Badge>

      {showBar && (
        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-gray-200">
          <div
            className={cn(
              'h-1.5 rounded-full',
              percentage >= 80 ? 'bg-emerald-500' : percentage >= 50 ? 'bg-amber-500' : 'bg-rose-500'
            )}
            style={{ width: `${percentage}%` }}
          />
        </div>
      )}
    </div>
  );
}

export default ConfidenceBadge;