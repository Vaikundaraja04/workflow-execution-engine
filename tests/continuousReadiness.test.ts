import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import supertest from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { createApp } from '../src/api/app.js';
import { signAccessToken } from '../src/auth/jwt.service.js';
import { permissionsForRole } from '../src/auth/permissions.js';
import { UserModel } from '../src/models/UserModel.js';
import { WorkspaceModel } from '../src/models/WorkspaceModel.js';
import { WorkspaceMemberModel } from '../src/models/WorkspaceMemberModel.js';
import type { WorkspaceRole } from '../src/models/WorkspaceMemberModel.js';
import { AuditLogModel } from '../src/models/AuditLogModel.js';
import { AIUsageModel } from '../src/models/AIUsageModel.js';
import { APIKeyModel } from '../src/models/APIKeyModel.js';
import { AgentToolPolicyModel } from '../src/models/AgentToolPolicyModel.js';
import { OperationalMetricModel } from '../src/models/OperationalMetricModel.js';
import { ReadinessScanModel } from '../src/models/ReadinessScanModel.js';
import { ProductionAlertModel } from '../src/models/ProductionAlertModel.js';
import { observabilityCollectorService } from '../src/services/observabilityCollectorService.js';
import type { OperationalSnapshot } from '../src/services/observabilityCollectorService.js';
import { productionAlertService } from '../src/services/productionAlertService.js';
import { continuousReadinessService, MIN_READINESS_SCAN_INTERVAL_MS } from '../src/services/continuousReadinessService.js';
import type { ReadinessScanDTO } from '../src/services/continuousReadinessService.js';
import { apiLatencyRecorder } from '../src/observability/apiLatencyRecorder.js';
import type { ExecutionQueue } from '../src/queues/executionQueue.js';

const authConfig = {
  jwtSecret: 'test-jwt-secret-0123456789abcdef',
  accessTtl: '15m',
  refreshTtl: '30d',
};

let replSet: MongoMemoryReplSet;
let request: ReturnType<typeof supertest>;
let workspaceId: string;
let ownerId: string;
let editorId: string;
let viewerId: string;
let ownerToken: string;
let editorToken: string;
let viewerToken: string;
beforeAll(async () => {
  process.env.AUTH_JWT_SECRET = authConfig.jwtSecret;
  process.env.WEBHOOK_SECRET_KEY = 'test-webhook-secret-key-0123456789abcdef';
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  request = supertest(
    createApp({ auth: authConfig, authRateLimit: { loginLimit: 1000, refreshLimit: 1000 } }),
  );
}, 180000);

afterAll(async () => {
  observabilityCollectorService.reset();
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
}, 30000);

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function getReadiness(path: string, token: string, wsId: string = workspaceId) {
  return request
    .get(`/api/v1/release-readiness${path}`)
    .set(authHeader(token))
    .set('X-Workspace-Id', wsId);
}

function postReadiness(path: string, token: string, wsId: string = workspaceId) {
  return request
    .post(`/api/v1/release-readiness${path}`)
    .set(authHeader(token))
    .set('X-Workspace-Id', wsId)
    .send({});
}

function buildSnapshot(
  overrides: { queueDepth?: number; workerAvailable?: boolean; workerAgeMs?: number | null } = {},
): OperationalSnapshot {
  const depth = overrides.queueDepth ?? 0;
  return {
    timestamp: new Date().toISOString(),
    cpuPercent: 12.5,
    memory: { rssMb: 128, usedMb: 4096, totalMb: 8192, systemUsedPercent: 50 },
    redis: { status: 'up', latencyMs: 1 },
    queue: { available: true, waiting: Math.max(0, depth - 5), active: 5, delayed: 5, failed: 0, completed: 100, depth },
    worker: {
      available: overrides.workerAvailable ?? true,
      heartbeatAgeMs: overrides.workerAgeMs ?? 500,
      capacity: 5,
      utilizationPercent: 100,
    },
    websocket: { available: true, connections: 3 },
    api: { requests: 100, p95Ms: 120, errorRatePercent: 0 },
    executions: { lastHour: 40, failedLastHour: 2, throughputPerHour: 40, errorRatePercent: 5 },
  };
}

