'use client';

import * as React from 'react';
import { ShieldCheck, ShieldX, Clock, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Loading } from '@/components/ui/Loading';
import { cn } from '@/lib/utils';
import { agentApi } from '@/services/agentApi';
import type { ToolPolicyEntry, ToolPolicy } from '@/types/agent';

interface ToolPermissionPanelProps {
  workspaceId: string;
  agentId: string;
  onPolicyChange?: (entry: ToolPolicyEntry) => void;
}

const POLICY_LABELS: Record<ToolPolicy, string> = {
  ALLOW: 'Allow',
  DENY: 'Deny',
  REQUIRE_APPROVAL: 'Require Approval',
};

const POLICY_ICONS: Record<ToolPolicy, React.ReactNode> = {
  ALLOW: <ShieldCheck className="h-4 w-4 text-emerald-500" />,
  DENY: <ShieldX className="h-4 w-4 text-rose-500" />,
  REQUIRE_APPROVAL: <Clock className="h-4 w-4 text-amber-500" />,
};

const DANGEROUS_TOOLS = ['http_request', 'database_query', 'workflow_trigger'] as const;

export function ToolPermissionPanel({ workspaceId, agentId, onPolicyChange }: ToolPermissionPanelProps) {
  const [policies, setPolicies] = React.useState<ToolPolicyEntry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const fetchPolicies = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = await agentApi.listToolPolicies(workspaceId, agentId);
      setPolicies(data);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load tool policies');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, agentId]);

  React.useEffect(() => { void fetchPolicies(); }, [fetchPolicies]);

  const handlePolicyChange = async (toolName: string, policy: ToolPolicy) => {
    try {
      const updated = await agentApi.setToolPolicy(workspaceId, agentId, toolName, policy);
      setPolicies((prev) =>
        prev.map((p) => (p.toolName === toolName ? { toolName, policy: updated.policy, source: 'OVERRIDE' as const } : p)),
      );
      onPolicyChange?.({ toolName, policy: updated.policy, source: 'OVERRIDE' });
    } catch (err: any) {
      setError(err?.message ?? 'Failed to update policy');
    }
  };

  if (loading) return <Loading message="Loading tool policies..." />;

  return (
    <div className="space-y-4">
      {error && <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm">{error}</div>}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/30">
            <tr>
              <th className="text-left py-2.5 px-4 font-medium">Tool</th>
              <th className="text-left py-2.5 px-4 font-medium">Default Policy</th>
              <th className="text-left py-2.5 px-4 font-medium">Current Policy</th>
              <th className="text-left py-2.5 px-4 font-medium">Source</th>
              <th className="text-center py-2.5 px-4 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {policies.map((p) => {
              const isDangerous = (DANGEROUS_TOOLS as readonly string[]).includes(p.toolName);
              return (
                <tr key={p.toolName} className="border-t border-border">
                  <td className="py-2.5 px-4">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{p.toolName}</span>
                      {isDangerous && <Badge variant="warning" size="sm">dangerous</Badge>}
                    </div>
                  </td>
                  <td className="py-2.5 px-4">
                    <div className="flex items-center gap-1.5">
                      {POLICY_ICONS[isDangerous ? 'REQUIRE_APPROVAL' : 'ALLOW']}
                      <span>{POLICY_LABELS[isDangerous ? 'REQUIRE_APPROVAL' : 'ALLOW']}</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-4">
                    <div className="flex items-center gap-1.5">
                      {POLICY_ICONS[p.policy]}
                      <span>{POLICY_LABELS[p.policy]}</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-4">
                    <Badge variant={p.source === 'DEFAULT' ? 'outline' : 'secondary'} size="sm">
                      {p.source}
                    </Badge>
                  </td>
                  <td className="py-2.5 px-4 text-center">
                    <select
                      value={p.policy}
                      onChange={(e) => handlePolicyChange(p.toolName, e.target.value as ToolPolicy)}
                      className="text-xs rounded border border-input bg-background px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      <option value="ALLOW">ALLOW</option>
                      <option value="DENY">DENY</option>
                      <option value="REQUIRE_APPROVAL">REQUIRE_APPROVAL</option>
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={fetchPolicies}>
          <RefreshCw className="h-3 w-3 mr-1" /> Refresh
        </Button>
      </div>
    </div>
  );
}

export default ToolPermissionPanel;
