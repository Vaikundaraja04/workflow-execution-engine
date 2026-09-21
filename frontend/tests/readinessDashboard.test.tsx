import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { apiClient } from '@/services/apiClient';
import { releaseReadinessApi } from '@/services/releaseReadinessApi';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { SecurityScoreCard } from '@/features/release-readiness/components/SecurityScoreCard';
import { PerformanceCard } from '@/features/release-readiness/components/PerformanceCard';
import { DeploymentStatus } from '@/features/release-readiness/components/DeploymentStatus';
import { DatabaseHealth } from '@/features/release-readiness/components/DatabaseHealth';
import { DRStatus } from '@/features/release-readiness/components/DRStatus';
import ReadinessPage from '@/app/platform/readiness/page';
import type {
  SecurityAuditReportDTO,
  PerformanceBenchmarkReportDTO,
  IndexVerificationReportDTO,
  DisasterRecoveryReadinessDTO,
  DeploymentValidationReportDTO,
  EnterpriseMetricsReportDTO,
  ReadinessReportDTO,
} from '@/types/releaseReadiness';

vi.mock('@/services/apiClient', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

type MockFn = ReturnType<typeof vi.fn>;
const client = apiClient as unknown as { get: MockFn };
const workspaceHeaders = { headers: { 'X-Workspace-Id': 'workspace-1' } };

const securityFixture: SecurityAuditReportDTO = {
  score: 79,
  generatedAt: '2026-02-01T00:00:00.000Z',
  findings: [
    {
      id: 'auth.jwt-secret',
      category: 'AUTHENTICATION',
      title: 'JWT signing secret strength',
      status: 'PASS',
      severity: 'CRITICAL',
      details: 'Signing secret is at least 32 characters.',
    },
    {
      id: 'secrets.webhook-key',
      category: 'SECRETS',
      title: 'Webhook encryption key configured',
      status: 'WARN',
      severity: 'HIGH',
      details: 'WEBHOOK_SECRET_KEY is unset; the service falls back to a built-in default key.',
    },
    {
      id: 'tools.dangerous-allows',
      category: 'AGENT_TOOLS',
      title: 'Dangerous tools require approval',
      status: 'FAIL',
      severity: 'HIGH',
      details: '1 override(s) allow dangerous tools: http_request.',
    },
  ],
  severity: { critical: 0, high: 2, medium: 0, low: 0 },
  summary: { total: 3, passed: 1, warnings: 1, failures: 1 },
};

const performanceFixture: PerformanceBenchmarkReportDTO = {
  generatedAt: '2026-02-01T00:00:00.000Z',
  workspaceId: 'workspace-1',
  operations: [
    {
      id: 'workflow.list',
      label: 'Workflow listing (50 docs)',
      iterations: 5,
      medianMs: 42.1,
      worstMs: 88.4,
      thresholdMs: 150,
      verdict: 'PASS',
    },
    {
      id: 'audit.query',
      label: 'Audit log query (50 docs)',
      iterations: 5,
      medianMs: 310.5,
      worstMs: 420.2,
      thresholdMs: 200,
      verdict: 'WARN',
    },
  ],
  score: 90,
  verdict: 'WARN',
  slowest: { id: 'audit.query', medianMs: 310.5 },
};

const databaseFixture: IndexVerificationReportDTO = {
  generatedAt: '2026-02-01T00:00:00.000Z',
  collections: [
    {
      collection: 'agentruns',
      count: 15200,
      avgDocumentBytes: 860,
      missingIndexes: [],
      status: 'HEALTHY',
      issues: [],
    },
    {
      collection: 'auditlogs',
      count: 51000,
      avgDocumentBytes: 420,
      missingIndexes: [],
      status: 'WARN',
      issues: ['Collection has 51000 documents (watch threshold 50000).'],
    },
  ],
  recommendations: ['auditlogs: add a TTL index to expire documents outside the retention window.'],
  score: 90,
  verdict: 'WARN',
};

const deploymentFixture: DeploymentValidationReportDTO = {
  generatedAt: '2026-02-01T00:00:00.000Z',
  manifestDirectory: 'deploy/k8s/production',
  files: [
    { file: 'api-deployment.yaml', present: true, missing: [], ok: true },
    { file: 'pdb.yaml', present: true, missing: [], ok: true },
  ],
  queueWorkerChecks: [
    { id: 'src/queues/bullMqExecutionQueue.ts', ok: true, details: 'Queue retry backoff and bounded retention configured' },
    { id: 'src/workers/startWorker.ts', ok: true, details: 'Graceful shutdown and pending execution recovery wired' },
  ],
  score: 100,
  verdict: 'READY',
};

const drFixture: DisasterRecoveryReadinessDTO = {
  generatedAt: '2026-02-01T00:00:00.000Z',
  backupStatus: {
    status: 'VALID',
    createdAt: '2026-02-01T00:00:00.000Z',
    checksum: 'a'.repeat(64),
    counts: { workspaces: 1, apiKeys: 2 },
  },
  restoreTest: { valid: true, checksumValid: true, countsMatch: true, errors: [] },
  recoveryTimeEstimate: {
    measuredBackupMs: 250,
    estimatedRecoveryMs: 500,
    assumedRestoreFactor: 2,
    rtoTargetMs: 14400000,
    rpoTargetMs: 86400000,
    meetsRto: true,
  },
  dataIntegrity: { checksumValid: true, countsMatch: true, totalRecords: 3 },
};

const metricsFixture: EnterpriseMetricsReportDTO = {
  generatedAt: '2026-02-01T00:00:00.000Z',
  workspaceId: 'workspace-1',
  windowHours: 48,
  apiLatency: { executionP95Ms: 412, throughputRpm: 4, errorRatePercent: 1.5 },
  workflowThroughput: {
    executions: 96,
    succeeded: 92,
    failed: 4,
    successRatePercent: 95.8,
    executionsPerHour: 2,
  },
  aiCost: {
    requests: 12,
    tokensUsed: 48000,
    costEstimate: 3.25,
    byFeature: [
      { feature: 'workflow_generation', requests: 8, tokensUsed: 36000, costEstimate: 2.5 },
      { feature: 'failure_analysis', requests: 4, tokensUsed: 12000, costEstimate: 0.75 },
    ],
  },
  agentExecution: {
    totalRuns: 20,
    byStatus: { SUCCEEDED: 18, FAILED: 2 },
    failureRatePercent: 10,
    toolCalls: 44,
    failedToolCalls: 4,
    toolErrorRatePercent: 9.1,
  },
  marketplaceActivity: {
    installsInWindow: 3,
    activeInstalls: 7,
    reviewsInWindow: 2,
    averageRating: 4.5,
    executionsInWindow: 20,
  },
};

const readinessFixture: ReadinessReportDTO = {
  generatedAt: '2026-02-01T00:00:00.000Z',
  score: 91,
  verdict: 'READY',
  dimensions: {
    security: { score: 94, failures: 0, warnings: 2 },
    database: { score: 100, verdict: 'HEALTHY', recommendations: 0 },
    deployment: { score: 100, verdict: 'READY' },
    queueWorker: { score: 100, checks: 2, passing: 2 },
  },
  deployment: deploymentFixture,
};

describe('Phase 12.9 release readiness API client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requests the readiness report and security audit with the workspace header', async () => {
    client.get.mockResolvedValue({ data: { data: readinessFixture } });
    const readiness = await releaseReadinessApi.getReadiness('workspace-1');
    expect(client.get).toHaveBeenCalledWith('/api/v1/release-readiness/readiness', workspaceHeaders);
    expect(readiness.verdict).toBe('READY');
    expect(readiness.dimensions.queueWorker.passing).toBe(2);

    client.get.mockResolvedValue({ data: { data: securityFixture } });
    const audit = await releaseReadinessApi.getSecurityAudit('workspace-1');
    expect(client.get).toHaveBeenCalledWith('/api/v1/release-readiness/security-audit', workspaceHeaders);
    expect(audit.score).toBe(79);
    expect(audit.summary.failures).toBe(1);
  });

  it('requests metrics with an optional window and the remaining reports', async () => {
    client.get.mockResolvedValue({ data: { data: metricsFixture } });
    const metrics = await releaseReadinessApi.getMetrics('workspace-1', 48);
    expect(client.get).toHaveBeenCalledWith('/api/v1/release-readiness/metrics', {
      headers: { 'X-Workspace-Id': 'workspace-1' },
      params: { windowHours: 48 },
    });
    expect(metrics.aiCost.tokensUsed).toBe(48000);

    client.get.mockResolvedValue({ data: { data: databaseFixture } });
    const database = await releaseReadinessApi.getDatabase('workspace-1');
    expect(client.get).toHaveBeenCalledWith('/api/v1/release-readiness/database', workspaceHeaders);
    expect(database.verdict).toBe('WARN');

    client.get.mockResolvedValue({ data: { data: deploymentFixture } });
    const deployment = await releaseReadinessApi.getDeployment('workspace-1');
    expect(client.get).toHaveBeenCalledWith('/api/v1/release-readiness/deployment', workspaceHeaders);
    expect(deployment.verdict).toBe('READY');

    client.get.mockResolvedValue({ data: { data: performanceFixture } });
    const performance = await releaseReadinessApi.getPerformance('workspace-1');
    expect(client.get).toHaveBeenCalledWith('/api/v1/release-readiness/performance', workspaceHeaders);
    expect(performance.operations).toHaveLength(2);

    client.get.mockResolvedValue({ data: { data: drFixture } });
    const drill = await releaseReadinessApi.getDisasterRecovery('workspace-1');
    expect(client.get).toHaveBeenCalledWith('/api/v1/release-readiness/disaster-recovery', workspaceHeaders);
    expect(drill.recoveryTimeEstimate.meetsRto).toBe(true);
  });
});