async function waitForRecordedRequests(): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const { requests } = apiLatencyRecorder.snapshot();
    if (requests > 0) return requests;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return apiLatencyRecorder.snapshot().requests;
}
beforeEach(async () => {
  observabilityCollectorService.reset();
  apiLatencyRecorder.reset();
  await Promise.all([
    OperationalMetricModel.deleteMany({}),
    ReadinessScanModel.deleteMany({}),
    ProductionAlertModel.deleteMany({}),
    AuditLogModel.deleteMany({}),
    AIUsageModel.deleteMany({}),
    APIKeyModel.deleteMany({}),
    AgentToolPolicyModel.deleteMany({}),
    WorkspaceMemberModel.deleteMany({}),
    WorkspaceModel.deleteMany({}),
    UserModel.deleteMany({}),
  ]);

  const stamp = new Types.ObjectId().toString();
  const owner = await UserModel.create({ email: `cpi-owner-${stamp}@test.dev`, passwordHash: 'x' });
  const editor = await UserModel.create({ email: `cpi-editor-${stamp}@test.dev`, passwordHash: 'x' });
  const viewer = await UserModel.create({ email: `cpi-viewer-${stamp}@test.dev`, passwordHash: 'x' });
  ownerId = owner._id.toString();
  editorId = editor._id.toString();
  viewerId = viewer._id.toString();
  ownerToken = signAccessToken(authConfig, { userId: ownerId, email: owner.email });
  editorToken = signAccessToken(authConfig, { userId: editorId, email: editor.email });
  viewerToken = signAccessToken(authConfig, { userId: viewerId, email: viewer.email });

  const workspace = await WorkspaceModel.create({
    name: 'Continuous Intelligence WS',
    slug: `cpi-${stamp}`,
    ownerId: new Types.ObjectId(ownerId),
  });
  workspaceId = workspace._id.toString();

  const members: Array<[string, string, WorkspaceRole]> = [
    [workspaceId, ownerId, 'OWNER'],
    [workspaceId, editorId, 'EDITOR'],
    [workspaceId, viewerId, 'VIEWER'],
  ];
  for (const [wsId, userId, role] of members) {
    await WorkspaceMemberModel.create({
      workspaceId: new Types.ObjectId(wsId),
      userId: new Types.ObjectId(userId),
      role,
      status: 'ACTIVE',
      permissions: permissionsForRole(role),
    });
  }
}, 60000);

describe('Phase 12.10 - observability collector', () => {
  it('collects live probes from injected providers without fabricating values', async () => {
    const queue: ExecutionQueue = {
      enqueue: async () => undefined,
      close: async () => undefined,
      getMetrics: async () => ({
        name: 'workflow-executions',
        isPaused: false,
        counts: { waiting: 7, active: 2, delayed: 3, failed: 1, completed: 40, paused: 0 },
        total: 53,
      }),
    };
    observabilityCollectorService.configure({
      executionQueue: queue,
      workerCapacity: 10,
      workerHeartbeatProvider: async () => ({ available: true, ageMs: 1500 }),
      websocketConnectionsProvider: () => 4,
    });

    const snapshot = await observabilityCollectorService.collectSnapshot();
    expect(snapshot.queue).toEqual({
      available: true,
      waiting: 7,
      active: 2,
      delayed: 3,
      failed: 1,
      completed: 40,
      depth: 10,
    });
    expect(snapshot.worker).toEqual({
      available: true,
      heartbeatAgeMs: 1500,
      capacity: 10,
      utilizationPercent: 20,
    });
    expect(snapshot.websocket).toEqual({ available: true, connections: 4 });
    expect(snapshot.redis).toEqual({ status: 'skipped', latencyMs: 0 });
    expect(snapshot.memory.rssMb).toBeGreaterThan(0);
    expect(snapshot.memory.systemUsedPercent).not.toBeNull();
    expect(snapshot.executions.errorRatePercent).toBe(0);
  });
  it('reports honest nulls when probes are unavailable', async () => {
    const snapshot = await observabilityCollectorService.collectSnapshot();
    expect(snapshot.queue.available).toBe(false);
    expect(snapshot.queue.depth).toBe(0);
    expect(snapshot.worker.available).toBe(false);
    expect(snapshot.worker.heartbeatAgeMs).toBeNull();
    expect(snapshot.worker.utilizationPercent).toBeNull();
    expect(snapshot.websocket).toEqual({ available: false, connections: null });
    expect(snapshot.redis.status).toBe('skipped');
    expect(snapshot.api.errorRatePercent).toBe(0);
  });

  it('feeds api latency from the request pipeline into the snapshot', async () => {
    await request.get('/health/live');
    const recorded = await waitForRecordedRequests();
    expect(recorded).toBeGreaterThan(0);

    const snapshot = await observabilityCollectorService.collectSnapshot();
    expect(snapshot.api.requests).toBeGreaterThan(0);
    expect(snapshot.api.p95Ms).toBeGreaterThan(0);
  });
});

