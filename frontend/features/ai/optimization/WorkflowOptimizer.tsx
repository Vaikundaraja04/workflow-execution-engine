'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { AIErrorState } from '../components/AIErrorState';
import { RecommendationCard } from '../components/RecommendationCard';
import { useWorkflowOptimization } from '../hooks/useWorkflowOptimization';
import type { AIOptimizationIssue } from '../types/types';
import { Sparkles, RefreshCw, TrendingUp, AlertTriangle, Gauge, Lightbulb } from 'lucide-react';

interface WorkflowOptimizerProps {
  workflowId: string;
  workflowName?: string;
  className?: string;
}

const SEVERITY_VARIANT: Record<AIOptimizationIssue['severity'], 'destructive' | 'warning' | 'info'> = {
  high: 'destructive',
  medium: 'warning',
  low: 'info',
};

export function WorkflowOptimizer({ workflowId, workflowName, className }: WorkflowOptimizerProps) {
  const { results, errors, optimize, canOptimize } = useWorkflowOptimization();
  const [running, setRunning] = React.useState(false);

  const result = results[workflowId] ?? null;
  const error = errors[workflowId] || null;

  const runOptimization = React.useCallback(async () => {
    setRunning(true);
    await optimize(workflowId);
    setRunning(false);
  }, [optimize, workflowId]);

  if (!canOptimize) {
    return (
      <AIErrorState
        variant="permission"
        title="AI optimization restricted"
        message="Workflow optimization is limited to roles with AI write access."
        hint={
          <span>
            Requires{' '}
            <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[10px]">AI_OPTIMIZATION_CREATE</code>{' '}
            permission.
          </span>
        }
        className={className}
      />
    );
  }

  const issues = result?.issues ?? [];
  const recommendations = result?.recommendations ?? [];
  const hasResult = Boolean(result) && !error;

  return (
    <div data-testid="workflow-optimizer" className={cn('space-y-4', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-5 shadow-2xs">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-xs">
            <Gauge className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-900">AI Workflow Optimization</h3>
            <p className="text-[11px] text-gray-500">
              {workflowName
                ? `Analyzing "${workflowName}" against historical run metrics`
                : 'Analyzing the workflow against historical run metrics'}
            </p>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={runOptimization}
          disabled={running}
          className="h-8 border-emerald-200 bg-white text-xs text-emerald-700 hover:bg-emerald-50"
        >
          <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', running && 'animate-spin')} />
          {running ? 'Optimizing...' : result ? 'Re-run analysis' : 'Run analysis'}
        </Button>
      </div>

      {running && !result && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200/70 bg-emerald-50/50 p-5 text-xs text-emerald-800">
          <Sparkles className="h-3.5 w-3.5 animate-spin" />
          Reviewing node layout, retry behavior and latency hotspots...
        </div>
      )}

      {error && !running && (
        <AIErrorState message={error} onRetry={runOptimization} retryLabel="Retry optimization" />
      )}

      {hasResult && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3">
            <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-800">
              <TrendingUp className="h-3.5 w-3.5" />
              Estimated improvement: {result?.estimatedImprovement}
            </span>
            <span className="text-[11px] text-emerald-700">
              {issues.length} issue{issues.length === 1 ? '' : 's'} detected - {recommendations.length}{' '}
              recommendation{recommendations.length === 1 ? '' : 's'}
            </span>
          </div>

          {issues.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-2xs" data-testid="optimization-issues">
              <h4 className="flex items-center gap-1.5 text-xs font-bold text-gray-900">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                Detected issues
              </h4>
              <ul className="mt-3 space-y-2.5">
                {issues.map((issue, index) => (
                  <li
                    key={`${issue.type}_${index}`}
                    className="flex items-start justify-between gap-3 border-b border-gray-100 pb-2.5 last:border-0 last:pb-0"
                  >
                    <div className="space-y-0.5">
                      <p className="text-xs text-gray-700">{issue.description}</p>
                      <span className="font-mono text-[10px] uppercase text-gray-400">{issue.type}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {issue.affectedNodeId && (
                        <span className="rounded-md bg-gray-100 px-2 py-1 font-mono text-[10px] text-gray-600">
                          node: {issue.affectedNodeId}
                        </span>
                      )}
                      <Badge variant={SEVERITY_VARIANT[issue.severity] ?? 'info'} size="sm" className="uppercase">
                        {issue.severity}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {recommendations.length > 0 && (
            <div className="space-y-3" data-testid="optimization-recommendations">
              <h4 className="flex items-center gap-1.5 px-1 text-xs font-bold text-gray-900">
                <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
                Recommendations
              </h4>
              {recommendations.map((recommendation, index) => (
                <RecommendationCard
                  key={`${recommendation.title}_${index}`}
                  title={recommendation.title}
                  description={recommendation.description}
                  impact={recommendation.impact}
                  action={recommendation.action}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {!result && !running && !error && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-6 text-center">
          <p className="text-xs font-semibold text-gray-700">No optimization analysis yet</p>
          <p className="mt-1 text-[11px] text-gray-500">
            Run the analysis to get AI recommendations for this workflow.
          </p>
        </div>
      )}
    </div>
  );
}

export default WorkflowOptimizer;
