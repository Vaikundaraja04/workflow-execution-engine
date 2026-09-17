import { useCallback, useEffect, useState } from 'react';
import { aiApi } from '@/services/aiApi';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useAIPermissions } from './useAIPermissions';
import { aiErrorMessage } from './aiError';
import type { AIUsageSummary } from '../types/types';

interface AIUsageState {
  usage: AIUsageSummary | null;
  loading: boolean;
  error: string | null;
}

/**
 * Workspace AI usage rollup (requests, tokens, estimated cost, feature usage).
 * The usage endpoint is restricted to AI_CONFIGURATION_MANAGE (OWNER / ADMIN).
 */
export function useAIUsage(enabled = true) {
  const { currentWorkspace } = useWorkspaceStore();
  const { canManageConfiguration } = useAIPermissions();
  const workspaceId = currentWorkspace?._id || currentWorkspace?.id || undefined;

  const [state, setState] = useState<AIUsageState>({ usage: null, loading: false, error: null });

  const refetch = useCallback(async () => {
    if (!canManageConfiguration || !enabled) return;

    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const usage = await aiApi.getAIUsage(workspaceId);
      setState({ usage, loading: false, error: null });
    } catch (err) {
      setState({
        usage: null,
        loading: false,
        error: aiErrorMessage(err, 'Failed to load AI usage.'),
      });
    }
  }, [canManageConfiguration, enabled, workspaceId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { ...state, refetch, canManageConfiguration };
}

export default useAIUsage;