describe('Phase 12.9 release readiness components', () => {
  it('renders the security score with findings and severity summary', () => {
    render(<SecurityScoreCard report={securityFixture} />);

    expect(screen.getByTestId('security-score')).toHaveTextContent('79');
    expect(screen.getByText(/1 passed \| 1 warnings \| 1 failures/)).toBeInTheDocument();
    expect(screen.getByText('JWT signing secret strength')).toBeInTheDocument();
    expect(screen.getByText('Dangerous tools require approval')).toBeInTheDocument();
    expect(screen.getByText('FAIL')).toBeInTheDocument();
  });

  it('renders the performance battery with thresholds and verdicts', () => {
    render(<PerformanceCard report={performanceFixture} />);

    expect(screen.getByText(/Score 90/)).toBeInTheDocument();
    expect(screen.getByText(/slowest audit.query at 310.5 ms/)).toBeInTheDocument();
    expect(screen.getByText('Workflow listing (50 docs)')).toBeInTheDocument();
    expect(screen.getByText('Audit log query (50 docs)')).toBeInTheDocument();
    expect(screen.getAllByText('WARN').length).toBeGreaterThan(0);
  });

  it('renders deployment validation files and queue checks', () => {
    render(<DeploymentStatus report={deploymentFixture} />);

    expect(screen.getByText('READY (100/100)')).toBeInTheDocument();
    expect(screen.getByText('api-deployment.yaml')).toBeInTheDocument();
    expect(screen.getByText('pdb.yaml')).toBeInTheDocument();
    expect(screen.getByText('Graceful shutdown and pending execution recovery wired')).toBeInTheDocument();
  });

  it('renders database health with growth issues and recommendations', () => {
    render(<DatabaseHealth report={databaseFixture} />);

    expect(screen.getByText('WARN (90/100)')).toBeInTheDocument();
    expect(screen.getByText('auditlogs')).toBeInTheDocument();
    expect(screen.getByText('Collection has 51000 documents (watch threshold 50000).')).toBeInTheDocument();
    expect(screen.getByTestId('database-recommendations')).toBeInTheDocument();
  });

  it('renders the disaster recovery drill evidence', () => {
    render(<DRStatus report={drFixture} />);

    expect(screen.getByText('BACKUP VALID')).toBeInTheDocument();
    expect(screen.getByText('VALID')).toBeInTheDocument();
    expect(screen.getByText('VERIFIED')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('14400s')).toBeInTheDocument();
  });
});

