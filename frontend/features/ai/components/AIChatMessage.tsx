'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import type { AIChatMessage as AIChatMessageModel } from '../types/types';
import { Sparkles, AlertTriangle, User } from 'lucide-react';

interface AIChatMessageProps {
  message: AIChatMessageModel;
  children?: React.ReactNode;
  className?: string;
}

export function AIChatMessage({ message, children, className }: AIChatMessageProps) {
  const isUser = message.role === 'user';

  return (
    <div
      data-testid={`ai-chat-message-${message.role}`}
      className={cn('flex w-full gap-2.5', isUser ? 'justify-end' : 'justify-start', className)}
    >
      {!isUser && (
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-600 to-purple-600 text-white shadow-xs">
          <Sparkles className="h-3.5 w-3.5" />
        </div>
      )}
      <div className={cn('max-w-[85%] space-y-2', isUser && 'flex flex-col items-end')}>
        <div
          className={cn(
            'rounded-xl border px-3.5 py-2.5 text-xs leading-relaxed shadow-2xs',
            isUser
              ? 'border-indigo-200 bg-indigo-600 text-white'
              : message.error
                ? 'border-rose-200 bg-rose-50 text-rose-800'
                : 'border-gray-200 bg-white text-gray-700'
          )}
        >
          {message.error && (
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-rose-700">
              <AlertTriangle className="h-3.5 w-3.5" />
              Generation failed
            </div>
          )}
          <p className="whitespace-pre-wrap">{message.content}</p>

          {typeof message.nodeCount === 'number' && (
            <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              <span>{message.nodeCount} nodes</span>
              <span className="text-gray-300">|</span>
              <span>{message.connectionCount ?? 0} connections</span>
              {message.isValid !== undefined && (
                <>
                  <span className="text-gray-300">|</span>
                  <span className={message.isValid ? 'text-emerald-600' : 'text-rose-600'}>
                    {message.isValid ? 'Validated' : 'Validation issues'}
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        {children}
      </div>

      {isUser && (
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gray-800 text-white">
          <User className="h-3.5 w-3.5" />
        </div>
      )}
    </div>
  );
}

export default AIChatMessage;