describe('Phase 12.10 - metrics pipeline and retention', () => {
  it('upserts within one minute and aggregates 5m and 1h resolutions', async () => {
    const base = Date.now() - 30 * 60 * 1000;
    const docs = Array.from({ length: 6 }, (_, minute) => {
      const occurred = new Date(base + minute * 60 * 1000);
      return {
        bucketMinute: new Date(Math.floor(occurred.getTime() / 60_000) * 60_000),
        timestamp: occurred,
        cpuPercent: 10 + minute,
        memoryRssMb: 100 + minute,
        memoryUsedPercent: 40 + minute,
        redisStatus: 'up',
        redisLatencyMs: 2,
        queueAvailable: true,
        queueWaiting: minute,
        queueActive: 1,
        queueDelayed: 0,
        queueFailed: 0,
        queueCompleted: 0,
        queueDepth: minute,
        workerAvailable: true,
        workerHeartbeatAgeMs: 100,
        workerCapacity: 5,
        workerUtilizationPercent: 20,
        websocketConnections: 2,
        apiRequests: 10,
        apiP95Ms: 50 + minute,
        apiErrorRatePercent: 0,
        executionsLastHour: 5 + minute,
        executionErrorRatePercent: 0,
        executionThroughputPerHour: 5 + minute,
      };
    });
    await OperationalMetricModel.insertMany(docs);

    const snapshot = await observabilityCollectorService.collectSnapshot();
    await observabilityCollectorService.recordSnapshot(snapshot);
    await observabilityCollectorService.recordSnapshot(snapshot);
    const nowBucket = new Date(Math.floor(Date.now() / 60_000) * 60_000);
    expect(await OperationalMetricModel.countDocuments({ bucketMinute: nowBucket })).toBe(1);

    const raw = await observabilityCollectorService.getMetricsHistory({ resolution: '1m', hours: 2 });
    expect(raw.resolution).toBe('1m');
    expect(raw.points).toHaveLength(7);

    const five = await observabilityCollectorService.getMetricsHistory({ resolution: '5m', hours: 2 });
    expect(five.resolution).toBe('5m');
    expect(five.points.length).toBeGreaterThanOrEqual(2);
    expect(five.points.length).toBeLessThanOrEqual(3);

    const hourly = await observabilityCollectorService.getMetricsHistory({ resolution: '1h', hours: 2 });
    expect(hourly.resolution).toBe('1h');
    expect(hourly.points.length).toBeGreaterThanOrEqual(1);
    expect(hourly.points.length).toBeLessThanOrEqual(2);
  });

  it('registers a TTL retention index on operational metrics', async () => {
    await OperationalMetricModel.ensureIndexes();
    const deadline = Date.now() + 15_000;
    let ttlIndex: { key?: unknown; expireAfterSeconds?: number } | undefined;
    do {
      const indexes = await OperationalMetricModel.collection.indexes();
      ttlIndex = indexes.find((index) => typeof index.expireAfterSeconds === 'number');
      if (!ttlIndex) await new Promise((resolve) => setTimeout(resolve, 250));
    } while (!ttlIndex && Date.now() < deadline);

    expect(ttlIndex).toBeDefined();
    expect(ttlIndex?.expireAfterSeconds).toBeGreaterThan(0);
    expect(ttlIndex?.key).toEqual({ createdAt: 1 });
  }, 30_000);
});

