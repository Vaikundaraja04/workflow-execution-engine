'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAIWorkflowGeneration } from '../hooks/useAIWorkflowGeneration';
import { PromptInput } from '../components/PromptInput';
import { GenerationLoader } from '../components/GenerationLoader';
import { WorkflowPreviewCard } from '../components/WorkflowPreviewCard';
import { AIErrorState } from '../components/AIErrorState';
import { GeneratedWorkflowPreview } from './GeneratedWorkflowPreview';
import { WorkflowValidationChecklist } from './WorkflowValidationChecklist';
import { Button } from '@/components/ui/Button';
import { CheckCircle2, Hammer, RefreshCw, Trash2, Sparkles, ArrowRight } from 'lucide-react';

interface WorkflowGeneratorProps {
  compact?: boolean;
  className?: string;
  onDraftCreated?: (workflowId: string) => void;
}

const EXAMPLE_PROMPTS = [
  'Create an approval workflow for invoices',
  'Create a workflow that receives webhook data, checks customer status, sends email notification',
  'Onboard a new employee with welcome email and IT provisioning',
];

export function WorkflowGenerator({ compact = false, className, onDraftCreated }: WorkflowGeneratorProps) {
  const router = useRouter();
  const [creating, setCreating] = React.useState(false);

  const {
    currentPrompt,
    setCurrentPrompt,
    generationState,
    generatedWorkflow,
    validation,
    generationError,
    suggestedTemplateName,
    createdWorkflowId,
    canGenerateWorkflow,
    generate,
    createDraft,
    loadIntoBuilder,
    discard,
  } = useAIWorkflowGeneration();
  const isGenerating = generationState === 'GENERATING';
  const isValid = validation?.isValid ?? false;

  const handleGenerate = React.useCallback(
    async (prompt: string) => {
      await generate(prompt);
    },
    [generate]
  );

  const handleCreateDraft = async () => {
    setCreating(true);
    const workflowId = await createDraft();
    setCreating(false);
    if (workflowId && onDraftCreated) {
      onDraftCreated(workflowId);
    }
  };

  const handleOpenBuilder = () => {
    if (loadIntoBuilder()) {
      router.push('/workflows/new');
    }
  };

  if (!canGenerateWorkflow) {
    return (
      <AIErrorState
        variant="permission"
        title="AI generation restricted"
        message="Your workspace role does not include AI workflow generation."
        hint={
          <span>
            Requires <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[10px]">AI_WORKFLOW_CREATE</code>{' '}
            (OWNER, ADMIN and EDITOR roles).
          </span>
        }
        className={className}
      />
    );
  }

  return (
    <div className={className} data-testid="ai-workflow-generator">
      <div className="space-y-4">
        {!compact && (
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 text-white shadow-sm">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-gray-900">Natural language workflow generation</h2>
              <p className="text-xs text-gray-500">
                Describe the automation you need. The AI returns a validated DRAFT you can review before saving.
              </p>
            </div>
          </div>
        )}

        <PromptInput
          value={currentPrompt}
          onChange={setCurrentPrompt}
          onSubmit={handleGenerate}
          isLoading={isGenerating}
          placeholder="Create a workflow that receives webhook data, checks customer status, sends email notification"
          submitLabel={generatedWorkflow ? 'Regenerate' : 'Generate'}
        />

        {!compact && !generatedWorkflow && !isGenerating && (
          <div className="flex flex-wrap gap-2">
            {EXAMPLE_PROMPTS.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setCurrentPrompt(example)}
                className="rounded-full border border-gray-200 bg-white px-3 py-1 text-[11px] text-gray-600 transition-colors hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
              >
                {example}
              </button>
            ))}
          </div>
        )}

        {isGenerating && <GenerationLoader />}

        {generationState === 'FAILED' && generationError && (
          <AIErrorState
            message={generationError}
            onRetry={() => handleGenerate(currentPrompt)}
            retryLabel="Retry generation"
          />
        )}

        {generatedWorkflow && !isGenerating && (
          <div className="space-y-4">
            <WorkflowPreviewCard
              workflow={generatedWorkflow}
              validation={validation}
              suggestedTemplateName={suggestedTemplateName}
            >
              <Button
                size="sm"
                onClick={handleCreateDraft}
                disabled={!isValid || creating || !!createdWorkflowId}
                isLoading={creating}
                className="bg-indigo-600 text-white hover:bg-indigo-700"
              >
                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                Create Draft
              </Button>

              <Button variant="outline" size="sm" onClick={handleOpenBuilder}>
                <Hammer className="mr-1.5 h-3.5 w-3.5" />
                Edit in Builder
              </Button>

              <Button variant="ghost" size="sm" onClick={() => handleGenerate(currentPrompt)}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Regenerate
              </Button>

              <Button variant="ghost" size="sm" onClick={discard} className="text-rose-600 hover:text-rose-700">
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Discard
              </Button>
            </WorkflowPreviewCard>

            {createdWorkflowId && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
                <span className="flex items-center gap-2 font-semibold">
                  <CheckCircle2 className="h-4 w-4" />
                  Draft workflow created. It stays unpublished until you publish it from the builder.
                </span>
                <Link
                  href={`/workflows/${createdWorkflowId}/edit`}
                  className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 font-semibold text-emerald-700 hover:bg-emerald-100"
                >
                  Open in builder
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            )}

            <GeneratedWorkflowPreview workflow={generatedWorkflow} height={compact ? 260 : 360} />

            <WorkflowValidationChecklist
              workflow={generatedWorkflow}
              validation={validation}
              canCreate={canGenerateWorkflow}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default WorkflowGenerator;
