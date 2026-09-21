'use client';

import * as React from 'react';
import { Clock, Gauge, ShieldCheck } from 'lucide-react';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { aiGovernanceApi, aiGovernancePolicyApi } from '@/services/aiGovernanceApi';
import { Badge, type BadgeProps } from '@/components/ui/Badge';
import { GOVERNANCE_POLICY_TYPES } from '@/types/aiGovernancePolicy';

type BudgetState = 'OK' | 'ALERT' | 'THROTTLE' | 'BLOCK';

interface GovernancePosture {
  configuredTypes: number;
  budgetState: BudgetState;
  budgetUsagePercent: number;
  pendingApprovals: number;
}

const BUDGET_VARIANT: Record<BudgetState, BadgeProps['variant']> = {
  OK: 'success',
  ALERT: 'warning',
  THROTTLE: 'warning',
  BLOCK: 'destructive',
};

function workspaceIdOf(workspace: { _id?: string; id?: string } | null | undefined): string {
  if (!workspace) return '';
  return workspace._id ?? workspace.id ?? '';
}
export function GovernancePostureCard() {
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = workspaceIdOf(currentWorkspace);
  const [posture, setPosture] = React.useState<GovernancePosture | null>(null);

  React.useEffect(() => {
    if (!workspaceId) return;
    void (async () => {
      const [policiesResult, budgetResult, approvalsResult] = await Promise.allSettled([
        aiGovernancePolicyApi.listPolicies(undefined, workspaceId),
        aiGovernanceApi.getBudget(workspaceId),
        aiGovernancePolicyApi.listApprovals(workspaceId, 'PENDING'),
      ]);
      if (
        policiesResult.status === 'rejected'
        && budgetResult.status === 'rejected'
        && approvalsResult.status === 'rejected'
      ) {
        setPosture(null);
        return;
      }

      const configuredTypes = policiesResult.status === 'fulfilled'
        ? new Set(policiesResult.value.map((policy) => policy.policyType)).size
        : 0;

      let budgetState: BudgetState = 'OK';
      let budgetUsagePercent = 0;
      if (budgetResult.status === 'fulfilled') {
        const budget = budgetResult.value;
        const tokenPercent = budget.monthlyTokenLimit > 0
          ? (budget.currentTokenUsage / budget.monthlyTokenLimit) * 100
          : 0;
        const costPercent = budget.monthlyCostLimitUSD > 0
          ? (budget.currentCostUSD / budget.monthlyCostLimitUSD) * 100
          : 0;
        budgetUsagePercent = Math.max(tokenPercent, costPercent);
        if (budget.blockEnabled && budgetUsagePercent >= budget.blockThreshold) budgetState = 'BLOCK';
        else if (budget.throttleEnabled && budgetUsagePercent >= budget.throttleThreshold) budgetState = 'THROTTLE';
        else if (budget.alertEnabled && budgetUsagePercent >= budget.alertThreshold) budgetState = 'ALERT';
      }

      setPosture({
        configuredTypes,
        budgetState,
        budgetUsagePercent,
        pendingApprovals: approvalsResult.status === 'fulfilled' ? approvalsResult.value.length : 0,
      });
    })();
  }, [workspaceId]);
  if (!posture) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-xs text-slate-400">
        Governance posture will appear once the workspace and telemetry load.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 bg-slate-900 border border-slate-800 rounded-xl p-4 md:grid-cols-3">
      <div className="flex items-center gap-3">
        <ShieldCheck className="w-4 h-4 text-indigo-400" />
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Policy coverage</p>
          <p className="text-sm font-semibold text-white">
            {posture.configuredTypes} of {GOVERNANCE_POLICY_TYPES.length} policy types configured
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Gauge className="w-4 h-4 text-indigo-400" />
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Budget state</p>
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-white">{posture.budgetUsagePercent.toFixed(1)}% used</p>
            <Badge variant={BUDGET_VARIANT[posture.budgetState]} size="sm">
              {posture.budgetState}
            </Badge>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Clock className="w-4 h-4 text-indigo-400" />
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Approval backlog</p>
          <p className="text-sm font-semibold text-white">{posture.pendingApprovals} pending</p>
        </div>
      </div>
    </div>
  );
}

export default GovernancePostureCard;