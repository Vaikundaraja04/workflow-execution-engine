'use client';

import * as React from 'react';
import { SelfHealingIncidentsTable, type SelfHealingIncident } from '@/features/autonomous-ops/SelfHealingIncidentsTable';
import { PolicyManager, type SelfHealingPolicy } from '@/features/autonomous-ops/PolicyManager';
import { PredictiveRadar, type PredictiveAnomalyItem } from '@/features/autonomous-ops/PredictiveRadar';
import { ShieldAlert, Zap, Activity, Cpu, Sparkles, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { predictiveOpsApi } from '@/services/predictiveOpsApi';
import { selfHealingApi } from '@/services/selfHealingApi';
import {
  isPersistedId,
  toPredictiveAnomalyView,
  toSelfHealingIncidentView,
  toSelfHealingPolicyPayload,
  toSelfHealingPolicyView,
  type SelfHealingPolicyForm,
} from '@/services/aiOperationsMappers';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { hasPermission } from '@/types/permissions';

export default function AutonomousOperationsPage() {
  const [incidents, setIncidents] = React.useState<SelfHealingIncident[]>([
    {
      id: 'inc-101',
      workflowId: 'wf-order-sync',
      workflowName: 'Order Processing Pipeline',
      executionId: 'exec-8910',
      errorType: 'GATEWAY_TIMEOUT',
      errorMessage: 'Payment gateway timed out after 15000ms',
      severity: 'high',
      status: 'healing',
      detectedAt: new Date(Date.now() - 300000).toISOString(),
      healingAction: 'Exponential backoff retry with alternate payment node',
      isManualApprovalRequired: false,
    },
    {
      id: 'inc-102',
      workflowId: 'wf-crm-enrichment',
      workflowName: 'Customer Data Sync',
      executionId: 'exec-8911',
      errorType: 'RATE_LIMIT_EXCEEDED',
      errorMessage: 'HTTP 429: Too Many Requests from Salesforce API',
      severity: 'medium',
      status: 'resolved',
      detectedAt: new Date(Date.now() - 900000).toISOString(),
      resolvedAt: new Date(Date.now() - 600000).toISOString(),
      healingAction: 'Queued requests and throttled worker dispatch rate',
      isManualApprovalRequired: false,
    },
    {
      id: 'inc-103',
      workflowId: 'wf-settlement',
      workflowName: 'Nightly Settlement Engine',
      executionId: 'exec-8912',
      errorType: 'CIRCUIT_BREAKER_TRIGGERED',
      errorMessage: 'Database connection pool exhausted',
      severity: 'critical',
      status: 'detected',
      detectedAt: new Date(Date.now() - 120000).toISOString(),
      isManualApprovalRequired: true,
    },
  ]);

  const [policies, setPolicies] = React.useState<SelfHealingPolicy[]>([
    {
      id: 'pol-1',
      name: 'Transient HTTP Timeout Auto-Retry',
      description: 'Automatically retry with jitter on 504 Gateway Timeout',
      triggerEvent: 'workflow_failure',
      conditions: {
        errorType: ['timeout'],
        severity: ['high'],
        workflowIds: [],
        timeWindow: { start: '00:00', end: '23:59' },
      },
      actions: [{ type: 'auto_heal', configuration: { maxAttempts: 5, initialDelayMs: 1000 } }],
      isEnabled: true,
      priority: 80,
      triggerCount: 14,
      successRate: 92,
    },
    {
      id: 'pol-2',
      name: 'Third-Party API Rate Limit Throttler',
      description: 'Throttle concurrency and queue executions on HTTP 429',
      triggerEvent: 'error_rate_surge',
      conditions: {
        errorType: ['external_service_failure'],
        severity: ['medium'],
        workflowIds: [],
        timeWindow: { start: '00:00', end: '23:59' },
      },
      actions: [{ type: 'scale_resources', configuration: { throttlePercent: 50 } }],
      isEnabled: true,
      priority: 70,
      triggerCount: 8,
      successRate: 100,
    },
    {
      id: 'pol-3',
      name: 'Critical Circuit Breaker Gated Trip',
      description: 'Isolate upstream database failure and require human sign-off',
      triggerEvent: 'resource_exhaustion',
      conditions: {
        errorType: ['external_service_failure'],
        severity: ['critical'],
        workflowIds: [],
        timeWindow: { start: '00:00', end: '23:59' },
      },
      actions: [{ type: 'notify', configuration: { breakerDurationSeconds: 300 } }],
      isEnabled: true,
      priority: 95,
      triggerCount: 3,
      successRate: 67,
    },
  ]);

  const [anomalies, setAnomalies] = React.useState<PredictiveAnomalyItem[]>([
    {
      id: 'anom-1',
      workflowId: 'wf-order-sync',
      workflowName: 'Order Processing Pipeline',
      anomalyType: 'execution_drift',
      confidenceScore: 84,
      predictedFailureTime: new Date(Date.now() + 600000).toISOString(),
      recommendedAction: 'Scale worker pool from 2 to 4 instances to prevent SLA breach',
      status: 'active',
      detectedAt: new Date(Date.now() - 60000).toISOString(),
    },
    {
      id: 'anom-2',
      workflowId: 'wf-settlement',
      workflowName: 'Nightly Settlement Engine',
      anomalyType: 'memory_pressure',
      confidenceScore: 72,
      predictedFailureTime: new Date(Date.now() + 1800000).toISOString(),
      recommendedAction: 'Apply streaming memory optimizer for large CSV payload',
      status: 'active',
      detectedAt: new Date(Date.now() - 180000).toISOString(),
    },
  ]);

  const [dataSource, setDataSource] = React.useState<'live' | 'demo'>('demo');
  const [isSyncing, setIsSyncing] = React.useState(false);
  const { currentRole } = useWorkspaceStore();
  const canManageHealing =
    hasPermission(currentRole, 'SELF_HEALING_MANAGE') || hasPermission(currentRole, 'OPERATIONS_MANAGE');

  const handleSyncFleetHealth = React.useCallback(async () => {
    setIsSyncing(true);
    const [incidentResult, policyResult, anomalyResult] = await Promise.allSettled([
      selfHealingApi.listIncidents(),
      selfHealingApi.listPolicies(),
      predictiveOpsApi.listAnomalies(),
    ]);

    let hasLiveData = false;

    if (incidentResult.status === 'fulfilled' && incidentResult.value.length > 0) {
      setIncidents(incidentResult.value.map((dto) => toSelfHealingIncidentView(dto)));
      hasLiveData = true;
    }
    if (policyResult.status === 'fulfilled' && policyResult.value.length > 0) {
      setPolicies(policyResult.value.map(toSelfHealingPolicyView));
      hasLiveData = true;
    }
    if (anomalyResult.status === 'fulfilled' && anomalyResult.value.length > 0) {
      setAnomalies(anomalyResult.value.map((dto) => toPredictiveAnomalyView(dto)));
      hasLiveData = true;
    }

    setDataSource(hasLiveData ? 'live' : 'demo');
    setIsSyncing(false);
  }, []);

  React.useEffect(() => {
    void handleSyncFleetHealth();
  }, [handleSyncFleetHealth]);

  const handleHealManually = async (incidentId: string) => {
    if (!canManageHealing) return;

    const incident = incidents.find((inc) => inc.id === incidentId);

    setIncidents((prev) =>
      prev.map((inc) => (inc.id === incidentId ? { ...inc, status: 'healing' } : inc))
    );

    try {
      if (incident?.isManualApprovalRequired) {
        await selfHealingApi.approveIncident(incidentId);
      } else if (incident?.executionId) {
        await selfHealingApi.evaluateExecutionFailure(incident.executionId);
      }
      await handleSyncFleetHealth();
    } catch {
      setIncidents((prev) =>
        prev.map((inc) =>
          inc.id === incidentId
            ? { ...inc, status: 'resolved', resolvedAt: new Date().toISOString() }
            : inc
        )
      );
    }
  };

  const handleAcknowledgeAnomaly = async (anomalyId: string) => {
    setAnomalies((prev) =>
      prev.map((a) => (a.id === anomalyId ? { ...a, status: 'acknowledged' } : a))
    );

    if (!isPersistedId(anomalyId)) return;

    try {
      await predictiveOpsApi.acknowledgeAnomaly(anomalyId);
    } catch {
      // Keep the optimistic local acknowledgement when the API is unreachable.
    }
  };

  const handleApplyRecommendation = async (anomalyId: string) => {
    setAnomalies((prev) =>
      prev.map((a) => (a.id === anomalyId ? { ...a, status: 'resolved' } : a))
    );

    if (!isPersistedId(anomalyId)) return;

    try {
      await predictiveOpsApi.acknowledgeAnomaly(anomalyId);
    } catch {
      // The recommendation stays locally applied when the API is unreachable.
    }
  };

  const handleCreatePolicy = async (newPol: SelfHealingPolicyForm) => {
    if (!canManageHealing) return;

    try {
      const created = await selfHealingApi.createPolicy(toSelfHealingPolicyPayload(newPol));
      setPolicies((prev) => [...prev, toSelfHealingPolicyView(created)]);
      setDataSource('live');
    } catch {
      setPolicies((prev) => [
        ...prev,
        { ...newPol, id: `pol-${Date.now()}`, triggerCount: 0, successRate: 100 },
      ]);
    }
  };

  const handleUpdatePolicy = async (id: string, updates: Partial<SelfHealingPolicy>) => {
    if (!canManageHealing) return;

    const existing = policies.find((p) => p.id === id);
    if (!existing) return;

    const merged: SelfHealingPolicy = { ...existing, ...updates };
    setPolicies((prev) => prev.map((p) => (p.id === id ? merged : p)));

    if (!isPersistedId(id)) return;

    try {
      await selfHealingApi.updatePolicy(id, toSelfHealingPolicyPayload(merged));
    } catch {
      // The local edit is retained when the API is unreachable.
    }
  };

  const handleTogglePolicy = async (policyId: string) => {
    const policy = policies.find((p) => p.id === policyId);
    if (!policy || !canManageHealing) return;

    const nextEnabled = !policy.isEnabled;
    setPolicies((prev) =>
      prev.map((p) => (p.id === policyId ? { ...p, isEnabled: nextEnabled } : p))
    );

    if (!isPersistedId(policyId)) return;

    try {
      await selfHealingApi.updatePolicy(policyId, { isEnabled: nextEnabled });
    } catch {
      // The local toggle is retained when the API is unreachable.
    }
  };

  const handleDeletePolicy = async (policyId: string) => {
    if (!canManageHealing) return;

    setPolicies((prev) => prev.filter((p) => p.id !== policyId));

    if (!isPersistedId(policyId)) return;

    try {
      await selfHealingApi.deletePolicy(policyId);
    } catch {
      // The local removal is retained when the API is unreachable.
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-md shadow-indigo-500/20">
              <Sparkles className="w-5 h-5" />
            </div>
            <h1 className="text-xl font-bold text-white tracking-tight">Autonomous Operations Console</h1>
            <Badge variant="default" size="sm" className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-xs">
              Closed-Loop Self-Healing
            </Badge>
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
            {!canManageHealing && (
              <Badge variant="default" size="sm" className="bg-slate-800 text-slate-300 border-slate-700 text-xs">
                Read-only
              </Badge>
            )}
          </div>
          <p className="text-xs text-slate-400 max-w-2xl">
            Real-time automated incident remediation, AI-driven failure forecasting, and safety-gated policy management for zero-downtime workflows.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void handleSyncFleetHealth();
            }}
            disabled={isSyncing}
            className="h-9 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700 text-xs flex items-center gap-2"
          >
            <RefreshCw className={`w-3.5 h-3.5${isSyncing ? ' animate-spin' : ''}`} />
            Sync Fleet Health
          </Button>
        </div>
      </div>

      {/* Main Grid: Incidents & Predictive Radar */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Incidents Table */}
        <div className="col-span-12 lg:col-span-7">
          <SelfHealingIncidentsTable
            incidents={incidents}
            onHealManually={handleHealManually}
            onDelete={(id) => setIncidents((prev) => prev.filter((i) => i.id !== id))}
          />
        </div>

        {/* Predictive Radar */}
        <div className="col-span-12 lg:col-span-5">
          <PredictiveRadar
            anomalies={anomalies}
            onAcknowledge={handleAcknowledgeAnomaly}
            onApplyRecommendation={handleApplyRecommendation}
          />
        </div>
      </div>

      {/* Policies Manager Section */}
      <div className="w-full">
        <PolicyManager
          policies={policies}
          onCreatePolicy={handleCreatePolicy}
          onUpdatePolicy={handleUpdatePolicy}
          onTogglePolicy={handleTogglePolicy}
          onDeletePolicy={handleDeletePolicy}
        />
      </div>
    </div>
  );
}