describe('Phase 12.9 release readiness route', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    useWorkspaceStore.setState({
      currentWorkspace: { _id: 'workspace-1', name: 'Test WS', role: 'OWNER' } as never,
      currentRole: 'OWNER',
    });
  });

  it('renders the console with all panels and runs the drill and benchmark on demand', async () => {
    vi.spyOn(releaseReadinessApi, 'getReadiness').mockResolvedValue(readinessFixture);
    vi.spyOn(releaseReadinessApi, 'getSecurityAudit').mockResolvedValue(securityFixture);
    vi.spyOn(releaseReadinessApi, 'getDatabase').mockResolvedValue(databaseFixture);
    vi.spyOn(releaseReadinessApi, 'getDeployment').mockResolvedValue(deploymentFixture);
    const drill = vi.spyOn(releaseReadinessApi, 'getDisasterRecovery').mockResolvedValue(drFixture);
    const benchmark = vi.spyOn(releaseReadinessApi, 'getPerformance').mockResolvedValue(performanceFixture);

    render(<ReadinessPage />);

    expect(await screen.findByTestId('readiness-console')).toBeInTheDocument();
    expect(screen.getByTestId('readiness-verdict')).toHaveTextContent('READY - 91/100');
    expect(screen.getByText('Production Readiness')).toBeInTheDocument();
    expect(screen.getByTestId('security-score-card')).toBeInTheDocument();
    expect(screen.getByTestId('deployment-status')).toBeInTheDocument();
    expect(screen.getByTestId('database-health')).toBeInTheDocument();
    expect(screen.queryByTestId('dr-status')).not.toBeInTheDocument();
    expect(screen.queryByTestId('performance-card')).not.toBeInTheDocument();
    expect(drill).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Run DR drill' }));
    await waitFor(() => expect(screen.getByTestId('dr-status')).toBeInTheDocument());
    expect(drill).toHaveBeenCalledWith('workspace-1');

    fireEvent.click(screen.getByRole('button', { name: 'Run benchmark' }));
    await waitFor(() => expect(screen.getByTestId('performance-card')).toBeInTheDocument());
    expect(benchmark).toHaveBeenCalledWith('workspace-1');
  });
});
