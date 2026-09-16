import * as React from 'react';
import { cn } from '@/lib/utils';
import { AlertCircle, RotateCcw } from 'lucide-react';
import { Button } from './Button';

export interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retryText?: string;
  className?: string;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  title = 'Something went wrong',
  message = 'An unexpected error occurred while loading this data. Please try again.',
  onRetry,
  retryText = 'Try again',
  className,
}) => {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border border-destructive/20 bg-destructive/5 p-8 text-center sm:p-12',
        className
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive mb-4">
        <AlertCircle className="h-6 w-6" />
      </div>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {message && (
        <p className="mt-1.5 max-w-sm text-sm text-muted-foreground leading-relaxed">
          {message}
        </p>
      )}
      {onRetry && (
        <div className="mt-6">
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RotateCcw className="mr-2 h-4 w-4" />
            {retryText}
          </Button>
        </div>
      )}
    </div>
  );
};

export default ErrorState;
