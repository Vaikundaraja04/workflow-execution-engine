# Phase 12.10 - Continuous Production Intelligence & Observability Truth Layer (Architecture Plan)

Status: Implemented and verified - real observability collector (Redis, BullMQ queue, worker heartbeat, WebSocket clients, API latency ring buffer, process CPU/memory), 1-minute metrics pipeline with 5m/1h aggregation and TTL retention, continuous readiness scans with score history and regression detection, production alerting (readiness drop, security regression, queue overload, worker failure, AI cost spike), live metrics/history/scan/alerts endpoints, opt-in READINESS_SCAN_INTERVAL_MS scheduler, CI production-readiness gate + load-test workflow with enforced thresholds, readiness console live metrics/history/alert center, and the sequential load threshold driver are live (backend 857/857, frontend 158/158, root + frontend typechecks green).
Branch: phase-2e-production-hardening
Depends on: 12.9 (release readiness services, readiness console, audit actions, k8s overlay, load scripts), Phase 9 observability (health checks, request logger), collaboration realtime server (Socket.IO + Redis adapter), BullMQ queue metrics, worker heartbeat.

## 1. Goal

Replace simulated operational data with real production telemetry, store it as time series, and turn readiness from a pull-based report into a continuously validated property: scheduled scans, score history, regression detection, production alerting and CI/CD gates that block regressions before they ship.

Objectives:
1. Real observability: Redis, BullMQ queue, worker heartbeat, WebSocket connections, API latency, CPU and memory collected from live probes - no fabricated values.
2. Distributed metrics pipeline: 1-minute snapshots with 5-minute and 1-hour aggregation and a TTL retention policy.
3. Continuous readiness monitor: scheduled scans, score history, regression detection.
4. Production alerting framework: readiness drop, security regression, queue overload, worker failure, AI cost spike.
5. CI/CD production gates: tests, typecheck, security scan, readiness validation, load test thresholds.
6. Executable load testing pipeline with enforced thresholds.
7. Readiness console upgrade: live metrics, history chart, alert center, deployment health.

## 2. Architecture review (what exists, verdict, 12.10 action)

| Existing asset | Verdict | 12.10 action |
| --- | --- | --- |
| ObservabilityService (Phase 9) | Mixed: DB/execution stats real; Redis, queue, worker, WebSocket and system resource checks return mock data | Keep endpoints for compatibility; new collector reads real probes; mock methods documented as deprecated |
| `ExecutionQueue.getMetrics` | Real BullMQ `getJobCounts` | Consume via injected provider |
| `checkRedis` / `checkWorkerAvailability` (observability/health.ts) | Real probes with latency timings | Consume for redis health and worker availability |
| Worker heartbeat | Single availability key with TTL; no per-worker identity | Report heartbeat age and availability; worker capacity derived from configuration (documented limitation) |
| Socket.IO server | Real connections and presence | Report `engine.clientsCount` from `getIO()` |
| requestLogger | Measures real per-request durations, but only writes logs | Add in-process rolling recorder (ring buffer) for p95 and error rate |
| AIUsageModel | Real usage and cost records | Hourly cost window for AI cost spike detection |
| 12.9 readiness services | Real but pull-based | Continuous scans with history and regression detection on top |
| tests/load scripts | Real but manual, no thresholds enforced | Shared threshold module, run-all driver, CI workflow with services |
| .github/workflows/ci.yml | Typecheck, tests, security audit | Kept; add production readiness gate and load threshold workflows |

Review conclusion: the platform already exposes almost every real signal needed (queue counts, redis probe, heartbeat, WS clients, request durations, AI usage). The gap is aggregation, storage, continuous evaluation and CI enforcement - not new probes.

## 3. Deliverables

Backend services (new): observabilityCollectorService, continuousReadinessService, productionAlertService; apiLatencyRecorder (observability module).
Models (new): OperationalMetricModel (time series, TTL retention), ReadinessScanModel (score history), ProductionAlertModel (alert lifecycle).
Routes (extended): /api/v1/release-readiness -> live, metrics-history, history, scan, alerts, alerts/:id/acknowledge.
Audit actions (3): READINESS_SCAN_COMPLETED, PRODUCTION_ALERT_TRIGGERED, PRODUCTION_ALERT_ACKNOWLEDGED.
Scheduler: opt-in interval scans (READINESS_SCAN_INTERVAL_MS) wired in the API server; manual trigger always available.
CI/CD: scripts/ci/production-readiness-gate.ts; .github/workflows/production-readiness.yml; .github/workflows/load-test.yml.
Load pipeline: tests/load/thresholds.mjs, tests/load/run-all.mjs, tests/load/seed.ts, README update.
Frontend: LiveMetricsPanel, ReadinessHistoryChart, AlertCenter, API client + DTOs, console integration.
Tests: backend tests/continuousReadiness.test.ts; frontend tests/continuousMonitoring.test.tsx.

## 4. Real observability collector design

collectSnapshot() reads live probes; every source reports `available: boolean` and honest nulls instead of fabricated values:

| Field | Source | Notes |
| --- | --- | --- |
| cpuPercent | `process.cpuUsage()` delta over wall time | process-level (container CPU) |
| memory.rssMb / systemUsedPercent | `process.memoryUsage()`, `os.totalmem/freemem` | real |
| redis {status, latencyMs} | `checkRedis(redisUrl)` | skipped when redisUrl unconfigured |
| queue {waiting, active, delayed, failed, completed, paused, depth} | `ExecutionQueue.getMetrics()` | real BullMQ job counts |
| worker {available, heartbeatAgeMs, capacity, utilizationPercent} | heartbeat key TTL/age + configured capacity | capacity = WORKER_CONCURRENCY x WORKER_INSTANCES (env, default 5 x 1) |
| websocket {connections} | `getIO()?.engine.clientsCount` | 0 when realtime server not initialised |
| api {requests, p95Ms, errorRatePercent} | in-process ring buffer fed by requestLogger | rolling window of the last 1000 requests |
| executions {lastHour, failedLastHour, throughputPerHour, errorRatePercent} | WorkflowExecutionModel | real DB aggregation |

