# PROJECT-GUIDE.md

A plain-English guide to this project: what it is, how it works, how to demo it,
and how to talk about it in interviews.

---

## 1. What this project is (the 30-second pitch)

**Workflow Execution Engine** is a platform where users build automation workflows
(trigger -> condition -> action) that run as background jobs, not in the browser.
Every run is recorded, can be inspected log by log, retried on failure, and is
covered by an audit trail, security controls and compliance evidence.

Think: "Zapier / n8n style automation, self-hosted, with enterprise security and
multi-tenant SaaS billing layers."

Pitch line for interviews:
> "I built a workflow automation platform: a Next.js console on top of an Express
> API, with a Redis-backed job queue and worker that executes workflows, records
> every run, and supports retries, dead letters, audit logs and compliance reports."

---

## 2. The architecture - 5 boxes

```
 [1] Browser (Next.js 16, port 3001)
        |  REST + JWT + workspace header
        v
 [2] API server (Express 5, port 3000)
        |                 |
 [3] MongoDB          [4] Redis (BullMQ queue)
  (data, rs0)             |
                          v
                   [5] Worker process
                    - execution worker (runs workflow nodes)
                    - webhook delivery worker (HTTP callbacks)
```

- [1] Frontend: Next.js App Router, Tailwind design system, shared api client
  (bearer token + X-Workspace-Id header + automatic 401 refresh).
- [2] API: Express routers per domain (auth, workflows, executions, security,
  compliance, platform, billing, marketplace ...), zod-validated bodies,
  RBAC middleware, audit logging middleware, rate limiting, CORS allowlist.
- [3] MongoDB: users, workspaces, workflows + versions, executions, audit logs,
  secrets, compliance evidence, marketplace listings.
- [4] Redis + BullMQ: the queue. The API only *enqueues* execution jobs; it never
  runs a workflow itself.
- [5] Worker: a separate process that *consumes* jobs and executes workflow nodes
  (webhook, condition, log, HTTP request, agent steps...). Kept separate so slow
  work never blocks the API.

---

## 3. How a workflow run works (the flow you will demo)

1. You click **Run** in `/workflows` and send an input, e.g. `{"amount": 1500}`.
2. The frontend calls `POST /api/workflows/:id/executions` with an `idempotencyKey`
   (a unique id so the same click can never create two runs).
3. The API creates the execution row in MongoDB with status `QUEUING`, then
   enqueues a BullMQ job into Redis, then returns `QUEUED`.
4. The worker picks the job up: `RUNNING (attempt 1)`, executes each node in order
   (start -> condition -> action), and writes the result.
5. Final status is `SUCCEEDED` or `FAILED`. Failures keep the error code/message,
   can be retried, and after exhausting retries land in the **Dead Letter Queue**.
6. Every status change is recorded in `statusHistory`, which powers the
   **Console Logs** tab and the `/executions/:id/logs` endpoint.

Statuses: `QUEUING -> QUEUED -> RUNNING -> SUCCEEDED / FAILED / CANCELLED`.

---

## 4. Demo script (rehearse this exact order)

1. **Login** at `http://localhost:3001` with the demo account. Say: "JWT + refresh
   tokens; every request carries the workspace id."
2. **Workflows -> Run** "Payment Validation Guard" with input `{"amount": 1500}`.
   Say: "runs are queued, not executed in the API - that is the Redis queue."
3. Land on **Executions**: watch `QUEUED -> RUNNING -> SUCCEEDED` (seconds).
   Say: "the worker process consumes the job; the API never blocks."
4. Open the run -> **Console Logs** tab. Say: "every state transition is recorded."
5. Try a bad input (`{"amount": "abc"}`) -> FAILED -> open **Dead Letters**.
   Say: "failed runs are inspectable and replayable - nothing is lost."
6. **Security -> Compliance**: generate a SOC2 report. Say: "evidence is assembled
   from real workspace data: access, changes, encryption, incidents."
7. **Agents**: create an agent (name + system prompt are the only required fields).

---

## 5. The bugs you fixed (interview stories)

Each story has the same shape: symptom -> investigation -> root cause -> fix.
That structure is exactly what interviewers want to hear.

1. **The Run button silently failed (400 "Invalid request body").**
   Traced from the button -> service -> backend zod schema. The API requires an
   `idempotencyKey`; the frontend never sent it. Fix: the service generates a
   UUID key per click.

