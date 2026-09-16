import * as React from 'react';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

export interface SpinnerProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export const Spinner: React.FC<SpinnerProps> = ({
  className,
  size = 'md',
  ...props
}) => {
  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-6 w-6',
    lg: 'h-8 w-8',
    xl: 'h-12 w-12',
  }[size];

  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn('inline-flex items-center justify-center text-primary', className)}
      {...props}
    >
      <Loader2 className={cn('animate-spin', sizeClasses)} />
      <span className="sr-only">Loading...</span>
    </div>
  );
};

export const Skeleton: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  ...props
}) => {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  );
};

export interface LoadingProps {
  message?: string;
  fullScreen?: boolean;
  className?: string;
}

export const Loading: React.FC<LoadingProps> = ({
  message = 'Loading...',
  fullScreen = false,
  className,
}) => {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center space-y-3 p-8 text-center',
        fullScreen && 'fixed inset-0 z-50 bg-background/80 backdrop-blur-sm',
        className
      )}
    >
      <Spinner size="lg" />
      {message && (
        <p className="text-sm font-medium text-muted-foreground">{message}</p>
      )}
    </div>
  );
};

export default Loading;
