# Verification Checklist — Audit Fix Round (2026-09-22)

Checklist for confirming every fix from `AUDIT_GAP_REPORT.md`. Commands assume repo root `C:\Users\Durai\workflow-execution-engine` in PowerShell.

## 1. Static verification

- [ ] Backend typecheck: `npm run typecheck` → no errors
- [ ] Frontend typecheck: `cd frontend; npm run typecheck` → no errors
- [ ] Backend tests: `npm test` → 107 files / 1078 tests pass
- [ ] Frontend tests: `cd frontend; npm test` → 21 files / 197 tests pass
- [ ] Frontend build: `cd frontend; npm run build` → succeeds
- [ ] No stale references remain:
  ```powershell
  Select-String -Path frontend\services\*.ts -Pattern 'apiClient2|auth_token|NEXT_PUBLIC_API_BASE_URL|localhost:4000'
  Select-String -Path frontend\features -Recurse -Include *.tsx -Pattern "fetch\('/api/(platform|v1)"
  Select-String -Path frontend\services\securityApi.ts -Pattern 'auth/mfa|generateComplianceReport|exportComplianceReport'
  ```
  All three must return nothing.

## 2. Webhook pipeline (A1)

- [ ] `grep -n configureWebhookDispatch src/services/executionService.ts src/api/server.ts src/workers/startWorker.ts` → config present in all three
- [ ] Start the stack (see `RUN_GUIDE.md`), register a webhook endpoint, execute a workflow
- [ ] Endpoint receives `EXECUTION_STARTED` then `EXECUTION_COMPLETED` (or `EXECUTION_FAILED`) deliveries
- [ ] Dead-letter an execution (retry-exhaust) and replay it → `EXECUTION_FAILED` / `EXECUTION_REPLAYED` events delivered
- [ ] Worker log shows no unhandled rejections from `dispatchExecutionWebhook`

## 3. New backend endpoints (A2, A3)

- [ ] `GET /api/v1/executions/:id/logs` (with Bearer token) returns a JSON array of log entries sorted by timestamp; FAILED runs include an ERROR-level entry
- [ ] `POST /api/v1/ai/operations/suggest-optimizations` with `{ "workspaceId": "..." }` returns 200 with suggestion array; without `AI_OPERATIONS_EXECUTE` permission returns 403

## 4. Frontend contract fixes (B1–B8)

- [ ] Security Center dashboard loads (shared apiClient, `/api/v1/security/dashboard`)
- [ ] Sessions list/revoke work; security policy GET/PUT work
- [ ] Secrets vault: list/create/view/rotate/delete work
- [ ] Compliance: Generate Report renders a report; Export JSON downloads a file; no PDF button
- [ ] Audit Explorer: table loads with auth; export CSV/JSON downloads; Verify Hash Chain returns status
- [ ] Operations console: analytics charts load; AI anomalies and optimization suggestions return data
- [ ] Reports list populates (not blank due to `{reports,total}` envelope)
- [ ] Global platform pages: deployments, metrics, infrastructure, regions, tenants all load with data
- [ ] Workflow comments: list, create, resolve, reopen work
- [ ] Workspace settings: inviting a member succeeds (`/members/invite`)
- [ ] Force a 401 (expire access token) → transparent refresh via `/api/v1/auth/refresh` from any screen

## 5. Docs & env

- [ ] `.env` created from `.env.example` with a real `AUTH_JWT_SECRET`
- [ ] `frontend/.env.local` contains `NEXT_PUBLIC_API_URL=http://localhost:3000`
- [ ] `docs/RUN_GUIDE.md` steps reproduce the stack from clean checkout
- [ ] Remaining risks R1–R5 in `AUDIT_GAP_REPORT.md` reviewed and triaged (accepted or ticketed)
- [ ] Docs audit (Section F of `AUDIT_GAP_REPORT.md`): 18 docs-auditor findings all resolved; README, `.env.example`, phase docs, `frontend/README.md`, `MEMORY.md` re-checked against code

### Docs-audit spot checks
- [ ] `.env.example` includes webhook/stripe/razorpay/SaaS/secret vars and `CORS_ORIGINS=http://localhost:3001`
- [ ] README: Next.js 16 (not 15); `NEXT_PUBLIC_API_URL` has no `/api/v1`; no `NEXT_PUBLIC_APP_URL`; `app/(auth)/` removed from tree; presence described as Socket.IO-only
- [ ] `README` no longer claims a Presence REST API (`/api/v1/presence/*`)
- [ ] `frontend/README.md` is project-specific (port 3001, not boilerplate)
- [ ] Phase status headers reflect "implemented" (PHASE-2D, PHASE-3, PHASE-13-FRONTEND)
- [ ] PHASE-2D JWT decision says jsonwebtoken; PHASE-12.6 test list consolidated
- [ ] `MEMORY.md` link fixed; no broken `phas-5b` references

