'use client';

import * as React from 'react';
import { workspaceApi } from '@/services/workspaceApi';
import { useWorkspaceStore } from '@/stores/workspaceStore';

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
    void workspaceApi
      .getWorkspace(workspaceId)
      .then((workspace) => {
        useWorkspaceStore.getState().setCurrentWorkspace(workspace);
      })
      .catch(() => {
        // Workspace unavailable - callers decide how to degrade.
      })
      .finally(() => {
        if (mounted) setReady(true);
      });

    return () => {
      mounted = false;
    };
  }, []);

  return ready;
}

export default useWorkspaceHydration;
