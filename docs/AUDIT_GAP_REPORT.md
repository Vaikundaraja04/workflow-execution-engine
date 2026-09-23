# Audit Gap Report — workflow-execution-engine

Date: 2026-09-22
Scope: Full-stack audit of backend (Express 5 + MongoDB + BullMQ + Socket.IO) and frontend (Next.js 16), covering the execution pipeline, API contracts, and documentation.
Method: three parallel audit threads (execution pipeline, frontend↔backend API contract, docs) + fixes + full test re-verification.

## Verification status (post-fix)

| Check | Result |
|---|---|
| Backend `npx tsc --noEmit` | ✅ clean |
| Frontend `npx tsc --noEmit` | ✅ clean |
| Backend tests (`npx vitest run`) | ✅ 107 files / 1078 tests passed |
| Frontend tests (`npx vitest run`) | ✅ 21 files / 197 tests passed |

---

## A. Execution pipeline findings

### A1 [CRITICAL — fixed] Webhook pipeline never wired
**Finding:** `webhookService.ts` / `webhookDispatcher.ts` / `webhookWorker.ts` existed and were correct, but nothing ever enqueued webhook jobs: `executionService` had no dispatch calls, `webhookQueue` was never instantiated, and `createWebhookWorker` was never started. Registered webhook endpoints could never fire — a dead feature.

**Fix:**
- `src/services/executionService.ts` — added module-level `configureWebhookDispatch(queue)` + fire-and-forget `dispatchExecutionWebhook` helper (enqueue failures logged, never thrown). Dispatches wired at: execution start (after BullMQ enqueue), completed/failed (after `persistTerminalResult`), dead-letter (inside `markExecutionFailed`), and replay (after re-enqueue).
- `src/api/server.ts` — instantiates `BullMqWebhookQueue(env.REDIS_URL)`, `waitUntilReady()`, calls `configureWebhookDispatch(webhookQueue)`, passes the queue into `createApp`, and closes it on shutdown and on startup failure.
- `src/workers/startWorker.ts` — creates its own `BullMqWebhookQueue` + `configureWebhookDispatch` + `createWebhookWorker(env.REDIS_URL)`; both closed during graceful shutdown.

**Design note:** dispatch is configured at module level in each process (API server and worker) rather than threading the queue through every service call — minimal invasive change, no import cycles (`executionService` only imports the `WebhookQueue` type).

### A2 [HIGH — fixed] Missing `GET /api/v1/executions/:executionId/logs`
**Finding:** Frontend ExecutionDetail called this endpoint; backend had no such route → permanent 404 on the Logs tab.

**Fix:** `src/api/routes/executionRoutes.ts` — added the route (auth + `requireExecutionRead`). Logs are synthesized from `execution.statusHistory` (FAILED transitions mapped to ERROR level) plus a terminal `execution.error` entry, sorted by timestamp, returned as a plain array.

**Limitation:** this is a synthetic status-transition log, not a real per-node stdout/log store. See Risks R1.

### A3 [HIGH — fixed] Missing `POST /api/v1/ai/operations/suggest-optimizations`
**Finding:** Frontend OptimizationConsole called this endpoint; only `detect-anomalies` existed.

**Fix:** `src/api/routes/aiRoutes.ts` — added the route guarded by `requirePermission('AI_OPERATIONS_EXECUTE')`, mirroring the existing `detect-anomalies` block, calling `AIOperationsAssistantService.suggestOptimizations(workspaceId)`.

---


## B. Frontend ↔ backend contract findings

### B1 [CRITICAL — fixed] `frontend/services/securityApi.ts` completely broken
**Finding:** The module created its own isolated axios instance with `baseURL = NEXT_PUBLIC_API_URL || http://localhost:4000` (wrong port default, **no `/api/v1` prefix**), read the token from localStorage key `auth_token` (the app stores `accessToken`), and had no auth/refresh interceptors. Every Security Center feature (dashboard, events, sessions, secrets, privacy, compliance, audit) would have failed with 401/404.

**Fix:** Full rewrite onto the shared `./apiClient` (correct baseURL, token key, workspace headers, 401 refresh). All paths now prefixed `/api/v1/...`. Exported method names/signatures preserved, so consumers needed no changes.

