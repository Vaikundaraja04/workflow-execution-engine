import { useCallback } from 'react';
import { aiApi } from '@/services/aiApi';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useAIStore } from '../stores/aiStore';
import { useAIPermissions } from './useAIPermissions';
import { aiErrorMessage } from './aiError';

/**
 * Workflow optimization recommendations, cached in the AI store per workflow id.
 * Requires the AI_OPTIMIZATION_CREATE permission.
 */
export function useWorkflowOptimization() {
  const { optimizationResults, optimizationErrors, startOptimization, optimizationSucceeded, optimizationFailed } =
    useAIStore();
  const { currentWorkspace } = useWorkspaceStore();
  const { canOptimize } = useAIPermissions();
  const workspaceId = currentWorkspace?._id || currentWorkspace?.id || undefined;

  const optimize = useCallback(
    async (workflowId: string) => {
      if (!workflowId) return null;
      if (!canOptimize) {
        optimizationFailed(workflowId, 'AI_OPTIMIZATION_CREATE permission is required to run workflow optimization.');
        return null;
      }

      startOptimization(workflowId);
      try {
        const result = await aiApi.optimizeWorkflow(workflowId, workspaceId);
        optimizationSucceeded(workflowId, result);
        return result;
      } catch (err) {
        optimizationFailed(workflowId, aiErrorMessage(err, 'Failed to generate optimization recommendations.'));
        return null;
      }
    },
    [canOptimize, optimizationFailed, optimizationSucceeded, startOptimization, workspaceId]
  );

  return { results: optimizationResults, errors: optimizationErrors, optimize, canOptimize };
}

export default useWorkflowOptimization;