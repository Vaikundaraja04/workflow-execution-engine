'use client';

import * as React from 'react';
import { Save, X, Shield, Settings } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import { agentApi } from '@/services/agentApi';
import { BUILT_IN_TOOLS } from '@/types/agent';
import type { Agent, CreateAgentInput, AgentStatus, AgentOrchestrationMode } from '@/types/agent';

interface AgentBuilderProps {
  workspaceId: string;
  agent?: Agent | null;
  onSave: (agent: Agent) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

const MODEL_PROVIDERS = ['mock', 'openai', 'anthropic', 'gemini', 'openrouter'];
const ORCHESTRATION_MODES: { value: AgentOrchestrationMode; label: string; desc: string }[] = [
  { value: 'autonomous', label: 'Autonomous', desc: 'Single agent multi-turn reasoning' },
  { value: 'sequential', label: 'Sequential', desc: 'Linear multi-step execution' },
  { value: 'parallel', label: 'Parallel', desc: 'Concurrent agent delegation' },
  { value: 'consensus', label: 'Consensus', desc: 'Voting-based decision making' },
  { value: 'supervisor_worker', label: 'Supervisor/Worker', desc: 'Hierarchical coordination' },
];
const AGENT_STATUSES: AgentStatus[] = ['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'];

export function AgentBuilder({ workspaceId, agent, onSave, onCancel, isLoading }: AgentBuilderProps) {
  const isEdit = !!agent;
  const [form, setForm] = React.useState<CreateAgentInput>({
    name: agent?.name ?? '',
    description: agent?.description ?? '',
    systemPrompt: agent?.systemPrompt ?? '',
    modelConfig: {
      provider: agent?.modelConfig?.provider ?? 'mock',
      model: agent?.modelConfig?.model ?? '',
      temperature: agent?.modelConfig?.temperature ?? 0.7,
      maxTokens: agent?.modelConfig?.maxTokens ?? 1000,
      maxTurns: agent?.modelConfig?.maxTurns ?? 5,
    },
    orchestrationMode: agent?.orchestrationMode ?? 'autonomous',
    toolsAllowed: agent?.toolsAllowed ?? [],
    memoryEnabled: agent?.memoryEnabled ?? false,
    status: agent?.status ?? 'DRAFT',
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.name?.trim()) e.name = 'Name is required';
    if (!form.systemPrompt?.trim()) e.systemPrompt = 'System prompt is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate() || isLoading) return;
    try {
      const result = isEdit && agent
        ? await agentApi.updateAgent(workspaceId, agent.id, form)
        : await agentApi.createAgent(workspaceId, form);
      onSave(result);
    } catch (err: any) {
      setErrors({ submit: err?.message ?? 'Failed to save agent' });
    }
  };

  const toggleTool = (toolName: string) => {
    setForm((prev) => {
      const current = prev.toolsAllowed ?? [];
      return { ...prev, toolsAllowed: current.includes(toolName) ? current.filter((t) => t !== toolName) : [...current, toolName] };
    });
  };

  const updateModelConfig = (field: keyof NonNullable<CreateAgentInput['modelConfig']>, value: unknown) => {
    setForm((prev) => ({
      ...prev,
          modelConfig: { provider: 'mock', model: '', temperature: 0.7, maxTokens: 1000, maxTurns: 5, ...prev.modelConfig, [field]: value },
    }));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {errors.submit && (
        <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm">{errors.submit}</div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input label="Agent Name" placeholder="e.g. Data Pipeline Operator" value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} required />
        <Input label="Description" placeholder="Brief description of the agent's purpose"
          value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </div>
      <div>
        <label className="block text-sm font-medium text-foreground mb-1.5">System Prompt</label>
        <textarea value={form.systemPrompt} onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
          placeholder="Define the agent's personality, goals, and operating instructions..."
          className={cn('w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            errors.systemPrompt && 'border-destructive focus-visible:ring-destructive')} rows={5} required />
        {errors.systemPrompt && <p className="text-xs font-medium text-destructive mt-1">{errors.systemPrompt}</p>}
      </div>
      <div className="border border-border rounded-xl p-4 space-y-4">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Settings className="h-4 w-4" /> Model Configuration
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Provider</label>
            <select value={form.modelConfig?.provider ?? 'mock'} onChange={(e) => updateModelConfig('provider', e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {MODEL_PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <Input label="Model" placeholder="e.g. gpt-4o, claude-3-5-sonnet" value={form.modelConfig?.model ?? ''}
            onChange={(e) => updateModelConfig('model', e.target.value)} />
          <Input label="Temperature" type="number" min={0} max={2} step={0.1}
            value={form.modelConfig?.temperature ?? 0.7} onChange={(e) => updateModelConfig('temperature', parseFloat(e.target.value))} />
          <Input label="Max Tokens" type="number" min={1} value={form.modelConfig?.maxTokens ?? 1000}
            onChange={(e) => updateModelConfig('maxTokens', parseInt(e.target.value, 10))} />
          <Input label="Max Turns" type="number" min={1} max={25} value={form.modelConfig?.maxTurns ?? 5}
                        onChange={(e) => updateModelConfig('maxTurns', parseInt(e.target.value, 10))} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">Orchestration Mode</label>
          <select value={form.orchestrationMode ?? 'autonomous'}
            onChange={(e) => setForm({ ...form, orchestrationMode: e.target.value as AgentOrchestrationMode })}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {ORCHESTRATION_MODES.map((m) => (
              <option key={m.value} value={m.value}>{m.label} — {m.desc}</option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.memoryEnabled ?? false}
              onChange={(e) => setForm({ ...form, memoryEnabled: e.target.checked })}
              className="rounded border-input text-primary focus:ring-primary" />
            <span className="text-sm font-medium text-foreground">Enable Memory</span>
          </label>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground mb-1.5">
          <Shield className="h-4 w-4 inline mr-1" /> Tools Allowed
        </label>
        <p className="text-xs text-muted-foreground mb-2">Select which built-in tools this agent can invoke.</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {BUILT_IN_TOOLS.map((tool) => {
            const enabled = (form.toolsAllowed ?? []).includes(tool);
            const isDangerous = ['http_request', 'database_query', 'workflow_trigger'].includes(tool);
            return (
              <button key={tool} type="button" onClick={() => toggleTool(tool)}
                className={cn('flex items-center justify-between gap-2 p-2.5 rounded-lg border text-left transition-all',
                  enabled ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background text-foreground hover:bg-muted/50')}>
                <span className="font-medium text-xs">{tool}</span>
                {isDangerous && <Badge variant="warning" size="sm" className="text-[9px]">dangerous</Badge>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-border">
        <div className="flex items-center gap-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Status</label>
            <select value={form.status ?? 'DRAFT'} onChange={(e) => setForm({ ...form, status: e.target.value as AgentStatus })}
              className="rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {AGENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {isEdit && agent && (
            <span className="text-xs text-muted-foreground">v{agent.version} • created {new Date(agent.createdAt).toLocaleDateString()}</span>
          )}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={isLoading}>
            <X className="h-4 w-4 mr-1" /> Cancel
          </Button>
          <Button type="submit" variant="default" size="sm" isLoading={isLoading}>
            <Save className="h-4 w-4 mr-1" /> {isEdit ? 'Update Agent' : 'Create Agent'}
          </Button>
        </div>
      </div>
    </form>
  );
}

export default AgentBuilder;