describe('Phase 12.10 - continuous readiness scans', () => {
  it('stores scan history with deltas and emits READINESS_SCAN_COMPLETED', async () => {
    const first = await postReadiness('/scan', ownerToken);
    expect(first.status).toBe(201);
    expect(first.body.data.previousScore).toBeNull();
    expect(first.body.data.delta).toBeNull();
    expect(typeof first.body.data.verdict).toBe('string');
    expect(first.body.data.workspaceId).toBe(workspaceId);
    expect(first.body.data.alerts.created).toHaveLength(0);

    const second = await postReadiness('/scan', ownerToken);
    expect(second.status).toBe(201);
    expect(second.body.data.previousScore).toBe(first.body.data.score);
    expect(second.body.data.delta).toBe(0);

    const history = await getReadiness('/history', editorToken);
    expect(history.status).toBe(200);
    expect(history.body.data.scans).toHaveLength(2);
    expect(history.body.data.scans[0].score).toBe(second.body.data.score);
    expect(history.body.data.scans[1].score).toBe(first.body.data.score);

    expect(await ReadinessScanModel.countDocuments({})).toBe(2);
    expect(await AuditLogModel.countDocuments({ action: 'READINESS_SCAN_COMPLETED' })).toBe(2);
  });
  it('detects readiness drops and security regressions against the previous scan', async () => {
    await ReadinessScanModel.create({
      workspaceId: new Types.ObjectId(workspaceId),
      score: 100,
      verdict: 'READY',
      dimensions: {
        security: { score: 100, failures: 0, warnings: 0 },
        database: { score: 100, verdict: 'HEALTHY', recommendations: 0 },
        deployment: { score: 100, verdict: 'READY' },
        queueWorker: { score: 100, checks: 3, passing: 3 },
      },
      metrics: {
        redisStatus: 'skipped',
        queueDepth: 0,
        workerAvailable: false,
        workerUtilizationPercent: null,
        apiP95Ms: 0,
        executionsLastHour: 0,
        executionErrorRatePercent: 0,
      },
    });
    await APIKeyModel.create({
      workspaceId: new Types.ObjectId(workspaceId),
      name: 'revoked-key',
      keyHash: `hash-${new Types.ObjectId().toHexString()}`,
      keyPrefix: 'cpi_',
      status: 'REVOKED',
      permissions: [],
      createdBy: new Types.ObjectId(ownerId),
    });
    await AgentToolPolicyModel.create({
      workspaceId: new Types.ObjectId(workspaceId),
      toolName: 'http_request',
      policy: 'ALLOW',
      updatedBy: new Types.ObjectId(ownerId),
    });

    const scan = await postReadiness('/scan', ownerToken);
    expect(scan.status).toBe(201);
    expect(scan.body.data.previousScore).toBe(100);
    expect(scan.body.data.delta).toBeLessThanOrEqual(-5);
    expect(
      scan.body.data.regressions.some((entry: string) => entry.startsWith('security failures')),
    ).toBe(true);
    expect(scan.body.data.alerts.created).toEqual(
      expect.arrayContaining(['READINESS_DROP', 'SECURITY_REGRESSION']),
    );

    const alerts = await ProductionAlertModel.find({ status: 'OPEN' }).lean();
    expect(alerts).toHaveLength(2);
    expect(alerts.every((alert) => alert.workspaceId?.toString() === workspaceId)).toBe(true);
    expect(await AuditLogModel.countDocuments({ action: 'PRODUCTION_ALERT_TRIGGERED' })).toBe(2);
  });
});