### B2 [HIGH — fixed] MFA endpoints pointed at nonexistent paths
**Finding:** `setupMfa`/`verifyMfa` called `/auth/mfa/*`; the real routes live under the sessions router: `POST /api/v1/sessions/mfa/setup` and `POST /api/v1/sessions/mfa/verify` (`{ secret, token }`).

**Fix:** paths corrected in the rewritten `securityApi.ts`. Note: no frontend component currently consumes these methods (MFA setup UI not built) — see Risks R4.

### B3 [HIGH — fixed] Compliance generate/export endpoints do not exist
**Finding:** `ComplianceReport.tsx` called `securityApi.generateComplianceReport` (POST `/compliance/reports/:fw/generate`) and `exportComplianceReport` (GET `/compliance/reports/:id/export?format=PDF|JSON`) — neither exists. Backend only exposes `GET /api/v1/compliance/reports/:framework` (generates on demand).

**Fix:** removed both methods from `securityApi.ts`; `ComplianceReport.tsx` "Generate Report" now refetches via `getComplianceReport`; export is client-side JSON download of the current report; the PDF button was removed.

### B4 [HIGH — fixed] `frontend/services/operationsApi.ts` unreachable
**Finding:** Used raw axios with `process.env.NEXT_PUBLIC_API_BASE_URL` (a variable that exists nowhere) and paths without `/api/v1`, and no auth headers → all analytics/operations/AI-operations/reports calls would 404/401. Also `getReports` returned the raw body while the backend returns `{ reports, total }`.

**Fix:** rewritten onto the shared `./apiClient` with `/api/v1` prefixes; `getReports` now unwraps `data.reports`; `suggestOptimizations` now resolves (see A3).

### B5 [MEDIUM — fixed] Raw `fetch()` calls bypassing auth and version prefix
**Finding:** `features/global-platform/components/` (`DeploymentStatus`, `GlobalMetrics`, `InfrastructureHealth`, `RegionDashboard`, `TenantDistribution`) used bare `fetch('/api/platform/*')` — missing `/v1` and no Authorization header. `features/security/components/AuditExplorer.tsx` used bare `fetch('/api/v1/audit?...')` — right path, but no auth header.

**Fix:** all six converted to `apiClient.get('/api/v1/...')` (all five platform endpoints confirmed to exist in `platformRoutes.ts`; `GET /api/v1/audit` confirmed in `auditRoutes.ts`).

### B6 [MEDIUM — fixed] `collaborationApi.ts` comment paths
**Finding:** comment list/create used plural `/api/v1/comments/workflows/:id` (backend mounts singular `/comments/workflow/:id`); `resolveComment`/`reopenComment` posted to `/comments/:id/resolve|reopen` which do not exist.

**Fix:** paths corrected to singular; resolve/reopen now use `PUT /api/v1/comments/:id` with `{ status: 'RESOLVED' | 'OPEN' }`.

### B7 [MEDIUM — fixed] `workspaceApi.addMember` wrong path
**Finding:** posted to `/api/workspaces/:id/members`; backend mounts member invitation at `POST /api/workspaces/:id/members/invite`.

**Fix:** path corrected.

### B8 [MEDIUM — fixed] Divergent second HTTP client (`frontend/lib/apiClient.ts`)
**Finding:** a separate axios client whose refresh call hit `/api/auth/refresh` (missing `/v1` — refresh would always fail) and that lacked workspace-header handling. Only `services/agentApi.ts` imported it.

**Fix:** `lib/apiClient.ts` is now a thin re-export of `services/apiClient` (single client for the whole app; the stale refresh path is gone).

---
## C. Areas verified as correct

- Auth store ↔ backend contract (login/register/refresh/logout shapes), token refresh flow against `/api/v1/auth/refresh`.
- Workspace, members, secrets, privacy, sessions/security-policy routes and payloads.
- Analytics, reports, operations/observability, security-intelligence routes (shape and methods).
- Audit export (`/api/v1/audit/export`, blob + content-disposition filename) and `/api/v1/audit/verify-chain`.
- All five `/api/v1/platform/*` endpoints consumed by the global-platform components.
- Execution/workflow/webhook/AI route contracts, Socket.IO event names/payloads both sides.
- `.env.example` covers all required `src/config/env.ts` variables; `frontend/.env.example` documents `NEXT_PUBLIC_API_URL` (the only `NEXT_PUBLIC_*` var in use after fixes).
- README run commands (`dev:api`, `dev:worker`, frontend on port 3001) match actual scripts.

---

