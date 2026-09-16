import * as React from 'react';
import { cn } from '@/lib/utils';

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'info';
  size?: 'default' | 'sm' | 'lg';
}

function Badge({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: BadgeProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center rounded-full font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
        {
          default: 'border-transparent bg-primary text-primary-foreground hover:bg-primary/80',
          secondary: 'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
          destructive: 'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80',
          outline: 'text-foreground border border-border',
          success: 'border-transparent bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20',
          warning: 'border-transparent bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20',
          info: 'border-transparent bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/20',
        }[variant],
        {
          default: 'px-2.5 py-0.5 text-xs',
          sm: 'px-2 py-0.2 text-[10px]',
          lg: 'px-3 py-1 text-sm',
        }[size],
        className
      )}
      {...props}
    />
  );
}

export { Badge };
export default Badge;
