'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Sparkles, Lock } from 'lucide-react';

const MAX_PROMPT_LENGTH = 4000;

interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (prompt: string) => void;
  isLoading?: boolean;
  disabled?: boolean;
  submitLabel?: string;
  placeholder?: string;
  helperText?: string;
  className?: string;
}

export function PromptInput({
  value,
  onChange,
  onSubmit,
  isLoading = false,
  disabled = false,
  submitLabel = 'Generate',
  placeholder = 'Describe the workflow you want to build...',
  helperText,
  className,
}: PromptInputProps) {
  const isBlocked = disabled || isLoading;
  const canSubmit = !isBlocked && value.trim().length > 0;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit(value.trim());
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (canSubmit) onSubmit(value.trim());
    }
  };
  return (
    <form onSubmit={handleSubmit} className={cn('space-y-2', className)}>
      <div className="relative">
        <textarea
          data-testid="ai-prompt-input"
          aria-label="AI prompt"
          value={value}
          onChange={(event) => onChange(event.target.value.slice(0, MAX_PROMPT_LENGTH))}
          onKeyDown={handleKeyDown}
          disabled={isBlocked}
          rows={3}
          placeholder={placeholder}
          className={cn(
            'w-full resize-none rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-xs text-gray-800 shadow-2xs transition-colors',
            'placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1',
            isBlocked && 'cursor-not-allowed bg-gray-50 opacity-70'
          )}
        />
        <span className="pointer-events-none absolute bottom-2 right-3 text-[10px] font-mono text-gray-400">
          {value.length}/{MAX_PROMPT_LENGTH}
        </span>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-gray-500">
          {disabled ? (
            <span className="inline-flex items-center gap-1 text-amber-600">
              <Lock className="h-3 w-3" />
              AI_WORKFLOW_CREATE permission required
            </span>
          ) : (
            helperText ?? 'Enter to generate - Shift+Enter for a new line'
          )}
        </p>

        <Button
          type="submit"
          size="sm"
          disabled={!canSubmit}
          isLoading={isLoading}
          className="bg-indigo-600 text-white hover:bg-indigo-700"
        >
          {!isLoading && <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

export default PromptInput;
