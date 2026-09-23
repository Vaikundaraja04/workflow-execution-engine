import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { apiClient } from '@/services/apiClient';
import { releaseReadinessApi } from '@/services/releaseReadinessApi';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { LiveMetricsPanel } from '@/features/release-readiness/components/LiveMetricsPanel';
import { ReadinessHistoryChart } from '@/features/release-readiness/components/ReadinessHistoryChart';
import { AlertCenter } from '@/features/release-readiness/components/AlertCenter';
import ReadinessPage from '@/app/(app)/platform/readiness/page';
import type {
  LiveMetricsDTO,
  MetricsHistoryDTO,
  ReadinessScanDTO,
  ProductionAlertDTO,
} from '@/types/continuousMonitoring';
import type {
  SecurityAuditReportDTO,
  IndexVerificationReportDTO,
  DeploymentValidationReportDTO,
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
const client = apiClient as unknown as { get: MockFn; post: MockFn };
const workspaceHeaders = { headers: { 'X-Workspace-Id': 'workspace-1' } };
const liveFixture: LiveMetricsDTO = {
  timestamp: '2026-02-01T10:00:00.000Z',
  cpuPercent: 42.5,
  memory: { rssMb: 256, usedMb: 4096, totalMb: 8192, systemUsedPercent: 50 },
  redis: { status: 'up', latencyMs: 2 },
  queue: { available: true, waiting: 3, active: 2, delayed: 0, failed: 0, completed: 120, depth: 3 },
  worker: { available: true, heartbeatAgeMs: 1500, capacity: 5, utilizationPercent: 40 },
  websocket: { available: true, connections: 7 },
  api: { requests: 400, p95Ms: 128.5, errorRatePercent: 0.5 },
  executions: { lastHour: 42, failedLastHour: 2, throughputPerHour: 42, errorRatePercent: 4.8 },
};

const metricsHistoryFixture: MetricsHistoryDTO = {
  resolution: '5m',
  hours: 24,
  points: [
    {
      timestamp: '2026-02-01T09:55:00.000Z',
      cpuPercent: 41.2,
      memoryUsedPercent: 49,
      queueDepth: 3,
      workerUtilizationPercent: 40,
      executionsLastHour: 40,
      executionErrorRatePercent: 4.5,
      apiP95Ms: 120,
      websocketConnections: 6,
    },
    {
      timestamp: '2026-02-01T10:00:00.000Z',
      cpuPercent: 42.5,
      memoryUsedPercent: 50,
      queueDepth: 3,
      workerUtilizationPercent: 40,
      executionsLastHour: 42,
      executionErrorRatePercent: 4.8,
      apiP95Ms: 128.5,
      websocketConnections: 7,
    },
  ],
};
const scanFixtures: ReadinessScanDTO[] = [
  {
    id: 'scan-2',
    workspaceId: 'workspace-1',
    score: 86,
    previousScore: 91,
    delta: -5,
    verdict: 'NEEDS_ATTENTION',
    dimensions: {
      security: { score: 94, failures: 1, warnings: 1 },
      database: { score: 90, verdict: 'WARN', recommendations: 1 },
      deployment: { score: 100, verdict: 'READY' },
      queueWorker: { score: 100, checks: 2, passing: 2 },
    },
    metrics: {
      redisStatus: 'up',
      queueDepth: 3,
      workerAvailable: true,
      workerUtilizationPercent: 40,
      apiP95Ms: 128.5,
      executionsLastHour: 42,
      executionErrorRatePercent: 4.8,
    },
    regressions: ['security failures 0 -> 1'],
    createdAt: '2026-02-01T10:00:00.000Z',
    alerts: { created: ['READINESS_DROP'], updated: [] },
  },
  {
    id: 'scan-1',
    workspaceId: 'workspace-1',
    score: 91,
    previousScore: null,
    delta: null,
    verdict: 'READY',
    dimensions: {
      security: { score: 94, failures: 0, warnings: 1 },
      database: { score: 90, verdict: 'WARN', recommendations: 1 },
      deployment: { score: 100, verdict: 'READY' },
      queueWorker: { score: 100, checks: 2, passing: 2 },
    },
    metrics: {
      redisStatus: 'up',
      queueDepth: 3,
      workerAvailable: true,
      workerUtilizationPercent: 40,
      apiP95Ms: 120,
      executionsLastHour: 40,
      executionErrorRatePercent: 4.5,
    },
    regressions: [],
    createdAt: '2026-02-01T09:00:00.000Z',
    alerts: { created: [], updated: [] },
  },
];
const alertFixtures: ProductionAlertDTO[] = [
  {
    id: 'alert-1',
    type: 'READINESS_DROP',
    severity: 'CRITICAL',
    status: 'OPEN',
    workspaceId: 'workspace-1',
    title: 'Readiness score dropped by 5 points',
    details: 'Readiness score moved from 91 to 86.',
    value: 86,
    threshold: 5,
    scanId: 'scan-2',
    acknowledgedAt: null,
    acknowledgedBy: null,
    createdAt: '2026-02-01T10:00:00.000Z',
    updatedAt: '2026-02-01T10:00:00.000Z',
  },
  {
    id: 'alert-2',
    type: 'QUEUE_OVERLOAD',
    severity: 'WARNING',
    status: 'ACKNOWLEDGED',
    workspaceId: 'workspace-1',
    title: 'Queue depth at 150 jobs',
    details: 'Waiting 145 and delayed 5 jobs exceed the threshold of 100.',
    value: 150,
    threshold: 100,
    scanId: null,
    acknowledgedAt: '2026-02-01T10:05:00.000Z',
    acknowledgedBy: 'user-1',
    createdAt: '2026-02-01T09:30:00.000Z',
    updatedAt: '2026-02-01T10:05:00.000Z',
  },
];
const deploymentFixture: DeploymentValidationReportDTO = {
  generatedAt: '2026-02-01T00:00:00.000Z',
  manifestDirectory: 'deploy/k8s/production',
  files: [{ file: 'api-deployment.yaml', present: true, missing: [], ok: true }],
  queueWorkerChecks: [
    { id: 'src/workers/startWorker.ts', ok: true, details: 'Graceful shutdown and pending execution recovery wired' },
  ],
  score: 100,
  verdict: 'READY',
};

const readinessFixture: ReadinessReportDTO = {
  generatedAt: '2026-02-01T00:00:00.000Z',
  score: 91,
  verdict: 'READY',
  dimensions: {
    security: { score: 94, failures: 0, warnings: 1 },
    database: { score: 90, verdict: 'WARN', recommendations: 1 },
    deployment: { score: 100, verdict: 'READY' },
    queueWorker: { score: 100, checks: 1, passing: 1 },
  },
  deployment: deploymentFixture,
};

const securityFixture: SecurityAuditReportDTO = {
  score: 94,
  generatedAt: '2026-02-01T00:00:00.000Z',
  findings: [],
  severity: { critical: 0, high: 0, medium: 0, low: 0 },
  summary: { total: 0, passed: 0, warnings: 0, failures: 0 },
};

const databaseFixture: IndexVerificationReportDTO = {
  generatedAt: '2026-02-01T00:00:00.000Z',
  collections: [],
  recommendations: [],
  score: 90,
  verdict: 'WARN',
};

describe('Phase 12.10 continuous monitoring API client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requests live metrics and aggregation history for a workspace', async () => {
    client.get.mockResolvedValue({ data: { data: liveFixture } });
    const live = await releaseReadinessApi.getLiveMetrics('workspace-1');
    expect(client.get).toHaveBeenCalledWith('/api/v1/release-readiness/live', workspaceHeaders);
    expect(live.api.p95Ms).toBe(128.5);
    expect(live.worker.utilizationPercent).toBe(40);

    client.get.mockResolvedValue({ data: { data: metricsHistoryFixture } });
    const history = await releaseReadinessApi.getMetricsHistory('workspace-1', {
      resolution: '5m',
      hours: 24,
    });
    expect(client.get).toHaveBeenCalledWith('/api/v1/release-readiness/metrics-history', {
      headers: { 'X-Workspace-Id': 'workspace-1' },
      params: { resolution: '5m', hours: 24 },
    });
    expect(history.points).toHaveLength(2);
    expect(history.resolution).toBe('5m');
  });
  it('requests scan history, triggers scans and manages the alert lifecycle', async () => {
    client.get.mockResolvedValue({ data: { data: { scans: scanFixtures } } });
    const scans = await releaseReadinessApi.getScanHistory('workspace-1', 24);
    expect(client.get).toHaveBeenCalledWith('/api/v1/release-readiness/history', {
      headers: { 'X-Workspace-Id': 'workspace-1' },
      params: { limit: 24 },
    });
    expect(scans[0].score).toBe(86);
    expect(scans[0].delta).toBe(-5);

    client.post.mockResolvedValue({ data: { data: scanFixtures[0] } });
    const scan = await releaseReadinessApi.runReadinessScan('workspace-1');
    expect(client.post).toHaveBeenCalledWith('/api/v1/release-readiness/scan', {}, workspaceHeaders);
    expect(scan.alerts?.created).toEqual(['READINESS_DROP']);

    client.get.mockResolvedValue({ data: { data: { alerts: alertFixtures } } });
    const alerts = await releaseReadinessApi.getAlerts('workspace-1', { status: 'OPEN', limit: 20 });
    expect(client.get).toHaveBeenCalledWith('/api/v1/release-readiness/alerts', {
      headers: { 'X-Workspace-Id': 'workspace-1' },
      params: { status: 'OPEN', limit: 20 },
    });
    expect(alerts[0].severity).toBe('CRITICAL');

    client.post.mockResolvedValue({
      data: { data: { ...alertFixtures[0], status: 'ACKNOWLEDGED', acknowledgedBy: 'user-1' } },
    });
    const acknowledged = await releaseReadinessApi.acknowledgeAlert('alert-1', 'workspace-1');
    expect(client.post).toHaveBeenCalledWith(
      '/api/v1/release-readiness/alerts/alert-1/acknowledge',
      {},
      workspaceHeaders
    );
    expect(acknowledged.status).toBe('ACKNOWLEDGED');
  });
});

