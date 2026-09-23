'use client';

import * as React from 'react';
import Link from 'next/link';
import { Plus, Bot } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { hasPermission } from '@/types/permissions';
import { agentApi } from '@/services/agentApi';
import { AgentBuilder } from '@/features/agents/components/AgentBuilder';
import type { Agent, AgentStatus } from '@/types/agent';

export default function AgentsPage() {
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?._id ?? '';
  const [agents, setAgents] = React.useState<Agent[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [builderOpen, setBuilderOpen] = React.useState(false);
  const [editingAgent, setEditingAgent] = React.useState<Agent | null>(null);

  const canManage = hasPermission(currentWorkspace?.role ?? null, 'AGENT_MANAGE');

  const fetchAgents = React.useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const data = await agentApi.listAgents(workspaceId);
      setAgents(data);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load agents');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  React.useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  const handleSave = (agent: Agent) => {
    setAgents((prev) => {
      const filtered = prev.filter((a) => a.id !== agent.id);
      return [agent, ...filtered];
    });
    setBuilderOpen(false);
    setEditingAgent(null);
  };

  const handleDelete = async (agent: Agent) => {
    if (!confirm(`Delete agent "${agent.name}"? This cannot be undone.`)) return;
    try {
      await agentApi.deleteAgent(workspaceId, agent.id);
      setAgents((prev) => prev.filter((a) => a.id !== agent.id));
    } catch (err: any) {
      setError(err?.message ?? 'Failed to delete agent');
    }
  };

    const statusVariant = (status: AgentStatus): 'success' | 'warning' | 'secondary' | 'default' => {
    switch (status) {
      case 'ACTIVE': return 'success';
      case 'PAUSED': return 'warning';
      case 'ARCHIVED': return 'secondary';
      default: return 'default';
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Enterprise Agents</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage autonomous AI agents, their tools, memory, and approval workflows
          </p>
        </div>
        {canManage && (
          <Button size="sm" onClick={() => setBuilderOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Create Agent
          </Button>
        )}
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm">{error}</div>
      )}

      {agents.length === 0 ? (
        <EmptyState
          icon={<Bot className="h-6 w-6" />}
          title="No agents yet"
          description="Create your first enterprise agent to get started with autonomous operations."
          action={canManage ? <Button size="sm" onClick={() => setBuilderOpen(true)}><Plus className="h-4 w-4 mr-1" />Create Agent</Button> : undefined}
        />
      ) : (
        <div className="grid gap-4">
          {agents.map((agent) => (
            <Card key={agent.id} className="group">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <div>
                  <CardTitle className="text-base">{agent.name}</CardTitle>
                  <CardDescription className="text-sm mt-1 line-clamp-2">
                    {agent.description || <span className="italic text-muted-foreground">No description</span>}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={statusVariant(agent.status)} size="sm">{agent.status}</Badge>
                  <Badge variant="outline" size="sm" className="capitalize text-xs">{agent.orchestrationMode}</Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{agent.toolsAllowed.length} tools enabled</span>
                  <span>Memory: {agent.memoryEnabled ? 'ON' : 'OFF'}</span>
                  <span>v{agent.version}</span>
                </div>
                <div className="mt-3 flex gap-2">
                  <Link
                    href={`/agents/${agent.id}`} className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted transition-colors">View Details
                  </Link>
                  {canManage && (
                    <Button size="sm" variant="outline" onClick={() => setEditingAgent(agent)}>
                      Edit
                    </Button>
                  )}
                  {canManage && agent.status !== 'ARCHIVED' && (
                    <Button size="sm" variant="outline" onClick={() => handleDelete(agent)}>
                      Delete
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={builderOpen || !!editingAgent}
        onOpenChange={(open) => { if (!open) { setBuilderOpen(false); setEditingAgent(null); } }}
        title={editingAgent ? 'Edit Agent' : 'Create Agent'}
        description="Configure your enterprise AI agent"
        maxWidth="2xl"
      >
        <AgentBuilder
          workspaceId={workspaceId}
          agent={editingAgent}
          onSave={handleSave}
          onCancel={() => { setBuilderOpen(false); setEditingAgent(null); }}
        />
      </Modal>
    </div>
  );
}