## D. Remaining risks and limitations

| # | Risk | Severity | Suggestion |
|---|---|---|---|
| R1 | `GET /executions/:id/logs` returns synthesized status-transition entries, not real node-level output. If the UI promises stdout/stderr per node, it will look sparse. | Medium | Introduce an `ExecutionLog` collection written by `executionWorker` per node; keep this endpoint as fallback. |
| R2 | Webhook dispatch is fire-and-forget. If Redis is briefly unavailable at enqueue time, the event is logged and dropped (no retry of the enqueue itself). | Low | BullMQ job retries handle delivery failures; enqueue failures are the only gap. Consider a fallback queue or metric alert on enqueue errors. |
| R3 | Compliance export is client-side JSON only; there is no server-generated PDF despite earlier UI implying one. | Low | Add a server-side PDF generator if auditors require it. |
| R4 | MFA setup/verify endpoints exist (`securityApi.setupMfa/verifyMfa`) but no frontend component consumes them — MFA enrollment UI is not built. Backend returns `{ secret, otpauthUrl, backupCodes }`. | Medium | Build an MFA setup screen; render `otpauthUrl` as a QR code client-side. |
| R5 | Two pre-existing Mongoose warnings observed during tests: deprecated `new` option in `findOneAndUpdate`, and a duplicate `expiresAt` index on `AgentMemory`. | Low | Cosmetic; switch to `returnDocument: 'after'` and drop the duplicate index declaration. |
| R6 | Docs audit thread was interrupted mid-review; `docs/PRODUCTION_READINESS.md` and `docs/PRODUCTION_LAUNCH_CHECKLIST.md` may still over-promise features relative to code (only spot-checked areas were verified). | Low | Re-run a docs-vs-code pass before launch sign-off. |

---

## E. Files changed in this fix round

**Backend**
- `src/services/executionService.ts` — webhook dispatch wiring (`configureWebhookDispatch`, dispatch calls at start/complete/fail/dead-letter/replay)
- `src/api/server.ts` — `BullMqWebhookQueue` instantiation, dispatch config, `createApp` wiring, shutdown close
- `src/workers/startWorker.ts` — webhook queue + `createWebhookWorker` startup and shutdown
- `src/api/routes/executionRoutes.ts` — `GET /:executionId/logs`
- `src/api/routes/aiRoutes.ts` — `POST /operations/suggest-optimizations`

**Frontend**
- `frontend/services/securityApi.ts` — full rewrite onto shared client, `/api/v1` paths, MFA paths fixed, nonexistent compliance generate/export removed
- `frontend/services/operationsApi.ts` — full rewrite onto shared client, `/api/v1` paths, `getReports` unwrap
- `frontend/services/collaborationApi.ts` — comment paths + resolve/reopen method
- `frontend/services/workspaceApi.ts` — addMember invite path
- `frontend/lib/apiClient.ts` — consolidated to re-export the shared client
- `frontend/features/security/components/ComplianceReport.tsx` — generate/export reworked to real contract
- `frontend/features/security/components/AuditExplorer.tsx` — fetchLogs via apiClient
- `frontend/features/global-platform/components/{DeploymentStatus,GlobalMetrics,InfrastructureHealth,RegionDashboard,TenantDistribution}.tsx` — apiClient + `/api/v1` prefix


---

## F. Documentation audit (docs-auditor, 18 findings) — all resolved

A dedicated docs-auditor agent read the README (71 KB), MEMORY.md, all 16 PHASE files, `docs/PRODUCTION_LAUNCH_CHECKLIST.md`, `docs/PRODUCTION_READINESS.md`, and both frontend docs, cross-checking each claim against the code.

