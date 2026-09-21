'use client';

import * as React from 'react';
import { optimizationApi } from '@/services/optimizationApi';
import { workflowApi } from '@/services/workflowApi';
import { WorkflowOptimizationCard } from '@/features/optimization/WorkflowOptimizationCard';
import { ImpactPredictionCard } from '@/features/optimization/ImpactPredictionCard';
import { OptimizationHistory } from '@/features/optimization/OptimizationHistory';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import type { IWorkflowOptimizationPlan, OptimizationRecommendation, WorkflowAnalysisResult } from '@/types/optimization';
import type { VersionComparison } from '@/types/workflow';
import { AlertTriangle, RefreshCw, ShieldCheck, Sparkles, TrendingUp } from 'lucide-react';

interface OptimizationDashboardProps {
  workspaceId: string;
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  PENDING: 'secondary',
  APPROVED: 'default',
  APPLIED: 'default',
  REJECTED: 'destructive',
  FAILED: 'destructive',
};

const RISK_VARIANT: Record<string, 'destructive' | 'warning' | 'info'> = {
  HIGH: 'destructive',
  MEDIUM: 'warning',
  LOW: 'info',
};

export function OptimizationDashboard({ workspaceId }: OptimizationDashboardProps) {
  const [workflows, setWorkflows] = React.useState<Array<{ id: string; name: string }>>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = React.useState('');
  const [analysis, setAnalysis] = React.useState<WorkflowAnalysisResult | null>(null);
  const [plans, setPlans] = React.useState<IWorkflowOptimizationPlan[]>([]);
  const [selectedPlan, setSelectedPlan] = React.useState<IWorkflowOptimizationPlan | null>(null);
  const [lastDiff, setLastDiff] = React.useState<VersionComparison | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [generating, setGenerating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const loadPlans = React.useCallback(async () => {
    if (!workspaceId) return;
    try {
      setPlans(await optimizationApi.listPlans(workspaceId));
    } catch {
      // Listing is non-critical for the dashboard.
    }
  }, [workspaceId]);

  React.useEffect(() => {
    if (!workspaceId) return;
    void (async () => {
      try {
        const list = await workflowApi.listWorkflows(workspaceId);
        const mapped = list.map((workflow) => ({ id: workflow._id ?? workflow.id ?? '', name: workflow.name }));
        setWorkflows(mapped);
        setSelectedWorkflowId((current) => current || mapped[0]?.id || '');
      } catch {
        // Workflow list failures surface when an action is attempted.
      }
    })();
    void loadPlans();
  }, [workspaceId, loadPlans]);

  const handleAnalyze = async () => {
    if (!selectedWorkflowId) return;
    try {
      setLoading(true);
      setError(null);
      setNotice(null);
      setAnalysis(await optimizationApi.analyzeWorkflow(selectedWorkflowId, workspaceId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze workflow');
    } finally {
      setLoading(false);
    }
  };

  const handleGeneratePlan = async () => {
    if (!selectedWorkflowId) return;
    try {
      setGenerating(true);
      setError(null);
      setNotice(null);
      const plan = await optimizationApi.generatePlan(selectedWorkflowId, workspaceId);
      setSelectedPlan(plan);
      setLastDiff(null);
      await loadPlans();
      setNotice(
        plan.approvalRequired
          ? 'Plan created. It requires approval before it can be applied.'
          : 'Plan created. Review the recommendations and apply when ready.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate optimization plan');
    } finally {
      setGenerating(false);
    }
  };
  const runPlanAction = async (action: 'approve' | 'reject' | 'apply') => {
    if (!selectedPlan) return;
    try {
      setError(null);
      setNotice(null);
      if (action === 'approve') {
        setSelectedPlan(await optimizationApi.approvePlan(selectedPlan._id, workspaceId));
        setNotice('Plan approved.');
      } else if (action === 'reject') {
        setSelectedPlan(await optimizationApi.rejectPlan(selectedPlan._id, workspaceId));
        setNotice('Plan rejected.');
      } else {
        const result = await optimizationApi.applyPlan(selectedPlan._id, workspaceId);
        setSelectedPlan(result.plan);
        setLastDiff(result.beforeAfter);
        setNotice(
          result.version
            ? `Applied as DRAFT version ${result.version.versionNumber}. Publish it from the workflow editor when ready.`
            : 'Apply completed without creating a version.'
        );
      }
      await loadPlans();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action} plan`);
    }
  };

  const handleSelectPlan = async (planId: string) => {
    setLastDiff(null);
    const cached = plans.find((plan) => plan._id === planId);
    if (cached) {
      setSelectedPlan(cached);
      return;
    }
    try {
      setError(null);
      setSelectedPlan(await optimizationApi.getPlan(planId, workspaceId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load optimization plan');
    }
  };

  const canApprove = selectedPlan?.status === 'PENDING';
  const canApply = selectedPlan !== null
    && (selectedPlan.status === 'APPROVED' || (selectedPlan.status === 'PENDING' && !selectedPlan.approvalRequired));
  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Workflow Optimization</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Analyze execution telemetry, generate improvement plans and apply them as safe DRAFT versions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedWorkflowId}
            onChange={(event) => setSelectedWorkflowId(event.target.value)}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900"
          >
            <option value="">Select a workflow</option>
            {workflows.map((workflow) => (
              <option key={workflow.id} value={workflow.id}>
                {workflow.name}
              </option>
            ))}
          </select>
          <Button size="sm" onClick={handleAnalyze} disabled={loading || !selectedWorkflowId}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Analyzing...' : 'Analyze'}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      ) : null}
      {notice ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</div>
      ) : null}

      {analysis ? (
        <WorkflowOptimizationCard analysis={analysis} onGeneratePlan={handleGeneratePlan} generating={generating} />
      ) : null}

      {selectedPlan ? (
        <PlanDetail
          plan={selectedPlan}
          canApprove={canApprove}
          canApply={canApply}
          diff={lastDiff}
          onAction={runPlanAction}
        />
      ) : null}

      <OptimizationHistory plans={plans} onSelect={handleSelectPlan} />
    </div>
  );
}
interface PlanDetailProps {
  plan: IWorkflowOptimizationPlan;
  canApprove: boolean;
  canApply: boolean;
  diff: VersionComparison | null;
  onAction: (action: 'approve' | 'reject' | 'apply') => void;
}

function improvementLabel(recommendation: OptimizationRecommendation): string {
  const improvement = recommendation.expectedImprovement;
  const value = improvement.unit === 'percent' ? `${improvement.value}%` : `${improvement.value} ${improvement.unit}`;
  return `${value} expected: ${improvement.description}`;
}

function PlanDetail({ plan, canApprove, canApply, diff, onAction }: PlanDetailProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="text-sm font-medium">Optimization plan</CardTitle>
          <p className="text-xs text-muted-foreground">
            {plan.recommendations.length} recommendation(s) | confidence {plan.confidence}% | created{' '}
            {new Date(plan.createdAt).toLocaleString()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={RISK_VARIANT[plan.riskLevel] ?? 'info'} size="sm">
            {plan.riskLevel} risk
          </Badge>
          <Badge variant={STATUS_VARIANT[plan.status] ?? 'outline'} size="sm">
            {plan.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {plan.approvalRequired ? (
          <p className="flex items-center gap-1.5 text-xs text-amber-600">
            <ShieldCheck className="h-3.5 w-3.5" />
            Approval is required before this plan can be applied.
          </p>
        ) : null}

        {plan.aiExplanation ? (
          <div className="rounded-md bg-gray-50 p-3 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300">
            <p className="mb-1 flex items-center gap-1.5 font-semibold">
              <Sparkles className="h-3.5 w-3.5" />
              AI summary
            </p>
            {plan.aiExplanation}
          </div>
        ) : null}
        <div className="space-y-2">
          {plan.recommendations.map((recommendation) => (
            <div
              key={recommendation.id}
              className="flex items-start justify-between gap-3 border-b pb-2 last:border-0 last:pb-0"
            >
              <div className="space-y-0.5">
                <p className="text-xs font-medium">{recommendation.title}</p>
                <p className="text-xs text-gray-600 dark:text-gray-400">{recommendation.description}</p>
                <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <TrendingUp className="h-3 w-3" />
                  {improvementLabel(recommendation)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {recommendation.changes.length > 0 ? (
                  <Badge variant="info" size="sm">
                    {recommendation.changes.length} change(s)
                  </Badge>
                ) : (
                  <Badge variant="outline" size="sm">
                    advisory
                  </Badge>
                )}
                <Badge variant={RISK_VARIANT[recommendation.riskLevel] ?? 'info'} size="sm">
                  {recommendation.riskLevel}
                </Badge>
              </div>
            </div>
          ))}
        </div>

        <ImpactPredictionCard impact={plan.expectedImpact} confidence={plan.confidence} />

        {plan.failureReason ? (
          <p className="flex items-center gap-1.5 text-xs text-red-600">
            <AlertTriangle className="h-3.5 w-3.5" />
            {plan.failureReason}
          </p>
        ) : null}
        {diff ? (
          <div className="space-y-1 rounded-md border p-3 text-xs">
            <p className="font-semibold">Applied diff</p>
            <p>Edges added: {diff.edges.added.length > 0 ? diff.edges.added.join(', ') : 'none'}</p>
            <p>Edges removed: {diff.edges.removed.length > 0 ? diff.edges.removed.join(', ') : 'none'}</p>
            <p>Nodes added: {diff.nodes.added.length > 0 ? diff.nodes.added.join(', ') : 'none'}</p>
            <p>Nodes removed: {diff.nodes.removed.length > 0 ? diff.nodes.removed.join(', ') : 'none'}</p>
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => onAction('approve')} disabled={!canApprove}>
            Approve
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onAction('reject')} disabled={!canApprove}>
            Reject
          </Button>
          <Button size="sm" onClick={() => onAction('apply')} disabled={!canApply}>
            Apply changes
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default OptimizationDashboard;