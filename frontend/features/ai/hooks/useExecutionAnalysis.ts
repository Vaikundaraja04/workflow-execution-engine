import { useCallback } from 'react';
import { aiApi } from '@/services/aiApi';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useAIStore } from '../stores/aiStore';
import { useAIPermissions } from './useAIPermissions';
import { aiErrorMessage } from './aiError';

/**
 * Failure analysis for a single execution, cached in the AI store per execution id.
 * Requires the AI_ANALYSIS_READ permission.
 */
export function useExecutionAnalysis(executionId?: string) {
  const { analysisState, analysisResults, analysisErrors, startAnalysis, analysisSucceeded, analysisFailed } =
    useAIStore();
  const { currentWorkspace } = useWorkspaceStore();
  const { canReadAnalysis } = useAIPermissions();
  const workspaceId = currentWorkspace?._id || currentWorkspace?.id || undefined;

  const result = executionId ? analysisResults[executionId] ?? null : null;
  const error = executionId ? analysisErrors[executionId] || null : null;

  const analyze = useCallback(async () => {
    if (!executionId) return null;
    if (!canReadAnalysis) {
      analysisFailed(executionId, 'AI_ANALYSIS_READ permission is required to run failure analysis.');
      return null;
    }

    startAnalysis(executionId);
    try {
      const analysis = await aiApi.analyzeExecution(executionId, workspaceId);
      analysisSucceeded(executionId, analysis);
      return analysis;
    } catch (err) {
      analysisFailed(executionId, aiErrorMessage(err, 'Failed to generate AI failure analysis.'));
      return null;
    }
  }, [
    analysisFailed,
    analysisSucceeded,
    canReadAnalysis,
    executionId,
    startAnalysis,
    workspaceId,
  ]);

  return { result, error, analyze, canReadAnalysis, isAnalyzing: analysisState === 'GENERATING' };
}

export default useExecutionAnalysis;