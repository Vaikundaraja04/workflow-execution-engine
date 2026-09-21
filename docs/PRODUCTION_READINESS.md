# Production Readiness Runbook (Phase 12.9)

This runbook covers the release readiness pipeline: security audit, performance
benchmarking, database optimization review, load testing, queue/worker verification,
disaster recovery drill, Kubernetes production deployment and the readiness console.

Everything is machine-readable through `/api/v1/release-readiness/*` and auditable:
every run writes to the immutable audit chain.

## Readiness dimensions and scoring

`GET /api/v1/release-readiness/readiness` aggregates four dimensions into one weighted score:

| Dimension | Source | Weight | Scoring |
| --- | --- | --- | --- |
| Security | `runSecurityAudit` | 40% | `100 - penalties` (CRITICAL 20 / HIGH 10 / MEDIUM 5 / LOW 2, WARN counts half) |
| Database | `getIndexVerificationReport` | 25% | `100 - 25 x FAIL - 10 x WARN collections` |
| Deployment | `validateDeployment` | 25% | `100 - 12 x failed manifest - 10 x failed queue/worker check` |
| Queue/worker | derived from deployment checks | 10% | passing checks / total checks |

Verdict thresholds: `READY` >= 85, `NEEDS_ATTENTION` >= 70, otherwise `NOT_READY`.

