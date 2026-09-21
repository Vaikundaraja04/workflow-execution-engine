'use client';

import * as React from 'react';
import type { WorkflowAnalysisResult } from '@/types/optimization';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Sparkles, AlertTriangle } from 'lucide-react';

interface WorkflowOptimizationCardProps {
  analysis: WorkflowAnalysisResult;
  onGeneratePlan?: () => void;
  generating?: boolean;
}

const SEVERITY_VARIANT: Record<string, 'destructive' | 'warning' | 'info'> = {
  HIGH: 'destructive',
  MEDIUM: 'warning',
  LOW: 'info',
};

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  );
}

export function WorkflowOptimizationCard({ analysis, onGeneratePlan, generating }: WorkflowOptimizationCardProps) {
  const { performance, bottlenecks } = analysis;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="text-sm font-medium">{analysis.workflowName}</CardTitle>
          <p className="text-xs text-muted-foreground">
            {performance.sampleSize} executions analyzed over the past {performance.windowDays} days
          </p>
        </div>
        {onGeneratePlan ? (
          <Button size="sm" onClick={onGeneratePlan} disabled={generating}>
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            {generating ? 'Generating...' : 'Generate Plan'}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric label="Avg duration" value={`${performance.durations.avgMs}ms`} />
          <Metric label="P95 duration" value={`${performance.durations.p95Ms}ms`} />
          <Metric label="Failure rate" value={`${performance.reliability.failureRate}%`} />
          <Metric label="Retry events" value={`${performance.reliability.totalRetries}`} />
        </div>
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
            Detected bottlenecks ({bottlenecks.length})
          </p>
          {bottlenecks.length === 0 ? (
            <p className="text-xs text-muted-foreground">No inefficiencies detected in the current window.</p>
          ) : (
            <div className="space-y-2">
              {bottlenecks.map((bottleneck) => (
                <div key={bottleneck.id} className="flex items-start justify-between gap-3 border-b pb-2 last:border-0 last:pb-0">
                  <div className="space-y-0.5">
                    <p className="text-xs text-gray-700 dark:text-gray-300">{bottleneck.description}</p>
                    <span className="font-mono text-[10px] uppercase text-muted-foreground">
                      {bottleneck.category.replace(/_/g, ' ')}
                      {bottleneck.nodeId ? ` | ${bottleneck.nodeId}` : ''}
                    </span>
                  </div>
                  <Badge variant={SEVERITY_VARIANT[bottleneck.severity] ?? 'info'} size="sm">
                    {bottleneck.severity}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default WorkflowOptimizationCard;