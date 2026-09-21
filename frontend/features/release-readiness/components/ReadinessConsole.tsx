'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { releaseReadinessApi } from '@/services/releaseReadinessApi';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { SecurityScoreCard } from './SecurityScoreCard';
import { PerformanceCard } from './PerformanceCard';
import { DeploymentStatus } from './DeploymentStatus';
import { DatabaseHealth } from './DatabaseHealth';
import { DRStatus } from './DRStatus';
import type {
  SecurityAuditReportDTO,
  PerformanceBenchmarkReportDTO,
  IndexVerificationReportDTO,
  DisasterRecoveryReadinessDTO,
  DeploymentValidationReportDTO,
  ReadinessReportDTO,
} from '@/types/releaseReadiness';

const VERDICT_CLASSES: Record<ReadinessReportDTO['verdict'], string> = {
  READY: 'bg-green-100 text-green-800',
  NEEDS_ATTENTION: 'bg-yellow-100 text-yellow-800',
  NOT_READY: 'bg-red-100 text-red-800',
};

export function ReadinessConsole() {
  const workspaceId = useWorkspaceStore(
    (state) => state.currentWorkspace?._id ?? state.currentWorkspace?.id ?? undefined
  );
  const [readiness, setReadiness] = useState<ReadinessReportDTO | null>(null);
  const [security, setSecurity] = useState<SecurityAuditReportDTO | null>(null);
  const [database, setDatabase] = useState<IndexVerificationReportDTO | null>(null);
  const [deployment, setDeployment] = useState<DeploymentValidationReportDTO | null>(null);
  const [performance, setPerformance] = useState<PerformanceBenchmarkReportDTO | null>(null);
  const [drill, setDrill] = useState<DisasterRecoveryReadinessDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [readinessData, securityData, databaseData, deploymentData] = await Promise.all([
        releaseReadinessApi.getReadiness(workspaceId),
        releaseReadinessApi.getSecurityAudit(workspaceId),
        releaseReadinessApi.getDatabase(workspaceId),
        releaseReadinessApi.getDeployment(workspaceId),
      ]);
      setReadiness(readinessData);
      setSecurity(securityData);
      setDatabase(databaseData);
      setDeployment(deploymentData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load readiness data');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const runDrill = async () => {
    setBusy(true);
    try {
      setDrill(await releaseReadinessApi.getDisasterRecovery(workspaceId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run the DR drill');
    } finally {
      setBusy(false);
    }
  };

  const runBenchmark = async () => {
    setBusy(true);
    try {
      setPerformance(await releaseReadinessApi.getPerformance(workspaceId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run the benchmark');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div data-testid="readiness-console-loading">Loading readiness data...</div>;
  }
  if (error) {
    return <div data-testid="readiness-console-error">Error: {error}</div>;
  }

  return (
    <div data-testid="readiness-console" className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Production Readiness</h1>
          {readiness ? (
            <p className="text-sm text-gray-500">Generated {readiness.generatedAt}</p>
          ) : null}
        </div>
        {readiness ? (
          <span
            data-testid="readiness-verdict"
            className={`rounded px-3 py-1 text-sm font-semibold ${VERDICT_CLASSES[readiness.verdict]}`}
          >
            {readiness.verdict} - {readiness.score}/100
          </span>
        ) : null}
      </header>

      {readiness ? (
        <div data-testid="readiness-dimensions" className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
          <div className="rounded border bg-white p-3">
            Security
            <span className="block text-xl font-semibold">{readiness.dimensions.security.score}</span>
          </div>
          <div className="rounded border bg-white p-3">
            Database
            <span className="block text-xl font-semibold">{readiness.dimensions.database.score}</span>
          </div>
          <div className="rounded border bg-white p-3">
            Deployment
            <span className="block text-xl font-semibold">{readiness.dimensions.deployment.score}</span>
          </div>
          <div className="rounded border bg-white p-3">
            Queue {readiness.dimensions.queueWorker.passing}/{readiness.dimensions.queueWorker.checks}
            <span className="block text-xl font-semibold">{readiness.dimensions.queueWorker.score}</span>
          </div>
        </div>
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={runDrill}
          disabled={busy}
          className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Run DR drill
        </button>
        <button
          type="button"
          onClick={runBenchmark}
          disabled={busy}
          className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Run benchmark
        </button>
      </div>

      {security ? <SecurityScoreCard report={security} /> : null}
      {deployment ? <DeploymentStatus report={deployment} /> : null}
      {database ? <DatabaseHealth report={database} /> : null}
      {drill ? <DRStatus report={drill} /> : null}
      {performance ? <PerformanceCard report={performance} /> : null}
    </div>
  );
}

export default ReadinessConsole;
