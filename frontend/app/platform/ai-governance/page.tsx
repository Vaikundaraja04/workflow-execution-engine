'use client';

import * as React from 'react';
import { AIGovernanceBudgetCard, AIGovernanceBudget } from '@/features/autonomous-ops/AIGovernanceBudgetCard';
import { Cpu, ShieldCheck, DollarSign, Activity, CheckCircle2, Lock, ArrowUpRight, Sliders, ShieldAlert, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';

export default function AIGovernancePlatformPage() {
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

  const [routingStrategy, setRoutingStrategy] = React.useState<'cost_optimized' | 'latency_optimized' | 'quality_optimized' | 'balanced'>('balanced');

  const modelProviders = [
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
          <Button
            size="sm"
            variant="outline"
            className="h-9 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700 text-xs flex items-center gap-2"
          >
            <Sliders className="w-3.5 h-3.5" />
            Router Config
          </Button>
        </div>
      </div>

      {/* Grid: Budget Card & Multi-Model Router Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* AI Budget Governance Card */}
        <div className="col-span-12 lg:col-span-6">
          <AIGovernanceBudgetCard
            budget={budget}
            onUpdateCap={(newCap) => setBudget((prev) => ({ ...prev, monthlyCapUSD: newCap }))}
            onUpdatePolicyAction={(action) => setBudget((prev) => ({ ...prev, policyEnforcement: action }))}
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
                  onClick={() => setRoutingStrategy(mode)}
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
    </div>
  );
}