describe('Phase 12.10 - production alert evaluation', () => {
  it('raises queue overload and worker failure alerts and dedupes repeats', async () => {
    const input = {
      workspaceId,
      score: 90,
      delta: 0,
      securityFailures: 0,
      previousSecurityFailures: 0,
      snapshot: buildSnapshot({ queueDepth: 250, workerAvailable: false, workerAgeMs: null }),
    };
    const first = await productionAlertService.evaluate(input);
    expect(first.created).toEqual(expect.arrayContaining(['QUEUE_OVERLOAD', 'WORKER_FAILURE']));
    expect(first.created).not.toContain('AI_COST_SPIKE');

    const second = await productionAlertService.evaluate(input);
    expect(second.created).toHaveLength(0);
    expect(second.updated).toEqual(expect.arrayContaining(['QUEUE_OVERLOAD', 'WORKER_FAILURE']));
    expect(await ProductionAlertModel.countDocuments({ status: 'OPEN' })).toBe(2);
    expect(await AuditLogModel.countDocuments({ action: 'PRODUCTION_ALERT_TRIGGERED' })).toBe(2);

    const overload = await ProductionAlertModel.findOne({ type: 'QUEUE_OVERLOAD' }).lean();
    expect(overload?.severity).toBe('CRITICAL');
    expect(overload?.value).toBe(250);
    expect(overload?.threshold).toBe(100);
  });
  it('aggregates AI usage cost and alerts on hourly spend spikes', async () => {
    await AIUsageModel.create({
      workspaceId: new Types.ObjectId(workspaceId),
      userId: new Types.ObjectId(ownerId),
      feature: 'workflow_generation',
      tokensUsed: 5000,
      requests: 25,
      costEstimate: 12.5,
    });

    const result = await productionAlertService.evaluate({
      workspaceId,
      score: 90,
      delta: 0,
      securityFailures: 0,
      previousSecurityFailures: 0,
    });
    expect(result.created).toContain('AI_COST_SPIKE');

    const alert = await ProductionAlertModel.findOne({ type: 'AI_COST_SPIKE' }).lean();
    expect(alert?.value).toBe(12.5);
    expect(alert?.threshold).toBe(10);
    expect(alert?.workspaceId?.toString()).toBe(workspaceId);
  });

  it('lists alerts with status and type filters over the API', async () => {
    await productionAlertService.evaluate({
      workspaceId,
      score: 90,
      delta: 0,
      securityFailures: 0,
      previousSecurityFailures: 0,
      snapshot: buildSnapshot({ queueDepth: 150 }),
    });

    const open = await getReadiness('/alerts?status=OPEN', editorToken);
    expect(open.status).toBe(200);
    expect(open.body.data.alerts).toHaveLength(1);
    expect(open.body.data.alerts[0].type).toBe('QUEUE_OVERLOAD');

    const byType = await getReadiness('/alerts?type=QUEUE_OVERLOAD', editorToken);
    expect(byType.body.data.alerts).toHaveLength(1);

    const none = await getReadiness('/alerts?type=AI_COST_SPIKE', editorToken);
    expect(none.body.data.alerts).toHaveLength(0);
  });
});

