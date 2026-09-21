# Load Tests

Executable load scripts for the hot production paths. They are NOT part of the unit
suite - they need a live API, Redis and MongoDB with realistic seed data.

## Prerequisites

1. API running: `npm run dev:api` (or the container image).
2. Redis and MongoDB reachable by the API.
3. Seed data:
   - a published workflow and an API key with `WORKFLOW_EXECUTE` for `executions.load.mjs`
   - a user account for `auth.load.mjs`
   - a JWT + workspace for `governance.load.mjs` and `marketplace.load.mjs`
4. Raised rate limits for the run. Defaults are far below load-test levels:
   - global limiter: 1000 requests / minute
   - API key: 1000 requests / minute, 5000 executions / hour
   - auth login: 5 attempts / 15 minutes
   Start the API with load-test limits (the unit suite uses `loginLimit: 1000`).

## Environment variables

| Variable | Used by | Default |
| --- | --- | --- |
| `BASE_URL` | all | `http://127.0.0.1:3000` |
| `CONCURRENCY` | all | per-script (100 for executions/marketplace) |
| `DURATION_SECONDS` | all | per-script (60 for executions) |
| `API_KEY` | executions | required |
| `WORKFLOW_ID` | executions | required |
| `LOAD_EMAIL` / `LOAD_PASSWORD` | auth | required |
| `TOKEN` / `WORKSPACE_ID` | governance, marketplace | required |
| `SEARCH_QUERY` | marketplace | `automation` |

## Running

```bash
CONCURRENCY=100 DURATION_SECONDS=60 API_KEY=... WORKFLOW_ID=... node tests/load/executions.load.mjs
LOAD_EMAIL=... LOAD_PASSWORD=... node tests/load/auth.load.mjs
TOKEN=... WORKSPACE_ID=... node tests/load/governance.load.mjs
TOKEN=... WORKSPACE_ID=... node tests/load/marketplace.load.mjs
```

Each script prints a JSON summary: requests/sec, error rate and p50/p95/p99/max latency.

## Expected limits (documented targets)

Measured against the production k8s profile (`deploy/k8s/production`: 3 API replicas,
250m-1000m CPU, HPA to 12, worker concurrency 5):

| Scenario | Concurrency | Target p95 | Target error rate | Notes |
| --- | --- | --- | --- | --- |
| Workflow executions | 100 | <= 750 ms | < 1% | enqueue latency; execution itself is async on workers |
| Marketplace search | 100 | <= 400 ms | < 1% | read path, indexed queries |
| Governance evaluation | 50 | <= 500 ms | < 1% | includes model routing decision |
| Auth login | 25 | <= 600 ms | < 1% | requires raised loginLimit |

These targets are consistent with the API performance thresholds used by
`/api/v1/release-readiness/performance` (150-250 ms medians per operation on a single node).

## Reading results

- `429` responses mean the rate limiter engaged - raise limits or lower concurrency.
- `NETWORK_ERROR` means the API refused or dropped connections - check server logs.
- 5xx responses are real failures; inspect server logs with the returned requestId.
- Re-run the release readiness console after tuning to confirm the readiness score improved.
