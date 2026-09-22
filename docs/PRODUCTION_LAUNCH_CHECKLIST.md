# Production Launch Checklist (Phase 18)

The go-live checklist for the first paying enterprise customer: environment and
secrets, database, Redis, payments, email, monitoring, backup and rollback. Every item
names the surface that proves it - a step is verified only when the named endpoint,
log line or drill passes, not because the box was ticked.

Sections 1-3 are prerequisites: nothing after them is meaningful until they are green.

## 1. Environment and secrets

| Variable | Requirement | Notes |
| --- | --- | --- |
| `MONGODB_URI` | required | Replica set URI - transactions need one (the compose stack runs `rs0`) |
| `AUTH_JWT_SECRET` | required, >= 32 characters | Validated at boot; startup fails on a short value |
| `WEBHOOK_SECRET_KEY` | required | Signs webhook payloads; unset falls back to a built-in key and raises a HIGH security-audit finding |
| `REDIS_URL` | default `redis://127.0.0.1:6379` | Queues, worker heartbeats and execution state |
| `PORT` | default `3000` | |
| `CORS_ORIGINS` | recommended | Comma-separated allow-list; empty means no cross-origin browser calls |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | defaults `1000` / `60000` | Per-window request budget |

- [ ] `workflow-engine-secrets` created from
      [`deploy/k8s/production/secrets.example.yaml`](../deploy/k8s/production/secrets.example.yaml)
      (never from a committed value).
- [ ] `AUTH_JWT_SECRET` and `WEBHOOK_SECRET_KEY` generated with `openssl rand -base64 48`.
- [ ] No `.env` file ships in the image; configuration arrives through the environment.
- [ ] `GET /health/live` answers 200 on both the API and after a worker restart.

## 2. Database

- [ ] Replica set healthy (`rs.status().ok === 1`); `docker compose up -d mongodb redis`
      is enough locally, managed MongoDB must expose the same contract.
- [ ] `npm run migrate` run against the production database - it performs the legacy
      workspace backfill and reports a per-collection summary.
- [ ] Index verification green: `GET /api/v1/release-readiness/database` reports no
      `FAIL` collections (missing schema-declared indexes).
- [ ] Growth watch noted: audit logs > 50k, agent runs > 100k, workflow executions >
      100k, AI usage > 200k documents trigger archival review.
- [ ] Restore drill passed (see section 7) - a backup that has never been restored is
      not a backup.

## 3. Redis

- [ ] Persistence on (`--appendonly yes` in the compose stack; enable the equivalent
      on managed Redis).
- [ ] `WORKER_INSTANCES` and `WORKER_CONCURRENCY` sized for the launch peak; the
      defaults (`1` and `5`) suit a pilot, not a launch-day spike.
- [ ] `GET /health/ready` green with the worker running - it fails when the worker
      heartbeat is stale or the queue is unreachable.
- [ ] Alert thresholds set: `QUEUE_DEPTH_ALERT_THRESHOLD` (default `100`),
      `WORKER_HEARTBEAT_ALERT_MS` (default `60000`).
- [ ] One end-to-end execution triggered through the queue and observed to completion
      in the execution console.

## 4. Payments

Two providers are implemented: Stripe and Razorpay.

