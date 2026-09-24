'use client';

import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useWorkspaceHydration } from '@/hooks/useWorkspaceHydration';
import { aiApi } from '@/services/aiApi';
import { apiClient } from '@/services/apiClient';
import type { AIProviderName, AIUpdateConfigurationPayload } from '@/features/ai/types/types';

const PROVIDER_OPTIONS: Array<{ value: AIProviderName; label: string; modelHint: string }> = [
  { value: 'mock', label: 'Mock — built-in, no key needed', modelHint: 'mock-model' },
  { value: 'openai', label: 'OpenAI', modelHint: 'e.g. gpt-4o-mini' },
  { value: 'anthropic', label: 'Anthropic', modelHint: 'e.g. claude-3-5-sonnet-latest' },
  { value: 'gemini', label: 'Google Gemini (free tier, OpenAI-compatible)', modelHint: 'e.g. gemini-2.0-flash' },
  { value: 'openrouter', label: 'OpenRouter (free models)', modelHint: 'e.g. inclusionai/ling-3.0-flash-sante:free' },
];

export default function AISettingsPage() {
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?._id || currentWorkspace?.id || '';
  const hydrated = useWorkspaceHydration();
  const [provider, setProvider] = React.useState<AIProviderName>('mock');
  const [model, setModel] = React.useState('');
  const [apiKey, setApiKey] = React.useState('');
  const [enabled, setEnabled] = React.useState(false);
  const [hasApiKey, setHasApiKey] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [testResult, setTestResult] = React.useState<{ provider?: string; model?: string; sample?: string } | null>(null);

  React.useEffect(() => {
    if (!hydrated || !workspaceId) return;
    let mounted = true;
    const load = async () => {
      try {
        const config = await aiApi.getAIConfig(workspaceId);
        if (!mounted) return;
        setProvider((config.provider as AIProviderName) ?? 'mock');
        setModel(config.model ?? '');
        setEnabled(Boolean(config.enabled));
        setHasApiKey(Boolean((config as { hasApiKey?: boolean }).hasApiKey));
      } catch (err: any) {
        const status = err?.status ?? err?.response?.status;
        if (status !== 404 && mounted) setError(err?.message ?? 'Failed to load AI configuration');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();
    return () => { mounted = false; };
  }, [hydrated, workspaceId]);

  const handleSave = async () => {
    if (!workspaceId) return;
    setSaving(true); setMessage(null); setError(null);
    try {
      const payload: AIUpdateConfigurationPayload = { provider, model: model.trim(), enabled };
      if (apiKey.trim()) payload.apiKey = apiKey.trim();
      const updated = await aiApi.updateAIConfig(payload, workspaceId);
      setHasApiKey(Boolean((updated as { hasApiKey?: boolean }).hasApiKey) || Boolean(apiKey.trim()));
      setApiKey('');
      setMessage('AI provider settings saved.');
    } catch (err: any) {
      setError(err?.message ?? 'Failed to save AI configuration');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!workspaceId) return;
    setTesting(true); setTestResult(null); setError(null); setMessage(null);
    try {
      const response = await apiClient.post('/api/v1/admin/ai/test', {}, { headers: { 'X-Workspace-Id': workspaceId } });
      setTestResult(response.data?.data ?? null);
    } catch (err: any) {
      setTestResult({ sample: err?.message ?? 'Test failed' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">AI Provider Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect a real AI provider, or keep the built-in mock for demos and tests. Keys are stored encrypted per workspace and never leave the server.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={enabled ? 'success' : 'secondary'}>{enabled ? 'AI Enabled' : 'AI Disabled'}</Badge>
          <Badge variant="outline">{provider}</Badge>
          <Badge variant={hasApiKey ? 'success' : 'secondary'}>{hasApiKey ? 'Key stored' : 'No key'}</Badge>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Provider configuration</CardTitle>
          <CardDescription>Applies to workflow generation, failure analysis, optimization, and agent runs in this workspace.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {loading ? (
            <div className="h-24 bg-muted animate-pulse rounded" />
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Provider</label>
                  <select value={provider} onChange={(e) => setProvider(e.target.value as AIProviderName)}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {PROVIDER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>
                <Input label="Model" placeholder={PROVIDER_OPTIONS.find((option) => option.value === provider)?.modelHint ?? ''} value={model} onChange={(e) => setModel(e.target.value)} />
                <Input label={hasApiKey ? 'API Key (leave blank to keep current)' : 'API Key'} type="password" placeholder="sk-or-v1-… / provider key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
                <div className="flex items-end">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="rounded border-input text-primary focus:ring-primary" />
                    <span className="text-sm font-medium text-foreground">Enable AI features for this workspace</span>
                  </label>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Button size="sm" onClick={() => void handleSave()} disabled={saving || !workspaceId}>
                  {saving ? 'Saving…' : 'Save settings'}
                </Button>
                <Button size="sm" variant="outline" onClick={() => void handleTest()} disabled={testing || !workspaceId}>
                  {testing ? 'Testing…' : 'Test provider'}
                </Button>
              </div>

              {message ? <p className="text-sm font-medium text-emerald-600">{message}</p> : null}
              {error ? <p className="text-sm font-medium text-rose-600">{error}</p> : null}

              {testResult ? (
                <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
                  <div className="font-medium text-foreground">Provider test</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Provider: {testResult.provider ?? '—'} · Model: {testResult.model ?? '—'}
                  </div>
                  <pre className="mt-2 text-xs text-foreground whitespace-pre-wrap break-words font-mono">{testResult.sample ?? ''}</pre>
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