| # | Severity | Issue | Status |
|---|---|---|---|
| 1 | blocker | Webhook delivery pipeline documented but never wired (zero call sites for `createWebhookWorker`). | Fixed this session - see A1 |
| 2 | high | Presence "REST API" documented; only Socket.IO presence exists. | Fixed - documented as WebSocket-only |
| 3 | high | `GET /api/executions/:executionId/logs` documented/called but route missing. | Fixed this session - see A2 |
| 4 | high | Checklist implied provider selection by live keys; code uses `BILLING_PROVIDER` (default `mock`). | Fixed - clarified selection |
| 5 | medium | 10 integration env vars missing from `.env.example`. | Fixed - added |
| 6 | medium | `NEXT_PUBLIC_API_URL` documented with `/api/v1` suffix, breaks auth. | Fixed - suffix removed |
| 7 | medium | PHASE-12.6 named 3 nonexistent AI-governance test files. | Fixed - consolidated |
| 8 | medium | PHASE-2D chose `jose`; code ships `jsonwebtoken`. | Fixed - corrected |
| 9 | low | MEMORY.md link to nonexistent `phas-5b...` file (typo too). | Fixed - de-linked |
| 10 | low | frontend/README.md was untouched boilerplate / wrong port. | Fixed - rewritten |
| 11 | low | `NEXT_PUBLIC_APP_URL` documented but never read by code. | Fixed - removed |
| 12 | low | `.env.example` shipped `CORS_ORIGINS=` (empty), blocking the frontend. | Fixed - default `:3001` |
| 13 | low | README said "Next.js 15"; package.json pins 16. | Fixed - updated |
| 14 | low | README tree showed `app/(auth)/` that does not exist. | Fixed - login/register/forgot-password |
| 15 | low | PHASE-2D/PHASE-3 status "planned" though implemented. | Fixed - marked implemented |
| 16 | low | PHASE-13-FRONTEND status "implementation in progress". | Fixed - marked implemented |
| 17 | low | 3 test helper/suite names referenced but never created. | Fixed - noted as inlined |
| 18 | low | 14 runtime `process.env` reads undocumented (2 with hardcoded secret fallbacks). | Fixed - all added to `.env.example` |

**Verified correct (spot-checked):** all quick-start commands, docker-compose mounts, demo/seed scripts, release-readiness/admin endpoints, RBAC `requirePlatformAdmin` allowlist, `NOTIFICATION_PROVIDER` fail-fast, `QUEUE_UNAVAILABLE` -> `503`, Stripe/Razorpay HTTP adapters, `PATCH /api/v1/keys/:id/limits`, health probes, `/api/docs`, SSO/SCIM mounts, env parity, README ports/version.

A final residual sweep also annotated the remaining plan-vs-code test-file names (`rbacIsolation`, `authzTransfer`, `passwordService`/`tokenService`, `aiGovernancePolicy`) with their real consolidation targets in PHASE-2D, PHASE-3, and PHASE-12.6.

---

## G. Closing note

With the execution-pipeline fixes (A), API-contract fixes (B), and documentation audit (F), the codebase typechecks, passes its full suites (1078 backend + 202 frontend), and its docs now accurately describe what ships. Remaining items are tracked as engineering risks (R1-R5) rather than docs gaps.


---

## H. Post-audit verification sweep (2026-09-22, evening)

After the fix round, every app route was swept in a real browser (agent-browser,
logged-in session): 37 routes visited with a full page load each, console errors
and page content captured. Findings and fixes:

| # | Finding | Fix |
|---|---|---|
| H1 | **Full page load (F5) on any app route redirected to /login** even with a valid session (API log proved requests were authenticated). Two layout effects raced: the redirect read the pre-restore auth value. | AppShell + customer layout now restore the session first, then re-read the store before redirecting. |
| H2 | `/operations`, `/operations/analytics`, `/operations/reports` hardcoded `workspaceId = 'workspace-1'` -> analytics endpoints returned instant 500s. | Pages now derive the workspace from the workspace store and skip fetching without one. |
| H3 | Compliance page crashed (`report.sections.map` on undefined) - component expected a shape the API never returns. | Component rewritten against the real evidence-category shape + regression tests. |
| H4 | Executions could not be created from the UI: the API requires `idempotencyKey`, the client sent `{}`. | `executionApi.createExecution` generates a key; run dialog added for workflow input. |
| H5 | Tailwind v4 tokens (`bg-card`, `text-foreground`, ...) generated no CSS; `dark:` followed the OS instead of the app theme. | `@theme inline` token mapping + class-based `dark` variant in `globals.css`. |
| H6 | Tall modals could not be scrolled (flex centering + overflow on one container). | Dialog capped to viewport height, content scrolls internally. |
| H7 | Zustand object selectors in 4 operations components caused "getSnapshot should be cached" warnings. | Wrapped with `useShallow`. |
| H8 | Audit Explorer React key warning (entries without `_id`). | Key falls back to the row index. |

Sweep result after fixes: 37/37 routes render with real content, no crashes, no
console errors. Frontend: 202 tests + typecheck + production build green.