## API endpoints

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/api/v1/release-readiness/security-audit` | `SECURITY_READ` | Deterministic audit of 8 security families; writes `SECURITY_AUDIT_COMPLETED` |
| GET | `/api/v1/release-readiness/performance` | `OPERATIONS_MANAGE` | 5-iteration benchmark battery over real data paths; writes `PERFORMANCE_TEST_COMPLETED` |
| GET | `/api/v1/release-readiness/database` | `OPERATIONS_READ` | Schema-declared index verification and growth watch for critical collections |
| GET | `/api/v1/release-readiness/disaster-recovery` | `OPERATIONS_MANAGE` | Snapshot + restore dry-run + recovery estimate; writes `BACKUP_VALIDATED`, `DR_TEST_COMPLETED` |
| GET | `/api/v1/release-readiness/deployment` | `OPERATIONS_READ` | Validates `deploy/k8s/production` manifests and queue/worker wiring |
| GET | `/api/v1/release-readiness/metrics?windowHours=` | `OPERATIONS_READ` | Enterprise metrics (window 1-720h, default 24h) |
| GET | `/api/v1/release-readiness/readiness` | `OPERATIONS_READ` | Weighted aggregate; writes `DEPLOYMENT_READINESS_CHECKED` |

Frontend console: `/platform/readiness` (SecurityScoreCard, PerformanceCard,
DeploymentStatus, DatabaseHealth, DRStatus, with on-demand drill and benchmark actions).

## Security audit

Eight check families; each finding is `{ id, category, title, status: PASS | WARN | FAIL, severity, details }`:

1. **Authentication** - JWT secret present and >= 32 characters (CRITICAL); access TTL <= 1h; refresh TTL <= 45d.
2. **API keys** - ACTIVE keys without expiry (WARN); keys idle > 90 days (WARN); REVOKED keys missing `revokedAt` (FAIL).
3. **RBAC** - OWNER/ADMIN hold every permission; VIEWER limited to read-only; marketplace EDITOR can install but not manage.
4. **AI governance** - budget thresholds ordered and bounded; no disabled model access policy shadowing configurations.
5. **Agent tools** - workspace overrides that blanket-ALLOW dangerous tools (`http_request`, `database_query`, `workflow_trigger`) fail the audit.
6. **Secrets/webhooks** - `WEBHOOK_SECRET_KEY` unset in production fails with the hardcoded fallback key finding; suspiciously short encrypted secrets warn.
7. **Data isolation** - key collections (marketplace, installs, reviews, executions, audit logs) declare `workspaceId`.
8. **Audit coverage** - required action families (`AUTH_LOGIN_SUCCESS`, `AI_GOVERNANCE_DENIED`, `AGENT_LISTING_PUBLISHED`, `SECURITY_AUDIT_COMPLETED`) are registered.

### Remediation quick reference

- Set `AUTH_JWT_SECRET` (>= 32 chars) and `WEBHOOK_SECRET_KEY` from the Kubernetes secret.
- Give every API key an expiry; revoke unused keys.
- Replace dangerous-tool `ALLOW` overrides with `REQUIRE_APPROVAL` (the safe default).

## Performance benchmark

Seven operations (workflow list, execution history, audit query, AI usage aggregation,
marketplace search, governance evaluation, agent run stats), each run 5 times; medians
compared against explicit thresholds (150-250 ms). Verdict: `PASS` at or under threshold,
`WARN` up to 2x, `FAIL` beyond 2x or on error. The report includes the slowest operation
for fast triage.

## Database optimization

- Expected index list per critical collection compared against schema-declared indexes
  (`FAIL` when missing; migrations should add them).
- Growth watch with TTL/archival recommendations: auditlogs > 50k, agentruns > 100k,
  workflowexecutions > 100k, aiusages > 200k documents.

## Disaster recovery drill

`GET /disaster-recovery` creates a snapshot (workspaces, workflows, versions, API keys,
webhooks), validates the checksum and record counts (restore dry-run), and estimates
recovery time as `measured backup time x 2`. Targets: RTO 4 hours, RPO 24 hours.
Evidence returned: backup status/checksum/counts, restore validity, integrity totals,
`meetsRto`.

## Enterprise metrics

`GET /metrics?windowHours=` returns read-only aggregations (window clamped to 1-720h):

- API latency and throughput from the observability service (execution p95, RPM, error rate)
- Workflow throughput: executions, success/failure, success rate, executions per hour
- AI cost: requests, tokens and cost by feature
- Agent execution: runs by status, failure rate, tool call and tool error rate
- Marketplace activity: installs, active installs, reviews, average rating, executions

## Kubernetes production deployment

The production overlay lives in `deploy/k8s/production` (deployments with probes and
security context, HPA, PDB, Service, TLS Ingress, secrets template, kustomization).
Full apply order, verification commands and rollback steps are in
[`deploy/k8s/production/README.md`](../deploy/k8s/production/README.md).

Required secrets (`workflow-engine-secrets`): `mongodb-uri`, `redis-url`,
`auth-jwt-secret` (>= 32 chars), `webhook-secret-key` (>= 32 chars). The last one
removes the HIGH security finding for the fallback encryption key.

`GET /deployment` re-validates the manifests and queue/worker wiring against the
repository on every call, so drift is caught before applying.

## Load testing

Executable scripts in `tests/load` (100-concurrency workflow executions, auth,
governance, marketplace search). Expected limits, environment variables and reading
instructions are in [`tests/load/README.md`](../tests/load/README.md).

## Audit trail

| Action | Written by |
| --- | --- |
| `SECURITY_AUDIT_COMPLETED` | every security audit run |
| `PERFORMANCE_TEST_COMPLETED` | every benchmark run |
| `BACKUP_VALIDATED` | DR drill snapshot validation |
| `DR_TEST_COMPLETED` | DR drill completion |
| `DEPLOYMENT_READINESS_CHECKED` | aggregate readiness report |

## Pre-release checklist

1. Run the security audit; all CRITICAL/HIGH findings resolved or explicitly accepted.
2. Run the performance benchmark; no `FAIL` verdicts.
3. Review the database report; no missing expected indexes.
4. Run the DR drill; backup `VALID`, `meetsRto` true.
5. Validate the deployment report against the release manifests.
6. Execute the relevant load scripts and compare against the expected limits.
7. Confirm the readiness score and record the audit entry in the release ticket.

## Known limitations

- The webhook encryption fallback key is a source-level gap until `WEBHOOK_SECRET_KEY`
  is configured (the audit flags it as HIGH when running in production).
- Metrics are in-process aggregations only - no APM vendor integration by design.
- Load scripts are manual/CI-adjacent, not part of the unit suite (they need a live
  server plus Redis).
