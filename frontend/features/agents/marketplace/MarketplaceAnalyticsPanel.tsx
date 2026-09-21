'use client';

import * as React from 'react';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import type { MarketplaceAnalyticsDTO, MarketplaceTimeSeriesPointDTO } from '@/types/agentMarketplace';

export interface MarketplaceAnalyticsPanelProps {
  analytics: MarketplaceAnalyticsDTO | null;
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

function TimeSeriesBars({ points }: { points: MarketplaceTimeSeriesPointDTO[] }) {
  const peak = points.reduce((max, point) => Math.max(max, point.count), 0);
  if (points.length === 0) {
    return <p className="text-[11px] text-muted-foreground">No activity in this window.</p>;
  }
  return (
    <div className="flex h-16 items-end gap-0.5" data-testid="analytics-bars">
      {points.map((point) => (
        <div
          key={point.date}
          title={`${point.date}: ${point.count}`}
          className="flex-1 rounded-t bg-indigo-500/70"
          style={{ height: `${peak > 0 ? Math.max((point.count / peak) * 100, 3) : 3}%` }}
        />
      ))}
    </div>
  );
}
export function MarketplaceAnalyticsPanel({ analytics }: MarketplaceAnalyticsPanelProps) {
  if (!analytics) {
    return <p className="text-xs text-muted-foreground">Loading marketplace analytics...</p>;
  }
  const { workspace, publisher } = analytics;

  return (
    <div className="space-y-4" data-testid="marketplace-analytics-panel">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Kpi label="Active installs" value={String(workspace.activeInstallations)} hint={`${workspace.totalInstallations} total`} />
        <Kpi label="Executions" value={String(workspace.executionsInWindow)} hint={`${workspace.failuresInWindow} failed`} />
        <Kpi label="Published" value={String(publisher.publishedListings)} hint={`${publisher.draftListings} draft`} />
        <Kpi label="Installs" value={String(publisher.installsInWindow)} hint={`${publisher.lifetimeInstalls} lifetime`} />
        <Kpi label="Adoption" value={publisher.adoptionRate.toFixed(2)} hint="executions per install" />
        <Kpi label="Avg rating" value={publisher.averageRating.toFixed(1)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Installs over time</CardTitle>
          </CardHeader>
          <CardContent>
            <TimeSeriesBars points={publisher.installsOverTime} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Workspace execution volume</CardTitle>
          </CardHeader>
          <CardContent>
            <TimeSeriesBars points={workspace.executionsOverTime} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Workspace usage insights</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs">
          {workspace.unusedAgents.length > 0 ? (
            <div className="space-y-1">
              <p className="text-[11px] font-medium">Installed but unused in this window</p>
              {workspace.unusedAgents.map((agent) => (
                <div key={agent.agentId} className="flex items-center justify-between text-[11px]">
                  <span>{agent.name}</span>
                  <Badge variant="warning" size="sm">
                    unused
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground">Every installed agent has executed in this window.</p>
          )}

          {workspace.topAgentsByExecutions.length > 0 ? (
            <div className="space-y-1 pt-2">
              <p className="text-[11px] font-medium">Top agents by executions</p>
              {workspace.topAgentsByExecutions.map((agent) => (
                <div key={agent.agentId} className="flex items-center justify-between text-[11px]">
                  <span>{agent.name}</span>
                  <span className="font-mono text-muted-foreground">
                    {agent.runs} runs | {agent.failures} failed
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

export default MarketplaceAnalyticsPanel;