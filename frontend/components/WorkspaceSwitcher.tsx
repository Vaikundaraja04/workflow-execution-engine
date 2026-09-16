import * as React from 'react';
import { cn } from '@/lib/utils';
import { ChevronDown, Check } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { workspaceApi } from '@/services/workspaceApi';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { Workspace } from '@/types/workspace';

interface WorkspaceSwitcherProps {
  workspace?: Workspace | null;
  onWorkspaceChange?: () => void;
}

export const WorkspaceSwitcher = ({ workspace, onWorkspaceChange }: WorkspaceSwitcherProps) => {
  const { currentWorkspace, setCurrentWorkspace, workspaces, setWorkspaces } = useWorkspaceStore();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const activeWorkspace = workspace || currentWorkspace;

  React.useEffect(() => {
    let isMounted = true;
    const fetchWorkspaces = async () => {
      if (workspaces.length > 0) return;
      setLoading(true);
      setError(null);
      try {
        const data = await workspaceApi.listWorkspaces();
        if (isMounted) {
          setWorkspaces(data);
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err.response?.data?.error?.message || 'Failed to load workspaces');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchWorkspaces();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleWorkspaceChange = async (workspaceId: string) => {
    setLoading(true);
    try {
      const selected = workspaces.find((w) => (w._id || w.id) === workspaceId);
      if (selected) {
        setCurrentWorkspace(selected);
      } else {
        const fetched = await workspaceApi.getWorkspace(workspaceId);
        setCurrentWorkspace(fetched);
      }
      if (onWorkspaceChange) {
        onWorkspaceChange();
      }
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to switch workspace');
    } finally {
      setLoading(false);
    }
  };

  if (loading && workspaces.length === 0) {
    return <div className="flex items-center space-x-2 text-sm text-muted-foreground">Loading workspaces...</div>;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'flex items-center space-x-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring',
            'transition-colors'
          )}
        >
          <span>{activeWorkspace?.name || 'Select workspace'}</span>
          <ChevronDown className="ml-2 h-4 w-4 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56 p-1">
        {error ? (
          <div className="p-3 text-destructive text-sm">{error}</div>
        ) : (
          <>
            {workspaces.map((ws) => {
              const wsId = (ws._id || ws.id || '') as string;
              const activeId = activeWorkspace?._id || activeWorkspace?.id;
              const isSelected = wsId === activeId;
              return (
                <DropdownMenuItem
                  key={wsId || ws.name}
                  onClick={() => wsId && handleWorkspaceChange(wsId)}
                  className={cn(
                    'flex items-center justify-between rounded-md px-3 py-2 text-sm',
                    isSelected && 'bg-accent font-semibold'
                  )}
                >
                  <span className="truncate">{ws.name}</span>
                  {isSelected && <Check className="ml-2 h-4 w-4 text-primary shrink-0" />}
                </DropdownMenuItem>
              );
            })}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default WorkspaceSwitcher;