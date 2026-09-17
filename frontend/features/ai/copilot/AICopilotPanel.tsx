'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { useAIStore } from '../stores/aiStore';
import { useAIWorkflowGeneration } from '../hooks/useAIWorkflowGeneration';
import { AIChatMessage } from '../components/AIChatMessage';
import { PromptInput } from '../components/PromptInput';
import { GenerationLoader } from '../components/GenerationLoader';
import { WorkflowPreviewCard } from '../components/WorkflowPreviewCard';
import { AIErrorState } from '../components/AIErrorState';
import { GeneratedWorkflowPreview } from '../workflow-generation/GeneratedWorkflowPreview';
import {
  Sparkles,
  X,
  Trash2,
  CheckCircle2,
  Hammer,
  RefreshCw,
  ArrowUpRight,
} from 'lucide-react';

export function AICopilotLauncher({ className }: { className?: string }) {
  const isOpen = useAIStore((state) => state.isCopilotOpen);
  const toggleCopilot = useAIStore((state) => state.toggleCopilot);

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={toggleCopilot}
      aria-expanded={isOpen}
      className={cn(
        'h-8 gap-1.5 border-indigo-200 bg-white text-xs text-indigo-700 hover:bg-indigo-50',
        className
      )}
    >
      <Sparkles className="h-3.5 w-3.5" />
      AI Copilot
    </Button>
  );
}

export function AICopilotPanel({ className }: { className?: string }) {
  const router = useRouter();
  const isOpen = useAIStore((state) => state.isCopilotOpen);
  const setCopilotOpen = useAIStore((state) => state.setCopilotOpen);
  const clearMessages = useAIStore((state) => state.clearMessages);

  const {
    messages,
    currentPrompt,
    setCurrentPrompt,
    generationState,
    generatedWorkflow,
    validation,
    generationError,
    canGenerateWorkflow,
    generate,
    createDraft,
    loadIntoBuilder,
    discard,
  } = useAIWorkflowGeneration();

  const [creating, setCreating] = React.useState(false);
  const [createdId, setCreatedId] = React.useState<string | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const isGenerating = generationState === 'GENERATING';
  const isValid = validation?.isValid ?? false;

  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isGenerating, generatedWorkflow]);

  if (!isOpen) return null;

  const handleCreateDraft = async () => {
    setCreating(true);
    const workflowId = await createDraft();
    setCreating(false);
    if (workflowId) setCreatedId(workflowId);
  };

  const handleOpenBuilder = () => {
    if (loadIntoBuilder()) {
      router.push('/workflows/new');
    }
  };

  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;

  return (
    <aside
      data-testid="ai-copilot-panel"
      aria-label="AI Copilot"
      className={cn(
        'fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-gray-200 bg-gray-50 shadow-2xl',
        className
      )}
    >
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-600 to-purple-600 text-white">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-gray-900">AI Copilot</h2>
            <p className="text-[11px] text-gray-500">Generate and refine workflows from a prompt</p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={clearMessages}
            title="Clear conversation"
            className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setCopilotOpen(false)}
            aria-label="Close AI Copilot"
            className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && !isGenerating && (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-4 text-center">
            <p className="text-xs font-semibold text-gray-700">Start with a prompt</p>
            <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
              Try: &ldquo;Create an approval workflow for invoices&rdquo;
            </p>
          </div>
        )}

        {messages.map((message) => {
          const isLatestAssistant =
            generatedWorkflow &&
            message.id === lastMessage?.id &&
            message.role === 'assistant' &&
            !message.error;

          return (
            <AIChatMessage key={message.id} message={message}>
              {isLatestAssistant && (
                <div className="w-full space-y-3">
                  <WorkflowPreviewCard workflow={generatedWorkflow} validation={validation} />

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      onClick={handleCreateDraft}
                      disabled={!isValid || creating || !!createdId}
                      isLoading={creating}
                      className="bg-indigo-600 text-white hover:bg-indigo-700"
                    >
                      <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                      Create Draft
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleOpenBuilder}>
                      <Hammer className="mr-1.5 h-3.5 w-3.5" />
                      Open Builder
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => generate(currentPrompt)}>
                      <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                      Regenerate
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        discard();
                        setCreatedId(null);
                      }}
                      className="text-rose-600 hover:text-rose-700"
                    >
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                      Discard
                    </Button>
                  </div>

                  {createdId && (
                    <button
                      type="button"
                      onClick={() => router.push(`/workflows/${createdId}/edit`)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100"
                    >
                      Draft created - open in builder
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </button>
                  )}

                  <GeneratedWorkflowPreview workflow={generatedWorkflow} height={220} />
                </div>
              )}
            </AIChatMessage>
          );
        })}

        {isGenerating && <GenerationLoader label="Generating workflow..." />}

        {generationState === 'FAILED' && generationError && (
          <AIErrorState message={generationError} onRetry={() => generate(currentPrompt)} retryLabel="Retry" />
        )}
      </div>

      <footer className="border-t border-gray-200 bg-white p-4">
        {canGenerateWorkflow ? (
          <PromptInput
            value={currentPrompt}
            onChange={setCurrentPrompt}
            onSubmit={(prompt) => generate(prompt)}
            isLoading={isGenerating}
            placeholder="Create an approval workflow for invoices"
            submitLabel="Send"
          />
        ) : (
          <AIErrorState
            variant="permission"
            title="AI generation restricted"
            message="Your role can read AI results but cannot generate workflows."
            hint={
              <span>
                Requires{' '}
                <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[10px]">AI_WORKFLOW_CREATE</code>
              </span>
            }
          />
        )}
      </footer>
    </aside>
  );
}

export default AICopilotPanel;
