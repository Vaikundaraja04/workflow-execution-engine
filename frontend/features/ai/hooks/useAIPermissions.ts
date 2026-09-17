import { useWorkspaceStore } from '@/stores/workspaceStore';
import { hasPermission } from '@/types/permissions';

/**
 * Central AI RBAC surface.
 *
 * OWNER / ADMIN : full AI access (generation, analysis, optimization, configuration)
 * EDITOR        : generate workflows, optimize workflows, read analysis
 * VIEWER        : read AI results only
 */
export function useAIPermissions() {
  const { currentRole } = useWorkspaceStore();

  return {
    role: currentRole,
    canGenerateWorkflow: hasPermission(currentRole, 'AI_WORKFLOW_CREATE'),
    canReadAnalysis: hasPermission(currentRole, 'AI_ANALYSIS_READ'),
    canOptimize: hasPermission(currentRole, 'AI_OPTIMIZATION_CREATE'),
    canManageConfiguration: hasPermission(currentRole, 'AI_CONFIGURATION_MANAGE'),
  };
}

export default useAIPermissions;