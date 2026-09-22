# End-to-End Run Guide (Windows / PowerShell)

Brings up the full stack from a clean checkout: MongoDB + Redis, API server, BullMQ execution worker (incl. webhook delivery worker), and the Next.js web UI.

## 0. Prerequisites

- Node.js 20+ (`node -v`)
- MongoDB running locally on `mongodb://localhost:27017` (service or `mongod`)
- Redis running locally on `redis://localhost:6379` — on Windows use Memurai or Docker:

```powershell
# Option A: Docker
docker run -d --name wee-redis -p 6379:6379 redis:7

# Option B: Memurai (Windows-native Redis) — install once, then:
memurai --service-start
```

## 1. Install dependencies

```powershell
cd C:\Users\Durai\workflow-execution-engine
npm install
cd frontend
npm install
cd ..
```

## 2. Configure environment

```powershell
# Backend
Copy-Item .env.example .env
# Generate a strong JWT secret and put it in .env:
$secret = -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 48 | ForEach-Object {[char]$_})
(Get-Content .env) -replace 'AUTH_JWT_SECRET=.*', "AUTH_JWT_SECRET=$secret" | Set-Content .env

# Frontend
Copy-Item frontend\.env.example frontend\.env.local   # contains NEXT_PUBLIC_API_URL=http://localhost:3000
```

Defaults work for local dev: API on port **3000**, web UI on port **3001**.

## 3. Verify before running

```powershell
# Backend: typecheck + full test suite (~2 min)
npm run typecheck
npm test

# Frontend: typecheck + tests + production build
cd frontend
npm run typecheck
npm test
npm run build
cd ..
```

Expected: backend 107 files / 1078 tests green; frontend 21 files / 197 tests green; `next build` succeeds.

## 4. Run the stack (3 terminals)

```powershell
# Terminal 1 — API server (repo root)
cd C:\Users\Durai\workflow-execution-engine
npm run dev:api

# Terminal 2 — execution + webhook worker (repo root)
cd C:\Users\Durai\workflow-execution-engine
npm run dev:worker

# Terminal 3 — web UI
cd C:\Users\Durai\workflow-execution-engine\frontend
npm run dev -- -p 3001
```

Startup order matters less than before, but start Redis/MongoDB first; the worker process now hosts both the execution worker and the webhook delivery worker.

## 5. Smoke checks

```powershell
# API health
Invoke-RestMethod http://localhost:3000/api/v1/health | ConvertTo-Json -Depth 4

# Platform endpoints (previously broken from the UI)
Invoke-RestMethod http://localhost:3000/api/v1/platform/metrics

# Register + login (tokens returned as { accessToken, refreshToken, user })
$body = @{ email = 'admin@example.com'; password = 'Passw0rd!123'; name = 'Admin' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/v1/auth/register -Body $body -ContentType 'application/json'
```

Then open http://localhost:3001, sign in, and exercise the previously broken surfaces:

1. **Executions** → run a workflow → open the execution detail → **Logs tab** renders (new `GET /executions/:id/logs`).
2. **Webhooks** → register a webhook endpoint (e.g. a `https://webhook.site` URL) → run a workflow → confirm `EXECUTION_STARTED` / `EXECUTION_COMPLETED` deliveries arrive (newly wired pipeline).
3. **Security Center** → dashboard, sessions, secrets, compliance report (Generate + Export JSON), audit explorer + chain verification (rewritten `securityApi.ts`).
4. **Operations** → analytics, AI operations anomalies + optimization suggestions (rewritten `operationsApi.ts` + new `suggest-optimizations` route).
5. **Global platform** pages → deployment/metrics/infrastructure/regions/tenants load (apiClient + `/api/v1`).

## 6. Shutdown

`Ctrl+C` in all three terminals. Both server and worker close their BullMQ queues (including the webhook queue) gracefully.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `ECONNREFUSED 127.0.0.1:6379` | Redis not running — see step 0. |
| Frontend 401s everywhere | `frontend\.env.local` missing `NEXT_PUBLIC_API_URL=http://localhost:3000`, or stale tokens — sign out/in. |
| `AUTH_JWT_SECRET` error on boot | `.env` not created or secret unset — see step 2. |
| Webhooks not delivered | Worker terminal must be running (`npm run dev:worker`); check its log for `webhook` enqueue/delivery errors. |
| Port 3000/3001 in use | `Get-NetTCPConnection -LocalPort 3000` then `Stop-Process -Id <PID>`, or change `PORT` in `.env` / `-p` flag. |
