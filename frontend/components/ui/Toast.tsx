'use client';

import * as React from 'react';
import { useUiStore, type ToastItem } from '@/stores/uiStore';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Toast: React.FC<{ toast: ToastItem; onDismiss: (id: string) => void }> = ({
  toast,
  onDismiss,
}) => {
  const iconMap = {
    success: <CheckCircle2 className="h-5 w-5 text-emerald-500" />,
    error: <AlertCircle className="h-5 w-5 text-destructive" />,
    warning: <AlertTriangle className="h-5 w-5 text-amber-500" />,
    info: <Info className="h-5 w-5 text-sky-500" />,
  };

  const borderMap = {
    success: 'border-emerald-500/30 bg-card',
    error: 'border-destructive/30 bg-card',
    warning: 'border-amber-500/30 bg-card',
    info: 'border-sky-500/30 bg-card',
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'pointer-events-auto flex w-full max-w-md items-start space-x-3 rounded-xl border p-4 shadow-xl transition-all animate-in fade-in slide-in-from-top-2 sm:slide-in-from-bottom-2',
        borderMap[toast.type]
      )}
    >
      <div className="flex-shrink-0 mt-0.5">{iconMap[toast.type]}</div>
      <div className="flex-1 space-y-0.5">
        {toast.title && (
          <h4 className="text-sm font-semibold text-foreground">{toast.title}</h4>
        )}
        <p className="text-xs text-muted-foreground leading-relaxed">
          {toast.message}
        </p>
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        className="flex-shrink-0 rounded-md p-1 text-muted-foreground opacity-70 hover:opacity-100 hover:bg-muted transition-colors"
        aria-label="Close notification"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
};

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useUiStore();

  if (toasts.length === 0) return null;

  return (
    <div
      aria-label="Notifications"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center space-y-2 p-4 sm:right-0 sm:top-0 sm:bottom-auto sm:left-auto sm:items-end sm:p-6"
    >
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={removeToast} />
      ))}
    </div>
  );
};

export default ToastContainer;
