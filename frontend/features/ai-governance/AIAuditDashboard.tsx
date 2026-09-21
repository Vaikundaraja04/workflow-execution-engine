'use client';

import * as React from 'react';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { aiGovernancePolicyApi } from '@/services/aiGovernanceApi';
import { hasPermission } from '@/types/permissions';
import { Button } from '@/components/ui/Button';
import { Badge, type BadgeProps } from '@/components/ui/Badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import type {
  AIOperationApprovalDTO,
  GovernanceAuditEventDTO,
  GovernanceAuditSummaryDTO,
} from '@/types/aiGovernancePolicy';

const TIMEFRAMES = [
  { value: '24h', label: 'Last 24h' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
] as const;

type Timeframe = (typeof TIMEFRAMES)[number]['value'];

const EVENT_VARIANT: Record<string, BadgeProps['variant']> = {
  AI_GOVERNANCE_ALLOWED: 'success',
  AI_GOVERNANCE_DENIED: 'destructive',
  AI_GOVERNANCE_APPROVAL_REQUIRED: 'warning',
  AI_GOVERNANCE_APPROVED: 'info',
  AI_GOVERNANCE_REJECTED: 'destructive',
  AI_GOVERNANCE_POLICY_CREATED: 'outline',
  AI_GOVERNANCE_POLICY_UPDATED: 'outline',
  AI_GOVERNANCE_POLICY_DELETED: 'outline',
};

function workspaceIdOf(workspace: { _id?: string; id?: string } | null | undefined): string {
  if (!workspace) return '';
  return workspace._id ?? workspace.id ?? '';
}

function formatTokens(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

function formatCost(value: number): string {
  return `$${value.toFixed(4)}`;
}
function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function SpendBars({ rows }: { rows: Array<{ label: string; tokens: number; costUSD: number }> }) {
  const peak = rows.reduce((max, row) => Math.max(max, row.costUSD), 0);
  if (rows.length === 0) {
    return <p className="text-[11px] text-muted-foreground">No usage recorded in this window.</p>;
  }
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.label} className="space-y-1">
          <div className="flex items-center justify-between text-[11px]">
            <span className="truncate">{row.label}</span>
            <span className="font-mono text-muted-foreground">
              {formatTokens(row.tokens)} tok | {formatCost(row.costUSD)}
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-gray-100 dark:bg-gray-800">
            <div
              className="h-1.5 rounded-full bg-indigo-500"
              style={{ width: `${peak > 0 ? Math.max((row.costUSD / peak) * 100, 2) : 0}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
export function AIAuditDashboard() {
  const { currentWorkspace, currentRole } = useWorkspaceStore();
  const workspaceId = workspaceIdOf(currentWorkspace);
  const canManage = hasPermission(currentRole, 'AI_GOVERNANCE_MANAGE');

  const [timeframe, setTimeframe] = React.useState<Timeframe>('24h');
  const [summary, setSummary] = React.useState<GovernanceAuditSummaryDTO | null>(null);
  const [events, setEvents] = React.useState<GovernanceAuditEventDTO[]>([]);
  const [approvals, setApprovals] = React.useState<AIOperationApprovalDTO[]>([]);
  const [deciding, setDeciding] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!workspaceId) return;
    const [summaryResult, eventsResult, approvalsResult] = await Promise.allSettled([
      aiGovernancePolicyApi.getAuditSummary(workspaceId, timeframe),
      aiGovernancePolicyApi.getAuditEvents(workspaceId, 25),
      aiGovernancePolicyApi.listApprovals(workspaceId, 'PENDING'),
    ]);
    if (summaryResult.status === 'fulfilled') setSummary(summaryResult.value);
    if (eventsResult.status === 'fulfilled') setEvents(eventsResult.value);
    if (approvalsResult.status === 'fulfilled') setApprovals(approvalsResult.value);
    setError(
      summaryResult.status === 'rejected' && eventsResult.status === 'rejected'
        ? 'Unable to load AI audit telemetry'
        : null
    );
  }, [workspaceId, timeframe]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const decide = async (approvalId: string, action: 'approve' | 'reject') => {
    setDeciding(approvalId);
    setError(null);
    try {
      if (action === 'approve') {
        await aiGovernancePolicyApi.approveApproval(approvalId, workspaceId);
      } else {
        await aiGovernancePolicyApi.rejectApproval(approvalId, workspaceId);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action} AI operation`);
    } finally {
      setDeciding(null);
    }
  };

  const decisions = summary?.decisions;
  const usage = summary?.usage;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">AI audit</h2>
          <p className="text-xs text-muted-foreground">
            Governance decisions, spend and the unified approvals queue, from live telemetry.
          </p>
        </div>
        <div className="flex items-center gap-1.5 rounded-lg border p-1 text-[11px]">
          {TIMEFRAMES.map((option) => (
            <button
              key={option.value}
              onClick={() => setTimeframe(option.value)}
              className={
                timeframe === option.value
                  ? 'rounded bg-indigo-600 px-2 py-0.5 font-medium text-white'
                  : 'rounded px-2 py-0.5 font-medium text-muted-foreground hover:text-foreground'
              }
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Kpi label="Allowed" value={String(decisions?.allowed ?? 0)} />
        <Kpi label="Denied" value={String(decisions?.denied ?? 0)} />
        <Kpi label="Approval required" value={String(decisions?.approvalRequired ?? 0)} />
        <Kpi label="Pending approvals" value={String(summary?.approvals.pending ?? approvals.length)} />
        <Kpi
          label="Spend"
          value={usage ? `$${usage.costUSD.toFixed(2)}` : '--'}
          hint={usage ? `${usage.requests} request(s)` : undefined}
        />
        <Kpi label="Tokens" value={usage ? formatTokens(usage.tokens) : '--'} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Spend by feature</CardTitle>
          </CardHeader>
          <CardContent>
            <SpendBars
              rows={(usage?.byFeature ?? []).map((row) => ({
                label: row.feature,
                tokens: row.tokens,
                costUSD: row.costUSD,
              }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Top models by spend</CardTitle>
          </CardHeader>
          <CardContent>
            <SpendBars
              rows={(usage?.topModels ?? []).map((row) => ({
                label: row.model,
                tokens: row.tokens,
                costUSD: row.costUSD,
              }))}
            />
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Pending AI approvals</CardTitle>
          <Badge variant="warning" size="sm">
            {approvals.length} pending
          </Badge>
        </CardHeader>
        <CardContent className="space-y-2">
          {approvals.length === 0 ? (
            <p className="text-xs text-muted-foreground">No AI operations are waiting for approval.</p>
          ) : (
            approvals.map((approval) => (
              <div
                key={approval._id}
                className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-xs last:border-0 last:pb-0"
              >
                <div className="space-y-0.5">
                  <p className="font-medium">{approval.action}</p>
                  <p className="font-mono text-[10px] text-muted-foreground">
                    {approval.resourceId} | requested {new Date(approval.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!canManage || deciding === approval._id}
                    onClick={() => void decide(approval._id, 'approve')}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!canManage || deciding === approval._id}
                    onClick={() => void decide(approval._id, 'reject')}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Recent governance events</CardTitle>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-xs text-muted-foreground">No governance events recorded yet.</p>
          ) : (
            <div className="space-y-1.5">
              {events.map((event) => (
                <div
                  key={event.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b pb-1.5 text-xs last:border-0 last:pb-0"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant={EVENT_VARIANT[event.action] ?? 'outline'} size="sm">
                      {event.action.replace('AI_GOVERNANCE_', '')}
                    </Badge>
                    {typeof event.metadata.feature === 'string' ? (
                      <span className="text-muted-foreground">{event.metadata.feature}</span>
                    ) : null}
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(event.createdAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default AIAuditDashboard;