describe('Phase 12.10 continuous monitoring components', () => {
  it('renders live metrics and marks unavailable probes honestly', async () => {
    const refresh = vi
      .fn()
      .mockResolvedValue({ ...liveFixture, api: { ...liveFixture.api, requests: 401 } });
    render(
      <LiveMetricsPanel
        snapshot={{
          ...liveFixture,
          redis: { status: 'skipped', latencyMs: 0 },
          websocket: { available: false, connections: null },
        }}
        onRefresh={refresh}
      />
    );

    expect(screen.getByTestId('live-metrics-panel')).toBeInTheDocument();
    expect(screen.getByText('42.5%')).toBeInTheDocument();
    expect(screen.getByText('256 MB')).toBeInTheDocument();
    expect(screen.getByText('skipped')).toBeInTheDocument();
    expect(screen.getByText('n/a')).toBeInTheDocument();
    expect(screen.getByText('128.5 ms')).toBeInTheDocument();
    expect(screen.getByText('healthy (2 s ago)')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('live-metrics-refresh'));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });
  it('renders the readiness history as an SVG trend line with verdict colouring', () => {
    render(<ReadinessHistoryChart scans={scanFixtures} />);

    expect(screen.getByTestId('readiness-history-count')).toHaveTextContent('2 scans');
    expect(screen.getByTestId('readiness-history-line').getAttribute('d')).toContain('M ');
    expect(screen.getByTestId('readiness-point-scan-1')).toBeInTheDocument();
    expect(screen.getByTestId('readiness-point-scan-2')).toBeInTheDocument();
  });

  it('renders an empty state when no scans exist', () => {
    render(<ReadinessHistoryChart scans={[]} />);
    expect(screen.getByText('No readiness scans recorded yet.')).toBeInTheDocument();
  });

  it('renders alerts and acknowledges open ones', async () => {
    const acknowledge = vi.fn().mockResolvedValue(undefined);
    render(<AlertCenter alerts={alertFixtures} onAcknowledge={acknowledge} />);

    expect(screen.getByTestId('alert-center-summary')).toHaveTextContent('1 open / 2 total');
    expect(screen.getByText('Readiness score dropped by 5 points')).toBeInTheDocument();
    expect(screen.getByText('Queue depth at 150 jobs')).toBeInTheDocument();
    expect(screen.getByText('CRITICAL')).toBeInTheDocument();
    expect(screen.getByTestId('alert-center-acknowledged')).toHaveTextContent('1 acknowledged');

    fireEvent.click(screen.getByTestId('acknowledge-alert-1'));
    await waitFor(() => expect(acknowledge).toHaveBeenCalledWith('alert-1'));
  });
});

