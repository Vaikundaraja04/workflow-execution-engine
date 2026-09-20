'use client';

import * as React from 'react';
import { DollarSign, ShieldAlert, Cpu, Lock, AlertTriangle, CheckCircle2, TrendingUp, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';

export interface AIGovernanceBudget {
  monthlyCapUSD: number;
  currentSpendUSD: number;
  tokenUsage: {
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    estimatedCostUSD: number;
  };
  rateLimits: {
    tokensPerMinute: number;
    requestsPerMinute: number;
    currentTPM: number;
    currentRPM: number;
  };
  policyEnforcement: 'alert' | 'throttle' | 'block';
  piiRedactionStats: {
    totalRedactions: number;
    creditCards: number;
    ssns: number;
    emails: number;
    apiKeys: number;
  };
  securityGuardrails: {
    promptInjectionsBlocked: number;
    harmfulOutputsFiltered: number;
    jailbreaksPrevented: number;
  };
}

interface AIGovernanceBudgetCardProps {
  budget: AIGovernanceBudget;
  onUpdateCap?: (newCapUSD: number) => void;
  onUpdatePolicyAction?: (action: 'alert' | 'throttle' | 'block') => void;
  className?: string;
}

export function AIGovernanceBudgetCard({
  budget,
  onUpdateCap,
  onUpdatePolicyAction,
  className,
}: AIGovernanceBudgetCardProps) {
  const [isEditing, setIsEditing] = React.useState(false);
  const [newCap, setNewCap] = React.useState(String(budget.monthlyCapUSD));

  const spendPercentage = Math.min(100, Math.round((budget.currentSpendUSD / budget.monthlyCapUSD) * 100));
  const isNearLimit = spendPercentage >= 80;
  const isOverLimit = spendPercentage >= 100;

  const handleSaveCap = () => {
    const parsed = parseFloat(newCap);
    if (!isNaN(parsed) && parsed > 0 && onUpdateCap) {
      onUpdateCap(parsed);
    }
    setIsEditing(false);
  };

  return (
    <div className={cn('bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl flex flex-col', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 bg-slate-950 border-b border-slate-800">
        <div className="flex items-center space-x-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-xs">
            <DollarSign className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-1.5">
              AI Budget & Governance
              <Badge
                variant="default"
                size="sm"
                className={cn(
                  'text-[10px]',
                  isOverLimit
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                    : isNearLimit
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                      : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                )}
              >
                {spendPercentage}% Used
              </Badge>
            </h2>
            <p className="text-[11px] text-slate-400">
              Enterprise spend caps, rate limits, PII sanitizer & security guardrails
            </p>
          </div>
        </div>
      </div>

      {/* Main Stats Grid */}
      <div className="p-5 space-y-5">
        {/* Budget Progress Bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Monthly Budget Spend</span>
            <span className="font-mono text-white font-semibold">
              ${budget.currentSpendUSD.toFixed(2)} / ${budget.monthlyCapUSD.toFixed(2)} USD
            </span>
          </div>
          <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                isOverLimit ? 'bg-rose-500' : isNearLimit ? 'bg-amber-500' : 'bg-gradient-to-r from-indigo-500 to-purple-600'
              )}
              style={{ width: `${spendPercentage}%` }}
            />
          </div>
        </div>

        {/* 3 Metric Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Rate Limits */}
          <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5 space-y-1.5">
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span className="flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-indigo-400" />
                Rate Limits
              </span>
              <span className="text-[10px] font-mono text-slate-500">TPM / RPM</span>
            </div>
            <div className="text-sm font-bold text-white font-mono">
              {budget.rateLimits.currentTPM.toLocaleString()} / {budget.rateLimits.tokensPerMinute.toLocaleString()} TPM
            </div>
            <p className="text-[10px] text-slate-400">
              RPM: {budget.rateLimits.currentRPM} / {budget.rateLimits.requestsPerMinute}
            </p>
          </div>

          {/* PII Redaction */}
          <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5 space-y-1.5">
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span className="flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-emerald-400" />
                PII Redacted
              </span>
              <Badge variant="default" size="sm" className="bg-emerald-950 text-emerald-300 border-emerald-800 text-[9px] px-1 py-0">
                Active
              </Badge>
            </div>
            <div className="text-sm font-bold text-emerald-400 font-mono">
              {budget.piiRedactionStats.totalRedactions.toLocaleString()} Items
            </div>
            <p className="text-[10px] text-slate-400 truncate">
              {budget.piiRedactionStats.creditCards} CCs • {budget.piiRedactionStats.ssns} SSNs • {budget.piiRedactionStats.apiKeys} Keys
            </p>
          </div>

          {/* Guardrails */}
          <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5 space-y-1.5">
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span className="flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                Threats Blocked
              </span>
              <span className="text-[10px] font-mono text-slate-500">Jailbreak Guard</span>
            </div>
            <div className="text-sm font-bold text-rose-400 font-mono">
              {budget.securityGuardrails.promptInjectionsBlocked} Injections
            </div>
            <p className="text-[10px] text-slate-400">
              {budget.securityGuardrails.jailbreaksPrevented} jailbreaks prevented
            </p>
          </div>
        </div>

        {/* Policy Enforcement Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800/80">
          <div className="flex items-center space-x-2">
            <span className="text-xs text-slate-400">Action on limit exceedance:</span>
            <div className="flex rounded-lg bg-slate-950 p-0.5 border border-slate-800 text-xs">
              {(['alert', 'throttle', 'block'] as const).map((action) => (
                <button
                  key={action}
                  onClick={() => onUpdatePolicyAction && onUpdatePolicyAction(action)}
                  className={cn(
                    'px-2.5 py-1 rounded-md capitalize text-[11px] font-medium transition-all cursor-pointer',
                    budget.policyEnforcement === action
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-slate-400 hover:text-white'
                  )}
                >
                  {action}
                </button>
              ))}
            </div>
          </div>

          {isEditing ? (
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={newCap}
                onChange={(e) => setNewCap(e.target.value)}
                className="w-24 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-white"
              />
              <Button size="sm" onClick={handleSaveCap} className="h-7 text-xs px-2.5 bg-indigo-600 text-white">
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setIsEditing(false)} className="h-7 text-xs px-2 text-slate-400">
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIsEditing(true)}
              className="h-7 text-xs px-3 bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700"
            >
              Adjust Cap ($)
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default AIGovernanceBudgetCard;
