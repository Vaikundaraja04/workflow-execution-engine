'use client';

import * as React from 'react';
import { Database, Clock, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Loading } from '@/components/ui/Loading';
import { cn } from '@/lib/utils';
import { agentApi } from '@/services/agentApi';
import type { AgentMemory, AgentMemoryScope } from '@/types/agent';

interface AgentMemoryViewerProps {
  workspaceId: string;
  agentId: string;
  scopeFilter?: AgentMemoryScope;
}

const SCOPE_COLORS: Record<AgentMemoryScope, string> = {
  RUN: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  WORKFLOW: 'bg-purple-500/15 text-purple-600 dark:text-purple-400',
  WORKSPACE: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
};

export function AgentMemoryViewer({ workspaceId, agentId, scopeFilter }: AgentMemoryViewerProps) {
  const [memory, setMemory] = React.useState<AgentMemory[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const fetchMemory = React.useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    try {
      const data = await agentApi.listMemory(workspaceId, agentId);
      setMemory(data);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load memory');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, agentId]);

  React.useEffect(() => {
    void fetchMemory();
  }, [fetchMemory]);

  const filtered = scopeFilter ? memory.filter((m) => m.scope === scopeFilter) : memory;
  const grouped = (['WORKSPACE', 'WORKFLOW', 'RUN'] as AgentMemoryScope[]).reduce((acc, scope) => {
    acc[scope] = filtered.filter((m) => m.scope === scope);
    return acc;
  }, {} as Record<AgentMemoryScope, AgentMemory[]>);

  if (loading) return <Loading message="Loading agent memory..." />;

  const renderMemoryTable = (items: AgentMemory[], scope: AgentMemoryScope) => (
    <div key={scope} className="mb-6 last:mb-0">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-2 flex items-center gap-1">
        <Database className="h-3 w-3" />
        {scope} Scope ({items.length})
      </h3>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground py-3">No memory entries in this scope.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left py-2 px-3 font-medium">Key</th>
                <th className="text-left py-2 px-3 font-medium">Value</th>
                <th className="text-left py-2 px-3 font-medium">Expires</th>
                <th className="text-left py-2 px-3 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {items.map((m) => (
                <tr key={m.id} className="border-t border-border">
                  <td className="py-2 px-3 font-mono text-xs">{m.key}</td>
                  <td className="py-2 px-3">
                    <code className="text-xs bg-muted/30 px-2 py-1 rounded max-w-xs block truncate">
                      {typeof m.value === 'string' ? m.value : JSON.stringify(m.value)}
                    </code>
                  </td>
                  <td className="py-2 px-3 text-xs text-muted-foreground">
                    {m.expiresAt ? new Date(m.expiresAt).toLocaleString() : <span className="text-xs">∞</span>}
                  </td>
                  <td className="py-2 px-3 text-xs text-muted-foreground">
                    {new Date(m.updatedAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {error && <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm">{error}</div>}
      {memory.length === 0 && !loading && !error ? (
        <div className="text-center py-8 text-muted-foreground">
          <Database className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No memory entries for this agent.</p>
          <p className="text-xs mt-1">Memory is stored when agents execute with memory enabled.</p>
        </div>
      ) : (
        <>
          {renderMemoryTable(grouped.WORKSPACE, 'WORKSPACE')}
          {renderMemoryTable(grouped.WORKFLOW, 'WORKFLOW')}
          {renderMemoryTable(grouped.RUN, 'RUN')}
        </>
      )}
    </div>
  );
}

export default AgentMemoryViewer;
