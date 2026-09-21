# Load Tests

Executable load scripts for the hot production paths. They are NOT part of the unit
suite - they need a live API, Redis and MongoDB with realistic seed data.

Phase 12.10 adds a shared threshold module, a sequenced driver (`run-all.mjs`) that
enforces those thresholds, and a CI workflow (`.github/workflows/load-test.yml`).

## Prerequisites

1. API running: `npm run dev:api`, plus `npm run dev:worker` so queued executions drain.
2. Redis and MongoDB reachable by the API.
3. Raised limits for the run:
   - global limiter: `RATE_LIMIT_MAX`
   - auth login/refresh: `AUTH_LOGIN_LIMIT` / `AUTH_REFRESH_LIMIT`
   - API key: raised by `tests/load/seed.ts` (direct MongoDB bump when `MONGODB_URI`
     is set, otherwise `PATCH /api/v1/keys/:id/limits` up to the API cap).

## Seeding

`npx tsx tests/load/seed.ts`

Registers a load user, logs in, creates and publishes a webhook workflow, issues a
`WORKFLOW_EXECUTE` API key and raises its window limits. It writes
`tests/load/seed-output.json`, which `run-all.mjs` reads to inject `LOAD_EMAIL`,
`LOAD_PASSWORD`, `TOKEN`, `WORKSPACE_ID`, `API_KEY` and `WORKFLOW_ID`.

## Running

Single scenario:

```bash
CONCURRENCY=100 DURATION_SECONDS=60 API_KEY=... WORKFLOW_ID=... node tests/load/executions.load.mjs
LOAD_EMAIL=... LOAD_PASSWORD=... node tests/load/auth.load.mjs
TOKEN=... WORKSPACE_ID=... node tests/load/governance.load.mjs
TOKEN=... WORKSPACE_ID=... node tests/load/marketplace.load.mjs
```

All scenarios in sequence with enforced thresholds (run the seed first):

```bash
node tests/load/run-all.mjs
```

`run-all.mjs` prints a result table, writes per-scenario JSON plus `summary.json` to
`tests/load/results/`, and exits non-zero when any threshold is breached.

## Enforced thresholds (tests/load/thresholds.mjs)

| Scenario | p95 | Error rate | Additional |
| --- | --- | --- | --- |
| Workflow executions | <= 750 ms | < 1% | final queue depth <= 500 (read from `/api/v1/release-readiness/live`) |
| Marketplace search | <= 400 ms | < 1% | - |
| Governance evaluation | <= 500 ms | < 1% | - |
| Auth login | <= 600 ms | < 1% | raised login limit required |

## Environment variables

| Variable | Used by | Default |
| --- | --- | --- |
| `BASE_URL` | all | `http://127.0.0.1:3000` |
| `CONCURRENCY` | all | per-script (100 executions/marketplace, 50 governance, 25 auth) |
| `DURATION_SECONDS` | all | per-script (60 executions, 30 others) |
| `API_KEY` / `WORKFLOW_ID` | executions | from `seed-output.json` |
| `LOAD_EMAIL` / `LOAD_PASSWORD` | auth | from `seed-output.json` |
| `TOKEN` / `WORKSPACE_ID` | governance, marketplace, queue-depth check | from `seed-output.json` |
| `SEARCH_QUERY` | marketplace | `automation` |
| `MONGODB_URI` | seed (direct limit bump) | required for the direct bump |

## CI

`.github/workflows/load-test.yml` runs on `workflow_dispatch` and nightly: MongoDB and
Redis service containers, boots the API and the worker, seeds through
`tests/load/seed.ts`, runs `tests/load/run-all.mjs` and uploads `tests/load/results/`
as artifacts. The job fails on any threshold breach.

## Reading results

- `429` responses mean a limiter engaged - raise limits (see prerequisites) or lower concurrency.
- `NETWORK_ERROR` means the API refused or dropped connections - check server logs.
- 5xx responses are real failures; inspect server logs with the returned requestId.
- Re-run the readiness scan (`POST /api/v1/release-readiness/scan`) after tuning to
  confirm the readiness score improved.
