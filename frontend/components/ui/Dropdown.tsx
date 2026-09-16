'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface DropdownProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
}

export interface DropdownItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: React.ReactNode;
  destructive?: boolean;
}

export const Dropdown: React.FC<DropdownProps> = ({
  trigger,
  children,
  align = 'right',
  className,
}) => {
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div className="relative inline-block text-left" ref={containerRef}>
      <div onClick={() => setOpen((prev) => !prev)} className="cursor-pointer">
        {trigger}
      </div>

      {open && (
        <div
          role="menu"
          aria-orientation="vertical"
          onClick={() => setOpen(false)}
          className={cn(
            'absolute z-50 mt-2 min-w-[12rem] rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg animate-in fade-in zoom-in-95 focus:outline-none',
            align === 'right' ? 'right-0' : 'left-0',
            className
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
};

export const DropdownItem: React.FC<DropdownItemProps> = ({
  className,
  icon,
  destructive = false,
  children,
  ...props
}) => {
  return (
    <button
      role="menuitem"
      type="button"
      className={cn(
        'relative flex w-full cursor-pointer select-none items-center rounded-md px-2.5 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 text-left',
        destructive && 'text-destructive hover:bg-destructive/10 hover:text-destructive',
        className
      )}
      {...props}
    >
      {icon && <span className="mr-2 h-4 w-4">{icon}</span>}
      {children}
    </button>
  );
};

export const DropdownSeparator: React.FC<{ className?: string }> = ({ className }) => (
  <div className={cn('-mx-1 my-1 h-px bg-border', className)} />
);

export const DropdownLabel: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className,
}) => (
  <div className={cn('px-2.5 py-1.5 text-xs font-semibold text-muted-foreground', className)}>
    {children}
  </div>
);

export default Dropdown;
