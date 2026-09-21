'use client';

import * as React from 'react';
import { AIGovernanceBudgetCard, type AIGovernanceBudget } from '@/features/autonomous-ops/AIGovernanceBudgetCard';
import { Cpu, ShieldCheck, DollarSign, Activity, CheckCircle2, Lock, ArrowUpRight, Sliders, ShieldAlert, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import { aiGovernanceApi } from '@/services/aiGovernanceApi';
import {
  routingStrategyFromConfig,
  toAIGovernanceBudgetView,
  toBudgetPolicyPayload,
  toRouterConfigPayload,
} from '@/services/aiOperationsMappers';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { hasPermission } from '@/types/permissions';
import type { AIModelRouterConfigDTO, AIRoutingStrategy } from '@/types/aiOperations';
import { AIAuditDashboard } from '@/features/ai-governance/AIAuditDashboard';
import { GovernancePostureCard } from '@/features/ai-governance/GovernancePostureCard';
import {
  ApprovalPolicyPanel,
  FeaturePoliciesPanel,
  ModelAccessPolicyPanel,
  PrivacyRulesPanel,
  PromptPolicyPanel,
  UsageLimitsPanel,
} from '@/features/ai-governance/PolicyPanels';

const TABS = [
  { id: 'budget', label: 'Budget & Routing' },
  { id: 'policies', label: 'Policies' },
  { id: 'audit', label: 'AI Audit' },
] as const;

type GovernanceTab = (typeof TABS)[number]['id'];

interface AIProviderRow {
  id: string;
  name: string;
  status: string;
  avgLatencyMs: number;
  costPer1kTokens: string;
  currentTrafficPercent: number;
  isPrimary: boolean;
}

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic Claude 3.5 Sonnet & Haiku',
  openai: 'OpenAI GPT-4o & GPT-4o-mini',
  mock: 'Mock Provider (Local Sandbox)',
};

const DEMO_PROVIDERS: AIProviderRow[] = [
  {
    id: 'anthropic',
    name: 'Anthropic Claude 3.5 Sonnet & Haiku',
    status: 'healthy',
    avgLatencyMs: 380,
    costPer1kTokens: '$0.003',
    currentTrafficPercent: 55,
    isPrimary: true,
  },
  {
    id: 'openai',
    name: 'OpenAI GPT-4o & GPT-4o-mini',
    status: 'healthy',
    avgLatencyMs: 410,
    costPer1kTokens: '$0.005',
    currentTrafficPercent: 30,
    isPrimary: false,
  },
  {
    id: 'gemini',
    name: 'Google Gemini 1.5 Flash',
    status: 'healthy',
    avgLatencyMs: 290,
    costPer1kTokens: '$0.001',
    currentTrafficPercent: 15,
    isPrimary: false,
  },
];

/**
 * Derives the provider load-balancing table from the workspace router config.
 * Traffic share is weighted by provider priority order (first = highest).
 */
function buildProviderRows(config: AIModelRouterConfigDTO): AIProviderRow[] {
  const priority =
    config.providerPriority && config.providerPriority.length > 0
      ? config.providerPriority
      : (['openai', 'anthropic', 'mock'] as AIModelRouterConfigDTO['providerPriority']);

  const weightTotal = priority.reduce((total, _provider, index) => total + (priority.length - index), 0);
  const modelEntries = Object.values(config.modelConfigs ?? {});

  return priority.map((provider, index) => {
    const modelEntry = modelEntries.find((entry) => entry.provider === provider);
    return {
      id: provider,
      name: PROVIDER_LABELS[provider] ?? provider,
      status: 'healthy',
      avgLatencyMs: modelEntry?.latencyMs ?? 0,
      costPer1kTokens: modelEntry ? `$${modelEntry.costPer1KTokens}` : '--',
      currentTrafficPercent: Math.round(((priority.length - index) / weightTotal) * 100),
      isPrimary: index === 0,
    };
  });
}

