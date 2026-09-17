import { useCallback } from 'react';
import { aiApi } from '@/services/aiApi';
import { templateApi } from '@/services/templateApi';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useAIStore } from '../stores/aiStore';
import { useAIPermissions } from './useAIPermissions';
import { aiErrorMessage } from './aiError';
import type { AIGenerateTemplateResult } from '../types/types';

/**
 * Template generation flow: generate a template draft from a prompt, persist it
 * as a PRIVATE template, or discard it. Requires AI_WORKFLOW_CREATE.
 */
export function useAITemplateGeneration() {
  const aiState = useAIStore();
  const { currentWorkspace } = useWorkspaceStore();
  const { canGenerateWorkflow } = useAIPermissions();
  const workspaceId = currentWorkspace?._id || currentWorkspace?.id || undefined;

  const generate = useCallback(
    async (prompt: string): Promise<AIGenerateTemplateResult | null> => {
      const trimmed = prompt.trim();

      if (!canGenerateWorkflow) {
        aiState.templateGenerationFailed(
          'You do not have permission to generate templates (AI_WORKFLOW_CREATE required).'
        );
        return null;
      }
      if (!trimmed) {
        return null;
      }

      aiState.setTemplatePrompt(trimmed);
      aiState.startTemplateGeneration();

      try {
        const result = await aiApi.generateTemplate(trimmed, workspaceId);
        aiState.templateGenerationSucceeded(result);
        return result;
      } catch (error) {
        aiState.templateGenerationFailed(aiErrorMessage(error, 'Template generation failed.'));
        return null;
      }
    },
    [aiState, canGenerateWorkflow, workspaceId]
  );

  const createTemplate = useCallback(async (): Promise<string | null> => {
    const generated = aiState.generatedTemplate;
    if (!generated || !generated.validation.isValid) {
      return null;
    }

    try {
      const created = await templateApi.createTemplate(
        {
          name: generated.draftWorkflow.workflowName,
          description: generated.draftWorkflow.description,
          category: generated.templateMetadata.suggestedCategory,
          visibility: generated.templateMetadata.suggestedVisibility,
          tags: generated.templateMetadata.suggestedTags,
          workflowDefinition: generated.draftWorkflow.definition as unknown as Record<string, unknown>,
        },
        workspaceId
      );
      const createdId = created?._id || created?.id || null;
      aiState.setSavedTemplateId(createdId);
      return createdId;
    } catch (error) {
      aiState.templateGenerationFailed(aiErrorMessage(error, 'Failed to create template.'));
      return null;
    }
  }, [aiState, workspaceId]);

  const discard = useCallback(() => {
    aiState.resetTemplateGeneration();
  }, [aiState]);

  return {
    templateState: aiState.templateState,
    templatePrompt: aiState.templatePrompt,
    generatedTemplate: aiState.generatedTemplate,
    templateError: aiState.templateError,
    savedTemplateId: aiState.savedTemplateId,
    setTemplatePrompt: aiState.setTemplatePrompt,
    canGenerateWorkflow,
    generate,
    createTemplate,
    discard,
  };
}

export default useAITemplateGeneration;