Providers are injected through `configureObservabilityCollector({ redisUrl, executionQueue, getWorkerHeartbeat, getWebsocketCount, workerCapacity })` so the service is testable and degrades cleanly in unit tests.

## 5. Metrics pipeline and retention

- Storage: OperationalMetricModel - one document per 1-minute snapshot with the collector fields plus `bucketMinute` (floor of timestamp to the minute, unique) so repeated writes in the same minute upsert instead of duplicating.
- Aggregation on read: resolution `1m` returns raw points; `5m` and `1h` group by floor(timestamp / resolution) with average and max aggregation; window bounded to 1-720 hours.
- Retention: TTL index expires snapshots after OBSERVABILITY_RETENTION_DAYS (default 7); manual prune endpoint not needed - documented; longer-horizon storage is a non-goal (no external TSDB).

## 6. Continuous readiness monitor

runScan(workspaceId?, actorUserId?): runs the 12.9 readiness report, collects a live snapshot, compares with the previous scan of the same scope and stores a ReadinessScanModel { score, verdict, dimensions, metrics summary, previousScore, delta, regressions[], createdAt }. Every scan writes READINESS_SCAN_COMPLETED. Scheduler: setInterval started by the API server only when READINESS_SCAN_INTERVAL_MS is set (opt-in, unref'd so tests never hang); POST /scan triggers manually.

## 7. Production alerting framework

| Alert type | Trigger | Default threshold |
| --- | --- | --- |
| READINESS_DROP | scan delta <= -threshold | 5 points |
| SECURITY_REGRESSION | security failures increased vs previous scan | any increase |
| QUEUE_OVERLOAD | waiting + delayed jobs in the live snapshot | 100 jobs |
| WORKER_FAILURE | heartbeat missing or older than threshold while queue is non-empty | 60s |
| AI_COST_SPIKE | AI usage cost in the last hour | 10 USD |

Thresholds are exported constants overridable by env for operators. Dedupe: an OPEN alert of the same type (and workspace scope) is updated with the latest details instead of duplicated; acknowledgement moves it to ACKNOWLEDGED with actor + timestamp. Every creation writes PRODUCTION_ALERT_TRIGGERED; acknowledgement writes PRODUCTION_ALERT_ACKNOWLEDGED.

## 8. CI/CD production gates

- ci.yml (existing, unchanged): install, typecheck, tests, npm audit.
- production-readiness.yml: runs scripts/ci/production-readiness-gate.ts with tsx - validates deploy/k8s/production manifests and queue/worker wiring through releaseReadinessService, runs the static security families and fails on NOT_READY or any FAIL finding.
- load-test.yml: workflow_dispatch + nightly schedule; MongoDB and Redis service containers; boots the API, seeds through tests/load/seed.ts, runs tests/load/run-all.mjs which enforces the shared thresholds and fails the job on breach; uploads the JSON summaries as artifacts.

## 9. Load pipeline thresholds

| Scenario | p95 | Error rate | Additional |
| --- | --- | --- | --- |
| workflow executions | <= 750 ms | < 1% | final queue depth <= 500 |
| marketplace search | <= 400 ms | < 1% | - |
| governance evaluation | <= 500 ms | < 1% | - |
| auth login | <= 600 ms | < 1% | raised login limit required |

run-all.mjs runs the four scenarios sequentially, evaluates thresholds, prints a table and exits non-zero on any breach.

## 10. Frontend upgrade (/platform/readiness)

- LiveMetricsPanel: collector snapshot with refresh button and optional auto-refresh (prop-driven, disabled in tests).
- ReadinessHistoryChart: SVG line chart over scan history with verdict colouring.
- AlertCenter: open/acknowledged alerts with acknowledge action.
- DeploymentHealth: existing DeploymentStatus retained; console composes live metrics + history + alerts + cards.
API client additions: getLiveMetrics, getMetricsHistory, getScanHistory, runReadinessScan, getAlerts, acknowledgeAlert.

## 11. Tests

Backend tests/continuousReadiness.test.ts: collector snapshot from injected providers with honest unavailable reporting; metrics history upsert + 5m/1h aggregation + TTL index assertion; scan history + READINESS_SCAN_COMPLETED; readiness drop regression alert; security regression alert; queue overload, worker failure and AI cost spike evaluation; alert acknowledge + audit; permission matrix (viewer/editor 403 on scan, member 200 on reads).
Frontend tests/continuousMonitoring.test.tsx: API client wiring for the six new endpoints; LiveMetricsPanel, ReadinessHistoryChart and AlertCenter rendering; console integration with live/history/alerts panels.

## 12. Non-goals

- No external TSDB or APM vendor (Prometheus, Grafana, Datadog) integration; signals stay in-process plus MongoDB.
- No per-worker identity registry: the heartbeat stays a single availability key, worker capacity is configuration-derived.
- No outbound alert delivery (email, Slack, PagerDuty); alerts live in the alert center and the audit chain.
- ObservabilityService mock endpoints remain for backward compatibility; only the collector is authoritative for new surfaces.