export default function AIGovernancePlatformPage() {
  const [activeTab, setActiveTab] = React.useState<GovernanceTab>('budget');
  const [budget, setBudget] = React.useState<AIGovernanceBudget>({
    monthlyCapUSD: 2500,
    currentSpendUSD: 1420.75,
    tokenUsage: {
      totalTokens: 14250000,
      promptTokens: 9800000,
      completionTokens: 4450000,
      estimatedCostUSD: 1420.75,
    },
    rateLimits: {
      tokensPerMinute: 200000,
      requestsPerMinute: 1200,
      currentTPM: 48500,
      currentRPM: 320,
    },
    policyEnforcement: 'throttle',
    piiRedactionStats: {
      totalRedactions: 3840,
      creditCards: 612,
      ssns: 418,
      emails: 2190,
      apiKeys: 620,
    },
    securityGuardrails: {
      promptInjectionsBlocked: 42,
      harmfulOutputsFiltered: 18,
      jailbreaksPrevented: 35,
    },
  });

  const [routingStrategy, setRoutingStrategy] = React.useState<AIRoutingStrategy>('balanced');
  const [dataSource, setDataSource] = React.useState<'live' | 'demo'>('demo');
  const [isSyncing, setIsSyncing] = React.useState(false);
  const { currentRole } = useWorkspaceStore();
  const canManageBudget = hasPermission(currentRole, 'AI_GOVERNANCE_MANAGE');
  const canManageRouter = hasPermission(currentRole, 'AI_MODEL_ROUTER_MANAGE');

  const loadGovernanceData = React.useCallback(async () => {
    setIsSyncing(true);
    const [budgetResult, routerResult] = await Promise.allSettled([
      aiGovernanceApi.getBudget(),
      aiGovernanceApi.getRouterConfig(),
    ]);

    let hasLiveData = false;

    if (budgetResult.status === 'fulfilled') {
      setBudget((prev) => toAIGovernanceBudgetView(budgetResult.value, prev));
      hasLiveData = true;
    }
    if (routerResult.status === 'fulfilled') {
      setRoutingStrategy(routingStrategyFromConfig(routerResult.value));
      setModelProviders(buildProviderRows(routerResult.value));
      hasLiveData = true;
    }

    setDataSource(hasLiveData ? 'live' : 'demo');
    setIsSyncing(false);
  }, []);

  React.useEffect(() => {
    void loadGovernanceData();
  }, [loadGovernanceData]);

  const handleUpdateCap = async (newCapUSD: number) => {
    setBudget((prev) => ({ ...prev, monthlyCapUSD: newCapUSD }));
    if (!canManageBudget) return;

    try {
      const updated = await aiGovernanceApi.updateBudget({ monthlyCostLimitUSD: newCapUSD });
      setBudget((prev) => toAIGovernanceBudgetView(updated, prev));
      setDataSource('live');
    } catch {
      // The local cap change is retained when the API is unreachable.
    }
  };

  const handleUpdatePolicyAction = async (action: AIGovernanceBudget['policyEnforcement']) => {
    setBudget((prev) => ({ ...prev, policyEnforcement: action }));
    if (!canManageBudget) return;

    try {
      const updated = await aiGovernanceApi.updateBudget(toBudgetPolicyPayload(action));
      setBudget((prev) => toAIGovernanceBudgetView(updated, prev));
      setDataSource('live');
    } catch {
      // The local enforcement change is retained when the API is unreachable.
    }
  };

  const handleSelectRoutingStrategy = async (strategy: AIRoutingStrategy) => {
    setRoutingStrategy(strategy);
    if (!canManageRouter) return;

    try {
      const updated = await aiGovernanceApi.updateRouterConfig(toRouterConfigPayload(strategy));
      setModelProviders(buildProviderRows(updated));
      setDataSource('live');
    } catch {
      // The local routing preference is retained when the API is unreachable.
    }
  };

  const [modelProviders, setModelProviders] = React.useState<AIProviderRow[]>(DEMO_PROVIDERS);

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-md shadow-indigo-500/20">
              <Cpu className="w-5 h-5" />
            </div>
            <h1 className="text-xl font-bold text-white tracking-tight">AI Multi-Model Router & Governance</h1>
            <Badge variant="default" size="sm" className="bg-indigo-500/20 text-indigo-300 border-indigo-500/30 text-xs">
              Enterprise AI Control Plane
            </Badge>
          </div>
          <p className="text-xs text-slate-400 max-w-2xl">
            Dynamic LLM provider load balancing, automated PII sanitization, prompt injection defenses, and enterprise spend caps.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Badge
            variant="default"
            size="sm"
            className={
              dataSource === 'live'
                ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30 text-xs'
                : 'bg-amber-500/20 text-amber-300 border-amber-500/30 text-xs'
            }
          >
            {dataSource === 'live' ? 'Live API Telemetry' : 'Demo Data'}
          </Badge>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void loadGovernanceData();
            }}
            disabled={isSyncing}
            className="h-9 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700 text-xs flex items-center gap-2"
          >
            <Sliders className={`w-3.5 h-3.5${isSyncing ? ' animate-spin' : ''}`} />
            Router Config
          </Button>
        </div>
      </div>

      <GovernancePostureCard />

      <div className="flex items-center gap-1.5 bg-slate-900 p-1 rounded-lg border border-slate-800 text-xs w-fit">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'px-3 py-1 rounded font-medium transition-all cursor-pointer',
              activeTab === tab.id ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-400 hover:text-white'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'policies' ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <ModelAccessPolicyPanel />
          <FeaturePoliciesPanel />
          <PromptPolicyPanel />
          <PrivacyRulesPanel />
          <UsageLimitsPanel />
          <ApprovalPolicyPanel />
        </div>
      ) : null}

      {activeTab === 'audit' ? <AIAuditDashboard /> : null}

      {activeTab === 'budget' ? (
        /* Grid: Budget Card & Multi-Model Router Controls */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* AI Budget Governance Card */}
        <div className="col-span-12 lg:col-span-6">
          <AIGovernanceBudgetCard
            budget={budget}
            onUpdateCap={(newCap) => {
              void handleUpdateCap(newCap);
            }}
            onUpdatePolicyAction={(action) => {
              void handleUpdatePolicyAction(action);
            }}
          />
        </div>

        {/* Dynamic Multi-Model Router Card */}
        <div className="col-span-12 lg:col-span-6 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl flex flex-col">
          <div className="flex items-center justify-between px-5 py-4 bg-slate-950 border-b border-slate-800">
            <div className="flex items-center space-x-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-xs">
                <Sliders className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-white">Dynamic Model Router</h2>
                <p className="text-[11px] text-slate-400">Adaptive routing policy & provider failover chain</p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 bg-slate-900 p-1 rounded-lg border border-slate-800 text-[11px]">
              {(['balanced', 'cost_optimized', 'latency_optimized', 'quality_optimized'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => {
                    void handleSelectRoutingStrategy(mode);
                  }}
                  className={cn(
                    'px-2 py-0.5 rounded capitalize font-medium transition-all cursor-pointer',
                    routingStrategy === mode ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-400 hover:text-white'
                  )}
                >
                  {mode.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>

          <div className="p-5 space-y-4 flex-1">
            <div className="space-y-2.5">
              {modelProviders.map((provider) => (
                <div
                  key={provider.id}
                  className="flex items-center justify-between p-3.5 bg-slate-950/80 border border-slate-800 rounded-xl hover:border-slate-700/80 transition-all"
                >
                  <div className="flex items-center space-x-3">
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-emerald-500/20" />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-white">{provider.name}</span>
                        {provider.isPrimary && (
                          <Badge variant="default" size="sm" className="bg-indigo-500/20 text-indigo-300 border-indigo-500/30 text-[9px] px-1.5 py-0">
                            Primary
                          </Badge>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-400 font-mono">
                        Latency: {provider.avgLatencyMs}ms • Cost: {provider.costPer1kTokens}/1k
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 text-right">
                    <div className="space-y-0.5">
                      <span className="text-xs font-bold font-mono text-indigo-400">{provider.currentTrafficPercent}%</span>
                      <p className="text-[10px] text-slate-500">Traffic Share</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Provider Failover Chain Info */}
            <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5 flex items-center justify-between text-xs text-slate-400">
              <span className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                Automatic Failover Chain:
              </span>
              <span className="font-mono text-indigo-300 text-[11px]">Anthropic ➔ OpenAI ➔ Gemini ➔ Mock</span>
            </div>
          </div>
        </div>
      </div>
      ) : null}
    </div>
  );
}