describe('Phase 12.10 continuous monitoring console', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    useWorkspaceStore.setState({
      currentWorkspace: { _id: 'workspace-1', name: 'Test WS', role: 'OWNER' } as never,
      currentRole: 'OWNER',
    });
  });

  it('composes live metrics, readiness history and the alert center with actions', async () => {
    vi.spyOn(releaseReadinessApi, 'getReadiness').mockResolvedValue(readinessFixture);
    vi.spyOn(releaseReadinessApi, 'getSecurityAudit').mockResolvedValue(securityFixture);
    vi.spyOn(releaseReadinessApi, 'getDatabase').mockResolvedValue(databaseFixture);
    vi.spyOn(releaseReadinessApi, 'getDeployment').mockResolvedValue(deploymentFixture);
    const live = vi.spyOn(releaseReadinessApi, 'getLiveMetrics').mockResolvedValue(liveFixture);
    const history = vi.spyOn(releaseReadinessApi, 'getScanHistory').mockResolvedValue(scanFixtures);
    const alerts = vi.spyOn(releaseReadinessApi, 'getAlerts').mockResolvedValue(alertFixtures);
    const scan = vi.spyOn(releaseReadinessApi, 'runReadinessScan').mockResolvedValue(scanFixtures[0]);
    const acknowledge = vi.spyOn(releaseReadinessApi, 'acknowledgeAlert').mockResolvedValue({
      ...alertFixtures[0],
      status: 'ACKNOWLEDGED',
      acknowledgedBy: 'user-1',
      acknowledgedAt: '2026-02-01T10:05:00.000Z',
    });

    render(<ReadinessPage />);

    expect(await screen.findByTestId('readiness-console')).toBeInTheDocument();
    expect(await screen.findByTestId('live-metrics-panel')).toBeInTheDocument();
    expect(screen.getByTestId('readiness-history-chart')).toBeInTheDocument();
    expect(screen.getByTestId('alert-center')).toBeInTheDocument();
    expect(live).toHaveBeenCalledWith('workspace-1');
    expect(history).toHaveBeenCalledWith('workspace-1', 24);
    expect(alerts).toHaveBeenCalledWith('workspace-1', { limit: 20 });
    alerts.mockResolvedValue([
      {
        ...alertFixtures[0],
        status: 'ACKNOWLEDGED',
        acknowledgedBy: 'user-1',
        acknowledgedAt: '2026-02-01T10:05:00.000Z',
      },
      alertFixtures[1],
    ]);
    fireEvent.click(screen.getByTestId('acknowledge-alert-1'));
    await waitFor(() => expect(acknowledge).toHaveBeenCalledWith('alert-1', 'workspace-1'));
    await waitFor(() =>
      expect(screen.getByTestId('alert-center-summary')).toHaveTextContent('0 open / 2 total')
    );

    fireEvent.click(screen.getByRole('button', { name: 'Run readiness scan' }));
    await waitFor(() => expect(scan).toHaveBeenCalledWith('workspace-1'));
    await waitFor(() => expect(history).toHaveBeenCalledTimes(2));
  });
});