'use client';

import * as React from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useAITemplateGeneration } from '../hooks/useAITemplateGeneration';
import { PromptInput } from '../components/PromptInput';
import { GenerationLoader } from '../components/GenerationLoader';
import { WorkflowPreviewCard } from '../components/WorkflowPreviewCard';
import { AIErrorState } from '../components/AIErrorState';
import { GeneratedWorkflowPreview } from '../workflow-generation/GeneratedWorkflowPreview';
import { WorkflowValidationChecklist } from '../workflow-generation/WorkflowValidationChecklist';
import { CheckCircle2, RefreshCw, Trash2, Sparkles, FileText, Tag, Eye } from 'lucide-react';

const EXAMPLE_PROMPTS = [
  'Create a template for onboarding a new employee with welcome email and IT provisioning',
  'Create a template that syncs form submissions to a CRM and notifies the sales team',
  'Create a template for invoice approval with condition checks and email notifications',
];

interface TemplateGeneratorProps {
  compact?: boolean;
  className?: string;
  onTemplateCreated?: (templateId: string) => void;
}

export function TemplateGenerator({ compact = false, className, onTemplateCreated }: TemplateGeneratorProps) {
  const [creating, setCreating] = React.useState(false);
  const {
    templatePrompt,
    setTemplatePrompt,
    templateState,
    generatedTemplate,
    templateError,
    savedTemplateId,
    canGenerateWorkflow,
    generate,
    createTemplate,
    discard,
  } = useAITemplateGeneration();

  const isGenerating = templateState === 'GENERATING';
  const draftWorkflow = generatedTemplate?.draftWorkflow ?? null;
  const validation = generatedTemplate?.validation ?? null;
  const metadata = generatedTemplate?.templateMetadata ?? null;
  const isValid = validation?.isValid ?? false;

  const handleGenerate = React.useCallback(
    async (prompt: string) => {
      await generate(prompt);
    },
    [generate]
  );

  const handleCreateTemplate = async () => {
    setCreating(true);
    const templateId = await createTemplate();
    setCreating(false);
    if (templateId && onTemplateCreated) {
      onTemplateCreated(templateId);
    }
  };

  if (!canGenerateWorkflow) {
    return (
      <AIErrorState
        variant="permission"
        title="AI template generation restricted"
        message="Your workspace role does not include AI template generation."
        hint={
          <span>
            Requires{' '}
            <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[10px]">AI_WORKFLOW_CREATE</code>{' '}
            (OWNER, ADMIN and EDITOR roles).
          </span>
        }
        className={className}
      />
    );
  }

  return (
    <div className={className} data-testid="ai-template-generator">
      <div className="space-y-4">
        {!compact && (
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 text-white shadow-sm">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-gray-900">Template generation from a prompt</h2>
              <p className="text-xs text-gray-500">
                Describe the automation template you want to publish. The AI returns a validated DRAFT with suggested
                metadata.
              </p>
            </div>
          </div>
        )}

        <PromptInput
          value={templatePrompt}
          onChange={setTemplatePrompt}
          onSubmit={handleGenerate}
          isLoading={isGenerating}
          placeholder="Create a template that syncs form submissions to a CRM and notifies the sales team"
          submitLabel={generatedTemplate ? 'Regenerate' : 'Generate'}
        />

        {!compact && !generatedTemplate && !isGenerating && (
          <div className="flex flex-wrap gap-2">
            {EXAMPLE_PROMPTS.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setTemplatePrompt(example)}
                className="rounded-full border border-gray-200 bg-white px-3 py-1 text-[11px] text-gray-600 transition-colors hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
              >
                {example}
              </button>
            ))}
          </div>
        )}

        {isGenerating && <GenerationLoader label="Generating template..." />}

        {templateState === 'FAILED' && templateError && (
          <AIErrorState
            message={templateError}
            onRetry={() => handleGenerate(templatePrompt)}
            retryLabel="Retry generation"
          />
        )}

        {draftWorkflow && !isGenerating && (
          <div className="space-y-4">
            <WorkflowPreviewCard workflow={draftWorkflow} validation={validation}>
              <Button
                size="sm"
                onClick={handleCreateTemplate}
                disabled={!isValid || creating || !!savedTemplateId}
                isLoading={creating}
                className="bg-indigo-600 text-white hover:bg-indigo-700"
              >
                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                Create Template
              </Button>

              <Button variant="ghost" size="sm" onClick={() => handleGenerate(templatePrompt)}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Regenerate
              </Button>

              <Button variant="ghost" size="sm" onClick={discard} className="text-rose-600 hover:text-rose-700">
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Discard
              </Button>
            </WorkflowPreviewCard>

            {metadata && (
              <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-2xs" data-testid="template-metadata">
                <h4 className="text-xs font-bold text-gray-900">Suggested template metadata</h4>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Badge variant="info" size="sm" className="gap-1">
                    <FileText className="h-3 w-3" />
                    {metadata.suggestedCategory}
                  </Badge>
                  <Badge variant="secondary" size="sm" className="gap-1">
                    <Eye className="h-3 w-3" />
                    {metadata.suggestedVisibility}
                  </Badge>
                  {metadata.suggestedTags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] text-gray-600"
                    >
                      <Tag className="h-3 w-3 text-gray-400" />
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {savedTemplateId && (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span className="font-semibold">
                  Template created. It stays {metadata?.suggestedVisibility ?? 'PRIVATE'} until it is published from
                  the marketplace.
                </span>
              </div>
            )}

            <GeneratedWorkflowPreview workflow={draftWorkflow} height={compact ? 260 : 360} />

            <WorkflowValidationChecklist
              workflow={draftWorkflow}
              validation={validation}
              canCreate={canGenerateWorkflow}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default TemplateGenerator;
