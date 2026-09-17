'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { AlertTriangle, Lock, RotateCcw } from 'lucide-react';

interface AIErrorStateProps {
  message: string;
  title?: string;
  onRetry?: () => void;
  retryLabel?: string;
  variant?: 'error' | 'permission';
  hint?: React.ReactNode;
  className?: string;
}

export function AIErrorState({
  message,
  title,
  onRetry,
  retryLabel = 'Try again',
  variant = 'error',
  hint,
  className,
}: AIErrorStateProps) {
  const isPermission = variant === 'permission';

  return (
    <div
      role="alert"
      data-testid="ai-error-state"
      className={cn(
        'rounded-xl border p-4 text-xs',
        isPermission
          ? 'border-amber-200 bg-amber-50 text-amber-800'
          : 'border-rose-200 bg-rose-50 text-rose-800',
        className
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
            isPermission ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'
          )}
        >
          {isPermission ? <Lock className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
        </div>

        <div className="flex-1 space-y-1">
          <p className="text-xs font-semibold">
            {title ?? (isPermission ? 'AI access restricted' : 'AI request failed')}
          </p>
          <p className="leading-relaxed">{message}</p>
          {hint && <div className="pt-1 text-[11px] opacity-80">{hint}</div>}

          {onRetry && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRetry}
              className="mt-2 h-7 border-current bg-white/60 text-[11px]"
            >
              <RotateCcw className="mr-1.5 h-3 w-3" />
              {retryLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default AIErrorState;