| Provider | Variables |
| --- | --- |
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| Razorpay | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` |

- [ ] Live keys configured for the provider that will take the first payment; the
      other stays unset so it cannot be selected by accident.
- [ ] Webhook endpoints registered with the provider and pointed at the deployment;
      signatures verified with the matching webhook secret.
- [ ] Live-mode smoke test: signup -> subscription -> invoice recorded, using a real
      payment method and refunding it afterwards.
- [ ] Marketplace smoke test: one purchase and one refund; both must appear as
      `MARKETPLACE_PURCHASE_COMPLETED` / `MARKETPLACE_REFUND_RECORDED` audit entries
      and in `GET /api/v1/marketplace/revenue`.
- [ ] Trial wording matches `SAAS_TRIAL_DAYS` (default 14) in the pricing pages.

## 5. Email and notifications

- [ ] `NOTIFICATION_PROVIDER` decided consciously: only `mock` is implemented today -
      selecting `sendgrid`, `ses` or `resend` fails fast with
      `UNSUPPORTED_PROVIDER_OPERATION` instead of pretending to deliver.
- [ ] A launch that promises email either ships the provider implementation or runs
      with `mock` and says so in the onboarding call.
- [ ] Welcome and trial templates verified against `NotificationLogModel` for a fresh
      signup (`WELCOME` recorded, no delivery error).
- [ ] Billing and SLA notifications reach the operator destination used on launch day.

## 6. Monitoring

- [ ] Probes wired: `/health/live` (liveness), `/health/ready` (Mongo, Redis and the
      worker heartbeat), `/health` (dependency report with latency).
- [ ] Logs collected: every request emits a JSON line with `requestId`, `userId`,
      `workspaceId`, `status` and `durationMs` - grep-able by request id across API and
      worker.
- [ ] Operator surfaces reachable: `/enterprise/console` (account, usage, health,
      security, billing, support), `/compliance` (posture from recorded evidence) and
      `/analytics/business` (the book).
- [ ] Alert thresholds set: `AI_COST_SPIKE_USD` (default `10`),
      `READINESS_DROP_THRESHOLD` (default `5`), `OBSERVABILITY_RETENTION_DAYS`
      (default `7`).
- [ ] The SLA sweep is scheduled (`POST /api/v1/support/sla/sweep`) and its runs appear
      as `SUPPORT_SLA_SWEEP_RUN` audit entries.
- [ ] The Phase 12.9 readiness gate passes on the deployed revision:
      `GET /api/v1/release-readiness/readiness` reports `READY`.

## 7. Backup and disaster recovery

- [ ] Logical backup scheduled (`mongodump` or the managed snapshot equivalent) with
      the Redis AOF persisted alongside it.
- [ ] Targets recorded: RTO 4 hours, RPO 24 hours - proven by a restore, not by the
      schedule.
- [ ] DR drill run against the deployed revision:
      `GET /api/v1/release-readiness/disaster-recovery` creates the snapshot, validates
      the checksum and counts, and returns `meetsRto`.
- [ ] Restore into a scratch namespace performed once, with the audit chain verified
      afterwards (`GET /api/v1/release-readiness/security-audit`).

## 8. Rollback

- [ ] Image rollback ready: `kubectl rollout undo` on the API and worker deployments,
      or revert the kustomization image tag for a manifest rollback.
- [ ] Migrations are forward-only backfills, so rolling the image back never requires a
      schema rollback - confirm the previous revision still reads the current schema.
- [ ] Tenant-level containment preferred over data deletion: suspend the workspace
      (`PATCH /api/v1/accounts/:id` status `SUSPENDED`) and keep the records.
- [ ] After any rollback: `/health/ready` green, `/enterprise/console` loading, and the
      SLA sweep still scheduled.

## 9. Launch sequence

1. Secrets in place (section 1) and the readiness gate green on the candidate revision.
2. Database migrated, indexes verified, restore drill recorded (sections 2 and 7).
3. Redis and workers sized, queue depth and heartbeat alerts armed (section 3).
4. Payments live-mode smoke plus marketplace purchase/refund (section 4).
5. Email decision recorded, welcome template observed (section 5).
6. Monitoring and operator surfaces open on the launch call (section 6).
7. Create the customer account record: `POST /api/v1/accounts` with the contract type,
   renewal date, plan, MRR and seats.
8. Walk the customer through onboarding, then resolve the first support ticket end to
   end to prove the SLA path.

## 10. First 24 hours

- [ ] `/enterprise/console` health panel watched for a drop below `WARNING`.
- [ ] Support SLA sweep output reviewed - no unacknowledged breach.
- [ ] Queue depth, worker heartbeat and AI cost alerts quiet.
- [ ] Audit chain verified once more before the day closes.

## References

- Operations runbook: [`docs/PRODUCTION_READINESS.md`](./PRODUCTION_READINESS.md).
- Kubernetes overlay: [`deploy/k8s/production/README.md`](../deploy/k8s/production/README.md).
- Phase 18 architecture: [`PHASE-18-ARCHITECTURE.md`](../PHASE-18-ARCHITECTURE.md).