describe('Phase 12.10 - alert acknowledgement and authorization', () => {
  it('acknowledges alerts with actor tracking and an audit trail', async () => {
    await productionAlertService.evaluate({
      workspaceId,
      score: 90,
      delta: 0,
      securityFailures: 0,
      previousSecurityFailures: 0,
      snapshot: buildSnapshot({ queueDepth: 150 }),
    });
    const alert = await ProductionAlertModel.findOne({ type: 'QUEUE_OVERLOAD' });
    expect(alert).not.toBeNull();
    const alertId = alert?._id.toString();

    const forbidden = await postReadiness(`/alerts/${alertId}/acknowledge`, editorToken);
    expect(forbidden.status).toBe(403);

    const acknowledged = await postReadiness(`/alerts/${alertId}/acknowledge`, ownerToken);
    expect(acknowledged.status).toBe(200);
    expect(acknowledged.body.data.status).toBe('ACKNOWLEDGED');
    expect(acknowledged.body.data.acknowledgedBy).toBe(ownerId);
    expect(acknowledged.body.data.acknowledgedAt).toBeTruthy();
    expect(await AuditLogModel.countDocuments({ action: 'PRODUCTION_ALERT_ACKNOWLEDGED' })).toBe(1);

    const missing = await postReadiness(`/alerts/${new Types.ObjectId()}/acknowledge`, ownerToken);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('PRODUCTION_ALERT_NOT_FOUND');
  });
  it('enforces the permission matrix and serves live metrics to workspace members', async () => {
    const live = await getReadiness('/live', ownerToken);
    expect(live.status).toBe(200);
    expect(live.body.data.redis.status).toBe('skipped');
    expect(live.body.data.queue.available).toBe(false);

    const viewerLive = await getReadiness('/live', viewerToken);
    expect(viewerLive.status).toBe(403);

    const editorHistory = await getReadiness('/history', editorToken);
    expect(editorHistory.status).toBe(200);

    const editorScan = await postReadiness('/scan', editorToken);
    expect(editorScan.status).toBe(403);

    const viewerScan = await postReadiness('/scan', viewerToken);
    expect(viewerScan.status).toBe(403);

    const ownerScan = await postReadiness('/scan', ownerToken);
    expect(ownerScan.status).toBe(201);

    const metrics = await getReadiness('/metrics-history?resolution=5m&hours=6', editorToken);
    expect(metrics.status).toBe(200);
    expect(metrics.body.data.resolution).toBe('5m');

    const invalidResolution = await getReadiness('/metrics-history?resolution=9x', editorToken);
    expect(invalidResolution.body.data.resolution).toBe('1m');
  });
});

describe('Phase 12.10 - readiness scan scheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    continuousReadinessService.stopScheduler();
    delete process.env.READINESS_SCAN_INTERVAL_MS;
  });

  it('refuses to start without a valid scan interval', () => {
    delete process.env.READINESS_SCAN_INTERVAL_MS;
    expect(continuousReadinessService.startScheduler()).toEqual({ started: false, intervalMs: null });

    process.env.READINESS_SCAN_INTERVAL_MS = String(MIN_READINESS_SCAN_INTERVAL_MS - 1);
    expect(continuousReadinessService.startScheduler()).toEqual({ started: false, intervalMs: null });

    process.env.READINESS_SCAN_INTERVAL_MS = 'not-a-number';
    expect(continuousReadinessService.startScheduler()).toEqual({ started: false, intervalMs: null });
    expect(continuousReadinessService.isSchedulerRunning()).toBe(false);
  });
  it('runs scheduled scans on the configured interval and stops cleanly', async () => {
    vi.useFakeTimers();
    process.env.READINESS_SCAN_INTERVAL_MS = '15000';
    const scheduledScan = {
      id: 'scheduled-scan',
      score: 92,
      verdict: 'READY',
      alerts: { created: [], updated: [] },
    } as unknown as ReadinessScanDTO;
    const runScan = vi.spyOn(continuousReadinessService, 'runScan').mockResolvedValue(scheduledScan);

    expect(continuousReadinessService.startScheduler()).toEqual({ started: true, intervalMs: 15000 });
    expect(continuousReadinessService.isSchedulerRunning()).toBe(true);
    expect(continuousReadinessService.startScheduler()).toEqual({ started: false, intervalMs: 15000 });

    await vi.advanceTimersByTimeAsync(15000);
    expect(runScan).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30000);
    expect(runScan).toHaveBeenCalledTimes(3);

    continuousReadinessService.stopScheduler();
    expect(continuousReadinessService.isSchedulerRunning()).toBe(false);

    await vi.advanceTimersByTimeAsync(60000);
    expect(runScan).toHaveBeenCalledTimes(3);
    expect(continuousReadinessService.startScheduler()).toEqual({ started: true, intervalMs: 15000 });
  });
  it('keeps the scheduler alive when a scheduled scan fails', async () => {
    vi.useFakeTimers();
    process.env.READINESS_SCAN_INTERVAL_MS = '15000';
    const runScan = vi.spyOn(continuousReadinessService, 'runScan').mockRejectedValue(new Error('scan failed'));

    continuousReadinessService.startScheduler();
    await vi.advanceTimersByTimeAsync(30000);
    expect(runScan).toHaveBeenCalledTimes(2);
  });
});
