import { useCallback } from 'react';
import { aiApi } from '@/services/aiApi';
import { workflowApi } from '@/services/workflowApi';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useWorkflowBuilderStore } from '@/features/workflow-builder/stores/workflowBuilderStore';
import { useAIStore } from '../stores/aiStore';
import { useAIPermissions } from './useAIPermissions';
import { aiErrorMessage } from './aiError';
import type { AIChatMessage, AIGenerateWorkflowResult } from '../types/types';

function createMessageId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function useAIWorkflowGeneration() {
  const aiState = useAIStore();
  const { currentWorkspace } = useWorkspaceStore();
  const { canGenerateWorkflow } = useAIPermissions();
  const workspaceId = currentWorkspace?._id || currentWorkspace?.id || undefined;
  /**
   * Sends a natural language prompt to the AI generation endpoint and stores the
   * resulting DRAFT workflow plus its validation report.
   */
  const generate = useCallback(
    async (prompt: string): Promise<AIGenerateWorkflowResult | null> => {
      const trimmed = prompt.trim();

      if (!canGenerateWorkflow) {
        aiState.generationFailed('You do not have permission to generate workflows (AI_WORKFLOW_CREATE required).');
        return null;
      }
      if (!trimmed) {
        return null;
      }

      const userMessage: AIChatMessage = {
        id: createMessageId('user'),
        role: 'user',
        content: trimmed,
        prompt: trimmed,
        createdAt: new Date().toISOString(),
      };
      aiState.addMessage(userMessage);
      aiState.setCurrentPrompt(trimmed);
      aiState.startGeneration();

      try {
        const result = await aiApi.generateWorkflow(trimmed, workspaceId);
        aiState.generationSucceeded(
          result.draftWorkflow,
          result.validation,
          result.suggestedTemplateName
        );

        const nodeCount = result.draftWorkflow?.nodes?.length ?? 0;
        const connectionCount = result.draftWorkflow?.connections?.length ?? 0;
        const isValid = result.validation?.isValid ?? false;

        aiState.addMessage({
          id: createMessageId('assistant'),
          role: 'assistant',
          content: isValid
            ? `Generated "${result.draftWorkflow.workflowName}" with ${nodeCount} nodes and ${connectionCount} connections. Validation passed - ready to create as a draft.`
            : `Generated "${result.draftWorkflow.workflowName}" with ${nodeCount} nodes, but validation reported ${result.validation?.errors?.length ?? 0} issue(s).`,
          createdAt: new Date().toISOString(),
          nodeCount,
          connectionCount,
          isValid,
        });

        return result;
      } catch (error) {
        const message = aiErrorMessage(error, 'Workflow generation failed.');
        aiState.generationFailed(message);
        aiState.addMessage({
          id: createMessageId('assistant'),
          role: 'assistant',
          content: message,
          createdAt: new Date().toISOString(),
          error: message,
        });
        return null;
      }
    },
    [aiState, canGenerateWorkflow, workspaceId]
  );

  /**
   * Persists the generated workflow as a DRAFT. Publishing stays an explicit,
   * separate action performed from the workflow builder.
   */
  const createDraft = useCallback(async (): Promise<string | null> => {
    const workflow = aiState.generatedWorkflow;
    if (!workflow) return null;
    if (!aiState.validation?.isValid) {
      return null;
    }

    try {
      const created = await workflowApi.createWorkflow(
        {
          name: workflow.workflowName,
          definition: workflow.definition,
        },
        workspaceId
      );
      const createdId = created?._id || created?.id || null;
      aiState.setCreatedWorkflowId(createdId);
      return createdId;
    } catch (error) {
      aiState.generationFailed(aiErrorMessage(error, 'Failed to create workflow draft.'));
      return null;
    }
  }, [aiState, workspaceId]);

  /**
   * Sends the generated graph straight into the visual builder without persisting it.
   */
  const loadIntoBuilder = useCallback((): boolean => {
    const workflow = aiState.generatedWorkflow;
    if (!workflow) return false;

    useWorkflowBuilderStore.getState().loadFromBackendDefinition(
      workflow.workflowName,
      workflow.definition
    );
    return true;
  }, [aiState.generatedWorkflow]);

  const discard = useCallback(() => {
    aiState.resetGeneration();
  }, [aiState]);

  return {
    ...aiState,
    canGenerateWorkflow,
    generate,
    createDraft,
    loadIntoBuilder,
    discard,
  };
}

export default useAIWorkflowGeneration;