2. **The whole UI looked washed out / wrong colors.**
   Tailwind v4 only creates utilities for tokens declared in `@theme`; this project
   declared plain CSS variables, so `bg-card`, `text-foreground` etc. produced no CSS.
   Also `dark:` variants followed the OS setting instead of the app theme.
   Fix: `@theme inline` token mapping + class-based `dark` variant.

3. **Compliance page crashed: "Cannot read properties of undefined (reading 'map')".**
   The component expected `report.sections[...]`; the API returns evidence categories
   (accessManagement, encryption...). A frontend/backend contract drift. Fix: render
   the real shape + regression tests.

4. **The webhook pipeline was completely dead.**
   The webhook services existed, but nothing enqueued them and no worker started.
   Fix: enqueue calls wired into the execution lifecycle + webhook worker started.

5. **A tall modal could not be scrolled (top cut off).**
   `flex items-center` + `overflow-y-auto` on the same container - the flexbox
   centering trap. Fix: cap dialog at viewport height, scroll content internally.

6. **Refreshing any page logged you out (the best story).**
   Symptom: press F5 on any app page and you land on the login screen, even though
   the session was valid - but the API log showed the page's own requests were
   authenticated (200/304 with a user id). So the session was fine; the UI was wrong.
   Root cause: two React effects in the shared layout - one restored the session
   from localStorage, the other redirected to /login "if not authenticated". Both
   run in the same commit, so the redirect read the value from *before* the restore.
   Fix: one effect that restores first, then re-reads the store before redirecting.
   Lesson worth saying in interviews: "the server log proved the session was valid,
   which told me the bug had to be client-side state, not auth."

---

## 6. Numbers to quote (verified)

- ~1,080 backend tests passing (107 tests x suites), ~200 frontend tests passing
- ~60 frontend routes, 18 development phases
- Stack: Next.js 16, React 19, Tailwind v4, Express 5, MongoDB (replica set),
  Redis + BullMQ, Socket.IO, zod, JWT
- Run pipeline proven live: input -> queue -> worker -> SUCCEEDED in seconds
- All 37 app pages verified in a real browser: every route loads with real data,
  no crashes and no console errors (sweep run 2026-09-22 evening)

---

## 7. Interview questions (short, honest answers)

**Q: What does this project do?**
A: A workflow automation platform. Users define workflows, the platform runs them as
queued background jobs, records every run with logs, and supports retries, audit
trails and compliance reporting.

**Q: Walk me through the architecture.**
A: Five boxes: Next.js console -> Express API -> MongoDB for data, Redis/BullMQ for
the queue, and a separate worker process that executes the workflows.

**Q: Why a separate worker instead of running workflows in the API?**
A: Long-running work would block HTTP requests and die on deploys. With a queue the
API only enqueues jobs, the worker scales independently, and failed jobs retry
without the user resubmitting.

**Q: What happens when a run fails?**
A: The execution keeps its status history and error code, retries per the retry
policy, and after exhausting retries moves to the dead letter queue where it can be
inspected and replayed.

**Q: How does authentication work?**
A: JWT access tokens with short TTL plus refresh tokens stored hashed in MongoDB.
The frontend attaches token + workspace header and refreshes once on 401 before failing.

**Q: How do you keep tenants separated?**
A: Every workspace-scoped request resolves a workspace id (header) and services
filter queries by it; cross-workspace access returns 404 instead of leaking existence.

**Q: Why idempotency keys?**
A: A user can double-click Run or the network can retry; the key makes creation safe
to repeat. The API rejects bodies without it (strict schema).

**Q: How do you test it?**
A: Backend: supertest against the real Express app with an in-memory Mongo replica
set - about 1,080 tests. Frontend: vitest + Testing Library, plus typecheck and a
production build gate.

**Q: What was the hardest bug?**
A: (pick a story from section 5: symptom -> root cause -> fix)

**Q: What would you improve next?**
A: Real per-node stdout log storage, an MFA setup screen (endpoints exist, UI does
not), and server-side PDF compliance export.

---

## 8. How to run it (short version)

```
docker compose up -d        # MongoDB + Redis
npm run dev:api             # API on :3000
npm run dev:worker          # queue worker
cd frontend && npm run dev -- -p 3001
```

Open http://localhost:3001 and log in. Full details in docs/RUN_GUIDE.md.
