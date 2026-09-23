'use client';

import * as React from 'react';
import { workspaceApi } from '@/services/workspaceApi';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { Workspace } from '@/types/workspace';

/**
 * Ensures the active workspace (and its role) is loaded on pages that do not
 * render inside the app shell. Permission-gated actions must not evaluate
 * against a null role, otherwise they hide or misroute on a fresh page load.
 *
 * Returns true once the hydration attempt has finished (either the workspace
 * is present or there was nothing to hydrate).
 */
export function useWorkspaceHydration(): boolean {
  const [ready, setReady] = React.useState<boolean>(
    () => useWorkspaceStore.getState().currentWorkspace !== null,
  );

  React.useEffect(() => {
    const state = useWorkspaceStore.getState();
    if (state.currentWorkspace) {
      setReady(true);
      return;
    }

    const workspaceId =
      typeof window !== 'undefined'
        ? localStorage.getItem('currentWorkspaceId') || localStorage.getItem('defaultWorkspaceId')
        : null;

    if (!workspaceId) {
      setReady(true);
      return;
    }

    let mounted = true;

    const hydrate = async () => {
      let workspace: Workspace | null = null;

      try {
        workspace = await workspaceApi.getWorkspace(workspaceId);
      } catch {
        workspace = null;
        // Stored ID may be stale - fall back to the login-provided default.
        const defaultWorkspaceId = localStorage.getItem('defaultWorkspaceId');
        if (defaultWorkspaceId && defaultWorkspaceId !== workspaceId) {
          try {
            localStorage.removeItem('currentWorkspaceId');
            workspace = await workspaceApi.getWorkspace(defaultWorkspaceId);
          } catch {
            workspace = null;
          }
        }
      }

      // Self-heal: stored IDs may point to a workspace that was deleted or
      // recreated. Fall back to the first workspace and refresh localStorage.
      if (!workspace) {
        try {
          const workspaces = await workspaceApi.listWorkspaces();
          workspace = workspaces[0] ?? null;
          const healedId = workspace?._id || workspace?.id;
          if (healedId) {
            localStorage.setItem('currentWorkspaceId', healedId);
            localStorage.setItem('defaultWorkspaceId', healedId);
          }
        } catch {
          workspace = null;
        }
      }

      if (workspace) {
        useWorkspaceStore.getState().setCurrentWorkspace(workspace);
      }
      if (mounted) setReady(true);
    };

    void hydrate();

    return () => {
      mounted = false;
    };
  }, []);

  return ready;
}

export default useWorkspaceHydration;