'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Bot, Edit3, Play, Trash2, Shield, Clock, Database } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { hasPermission } from '@/types/permissions';
import { agentApi } from '@/services/agentApi';
import { AgentBuilder } from '@/features/agents/components/AgentBuilder';
import { ToolPermissionPanel } from '@/features/agents/components/ToolPermissionPanel';
import { AgentMemoryViewer } from '@/features/agents/components/AgentMemoryViewer';
import { AgentExecutionTrace } from '@/features/agents/components/AgentExecutionTrace';
import { ApprovalQueue } from '@/features/agents/components/ApprovalQueue';
import type { Agent, AgentRun, StructuredToolInvocation } from '@/types/agent';

export default function AgentDetailPage() {
  const params = useParams();
  const agentId = params?.id as string;
  const router = useRouter();
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?._id ?? '';
  const role = currentWorkspace?.role ?? null;

  const [agent, setAgent] = React.useState<Agent | null>(null);
  const [runs, setRuns] = React.useState<AgentRun[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [activeTab, setActiveTab] = React.useState<'overview' | 'test' | 'runs' | 'memory' | 'tools' | 'approvals'>('overview');
  const [builderOpen, setBuilderOpen] = React.useState(false);
  const [testInput, setTestInput] = React.useState('');
  const [testInvocation, setTestInvocation] = React.useState('');
  const [testResult, setTestResult] = React.useState<unknown>(null);
  const [testLoading, setTestLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const canManage = hasPermission(role, 'AGENT_MANAGE');
  const canExecute = hasPermission(role, 'AGENT_TOOL_EXECUTE');

  const fetchAgent = React.useCallback(async () => {
    if (!workspaceId || !agentId) return;
    setLoading(true);
    try {
      const data = await agentApi.getAgent(workspaceId, agentId);
      setAgent(data);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load agent');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, agentId]);

  const fetchRuns = React.useCallback(async () => {
    if (!workspaceId || !agentId) return;
    try {
      const data = await agentApi.listRuns(workspaceId, agentId);
      setRuns(data);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load runs');
    }
  }, [workspaceId, agentId]);

  React.useEffect(() => { void fetchAgent(); }, [fetchAgent]);
  React.useEffect(() => { void fetchRuns(); }, [fetchRuns]);

  const handleSave = (updated: Agent) => {
    setAgent(updated);
    setBuilderOpen(false);
  };

  const handleTest = async () => {
    if (!workspaceId || !agentId) return;
    setTestLoading(true);
    setTestResult(null);
    setError(null);
    try {
      const body: { input?: unknown; invocation?: StructuredToolInvocation | string } = {};
      if (testInput.trim()) body.input = testInput.trim();
      if (testInvocation.trim()) {
        try { body.invocation = JSON.parse(testInvocation.trim()); } catch { body.invocation = testInvocation.trim(); }
      }
      const data = await agentApi.testAgent(workspaceId, agentId, body);
      setTestResult(data);
      void fetchRuns();
    } catch (err: any) {
      setError(err?.message ?? 'Test failed');
    } finally {
      setTestLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete agent "${agent?.name}"? This cannot be undone.`)) return;
    try {
      await agentApi.deleteAgent(workspaceId, agentId);
      router.push('/agents');
    } catch (err: any) {
      setError(err?.message ?? 'Failed to delete agent');
    }
  };

  if (loading) return <div className="p-6"><div className="h-8 bg-muted animate-pulse rounded w-48 mb-4" /><div className="h-64 bg-muted animate-pulse rounded" /></div>;
  if (!agent) return <div className="p-6"><div className="p-3 rounded-lg bg-rose-500/10 text-rose-400">{error ?? 'Agent not found'}</div></div>;

  const tabs = [
    { id: 'overview', label: 'Overview', icon: Bot },
    { id: 'test', label: 'Test Agent', icon: Play },
    { id: 'runs', label: 'Execution Runs', icon: Clock },
    { id: 'memory', label: 'Memory', icon: Database },
    { id: 'tools', label: 'Tool Policies', icon: Shield },
    { id: 'approvals', label: 'Approvals', icon: Clock },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button size="sm" variant="ghost" onClick={() => router.push('/agents')}>← Agents</Button>
          <h1 className="text-2xl font-bold text-foreground">{agent.name}</h1>
          <Badge variant={agent.status === 'ACTIVE' ? 'success' : agent.status === 'PAUSED' ? 'warning' : 'secondary'} size="sm">{agent.status}</Badge>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setBuilderOpen(true)}><Edit3 className="h-4 w-4 mr-1" /> Edit</Button>
            <Button size="sm" variant="destructive" onClick={handleDelete}><Trash2 className="h-4 w-4 mr-1" /> Delete</Button>
          </div>
        )}
      </div>
      <nav className="flex gap-1 border-b border-border overflow-x-auto">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id as any)}
              className={cn('flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-all',
                activeTab === tab.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
              <Icon className="h-4 w-4" /> {tab.label}
            </button>
          );
        })}
      </nav>
      <div className="min-h-[300px]">
        {activeTab === 'overview' && (
          <Card>
            <CardHeader><CardTitle>Agent Configuration</CardTitle><CardDescription>v{agent.version} • Created {new Date(agent.createdAt).toLocaleString()}</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">{agent.description || 'No description provided.'}</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div><span className="text-muted-foreground">Provider:</span> {agent.modelConfig?.provider ?? 'mock'}</div>
                <div><span className="text-muted-foreground">Model:</span> {agent.modelConfig?.model ?? 'default'}</div>
                <div><span className="text-muted-foreground">Temperature:</span> {agent.modelConfig?.temperature ?? 0.7}</div>
                <div><span className="text-muted-foreground">Max Turns:</span> {agent.modelConfig?.maxTurns ?? 5}</div>
                <div><span className="text-muted-foreground">Orchestration:</span> {agent.orchestrationMode}</div>
                <div><span className="text-muted-foreground">Tools:</span> {agent.toolsAllowed?.length ?? 0} enabled</div>
                <div><span className="text-muted-foreground">Memory:</span> {agent.memoryEnabled ? 'Enabled' : 'Disabled'}</div>
                <div><span className="text-muted-foreground">Created by:</span> {agent.createdBy}</div>
              </div>
              <div><span className="text-sm font-medium">System Prompt:</span>
                <pre className="text-xs bg-muted/30 p-3 rounded-lg mt-1 whitespace-pre-wrap break-words">{agent.systemPrompt}</pre>
              </div>
            </CardContent>
                    </Card>
        )}
        {activeTab === 'test' && canExecute && (
          <Card>
            <CardHeader><CardTitle>Test Agent</CardTitle><CardDescription>Test with a specific tool invocation or free-form input</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Input</label>
                  <input value={testInput} onChange={(e) => setTestInput(e.target.value)} placeholder='e.g. {"task": "analyze"}'
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Structured Invocation (JSON)</label>
                  <input value={testInvocation} onChange={(e) => setTestInvocation(e.target.value)}
                    placeholder='e.g. {"toolName":"calculate","arguments":{"expression":"2+2"}}'
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
              </div>
              <Button onClick={handleTest} isLoading={testLoading} disabled={testLoading || (!testInput && !testInvocation)}>
                <Play className="h-4 w-4 mr-1" /> Run Test
              </Button>
              {Boolean(testResult) && typeof testResult === 'object' && testResult !== null && 'approvalRequired' in testResult && (
                <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm">
                  Approval required. Check the Approvals tab.
                </div>
              )}
              {Boolean(testResult) && typeof testResult !== 'object' && (
                <pre className="mt-4 text-xs text-foreground whitespace-pre-wrap break-all font-mono bg-muted/30 p-3 rounded-lg">
                  {JSON.stringify(testResult, null, 2)}
                </pre>
              )}
            </CardContent>
          </Card>
        )}
        {activeTab === 'runs' && (
          <div className="space-y-4">
            {runs.length === 0 ? (
              <EmptyState icon={<Clock className="h-6 w-6" />} title="No runs yet" description="Run a test to see execution traces." />
            ) : (
              runs.map((run) => (
                <Card key={run.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-sm">Run #{run.id?.slice(-6)}</CardTitle>
                      <Badge variant={run.status === 'SUCCEEDED' ? 'success' : run.status === 'FAILED' ? 'destructive' : 'warning'}>{run.status}</Badge>
                    </div>
                    <CardDescription className="text-xs">{new Date(run.startedAt).toLocaleString()}</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-0"><AgentExecutionTrace run={run} /></CardContent>
                </Card>
              ))
            )}
          </div>
        )}
        {activeTab === 'memory' && (<AgentMemoryViewer workspaceId={workspaceId} agentId={agentId} />)}
        {activeTab === 'tools' && canManage && (<ToolPermissionPanel workspaceId={workspaceId} agentId={agentId} />)}
        {activeTab === 'approvals' && (<ApprovalQueue workspaceId={workspaceId} />)}
      </div>
      <Modal open={builderOpen} onOpenChange={setBuilderOpen} title="Edit Agent" maxWidth="2xl">
        <AgentBuilder workspaceId={workspaceId} agent={agent} onSave={handleSave} onCancel={() => setBuilderOpen(false)} />
      </Modal>
    </div>
  );
}