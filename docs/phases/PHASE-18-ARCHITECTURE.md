# Phase 18 - Enterprise Production Completion Platform (Architecture Plan)

Status: Implemented and verified.
Branch: phase-2e-production-hardening
Depends on: the enterprise account context (Phase 13 TenantAccountModel + tenantManagementService + WorkspaceModel + SubscriptionModel), customer success (Phase 14.8 customerHealthService, Phase 16.4 customerSuccessService), usage and audit (Phase 13 WorkspaceUsageModel, AuditLogModel + auditService + auditQueryService, Phase 8 securityCenterService + SecurityEventModel, Phase 15 notificationService), SaaS billing (Phase 15.8 businessAnalyticsService and the billing console) and AI governance (Phase 12.6 AIGovernanceGate + AIGovernancePolicyService + ApprovalRequestModel), with the RBAC permission model (auth/permissions.ts) as the access spine.

## 1. Goal

Close the gap between "feature complete" and "sellable to enterprises": named accounts with contracts and renewal dates, a success intelligence that ranks workspaces by what is actually happening inside them, an enterprise support desk with SLA tracking and breach alerts, a compliance center that reports the platform's own posture from recorded evidence, one console that shows an operator the whole account picture, plus the launch checklist and hardening review a real customer onboarding needs.

Hard rule: no rebuilds. Every capability composes delivered services (customer success, health, usage metering, audit, security center, notifications, AI governance, billing analytics) and adds only the records that are missing: the account, the ticket, the SLA policy and the posture report.
## 2. Reuse map (existing asset -> Phase 18 action)

| Existing asset | Phase 18 action |
| --- | --- |
| WorkspaceModel + TenantAccountModel + SubscriptionModel (13) | EnterpriseAccountModel (18.1) is the commercial account record keyed to the workspace; tenant settings and the subscription stay authoritative |
| customerSuccessService (16.4) + customerHealthService (14.8) | CustomerSuccessIntelligenceService (18.2) composes their score with usage, AI adoption, team activity and support issues into HEALTHY / WARNING / CRITICAL |
| WorkspaceUsageModel (13) | Direct source for the usage and workflow-success components - never recomputed |
| notificationService (15) + AuditLogModel | SLA breaches raise SYSTEM notifications and audit entries (18.4) |
| securityCenterService + SecurityEventModel (8) | Security controls section of the compliance center (18.5); no parallel scanner |
| AIGovernancePolicyService + ApprovalRequestModel (12.6) | AI governance compliance section (18.5): policies configured, decisions recorded, approvals pending |
| businessAnalyticsService (15.8) + billing console APIs | Billing panel of the enterprise console (18.6) |
| complianceReportService + auditQueryService (8) | SOC2 / GDPR / ISO evidence stays in the Phase 8 reports; 18.5 adds the ongoing posture view |
## 3. Enterprise account model (18.1)

EnterpriseAccountModel: workspaceId (unique, the account identity), company, industry, accountOwnerId (the platform user who owns the relationship), contractType MONTHLY|ANNUAL|MULTI_YEAR|CUSTOM, subscriptionPlan (mirrors the subscription, reported not enforced), renewalDate, customerStatus TRIAL|ACTIVE|AT_RISK|SUSPENDED|CHURNED, mrr (minor units, nullable), seats (nullable), notes, createdBy.
Indexes: unique workspaceId, (customerStatus, renewalDate), industry, accountOwnerId.

accountManagementService:
- createAccount: one account per workspace; the workspace must exist; audited (ENTERPRISE_ACCOUNT_CREATED).
- listAccounts: filters customerStatus, industry, accountOwnerId, q (company), renewalWithinDays; returns the page plus a summary (counts per status, renewing inside the window) - an empty book reports zeros, never estimates.
- getAccount: by account id or workspaceId, with the workspace name and subscription state joined in.
- updateAccount: status, renewalDate, owner, industry, plan, contract type, mrr, seats, notes; every change audited (ENTERPRISE_ACCOUNT_UPDATED) with the changed fields and the previous status.
- Statuses are explicit operator decisions, not derived from the score: the intelligence score is reported alongside the status, never rewrites it.

Routes: POST /api/v1/accounts, GET /api/v1/accounts, GET /api/v1/accounts/:id, PATCH /api/v1/accounts/:id. All require a platform administrator: the account register spans tenants.
## 4. Customer success intelligence (18.2)

CustomerSuccessIntelligenceService evaluates one workspace and the portfolio:

| Component | Weight | Source |
| --- | --- | --- |
| Usage | 25 | WorkspaceUsageModel: total workflows, 30-day executions, storage pressure |
| Workflow success rate | 25 | WorkspaceUsageModel successRate plus failed executions in the window |
| AI adoption | 20 | AI usage records and the Phase 16.4 adoption list (features actually used) |
| Team activity | 15 | Active users vs members (30-day active window, Phase 16.4 enrichment) |
| Support pressure | 15 | Open tickets, SLA breaches and escalations from 18.3 / 18.4 |

Status: score >= 70 HEALTHY, 40-69 WARNING, < 40 CRITICAL - the thresholds the platform already uses for customer categories, so two screens can never disagree.

Output: { workspaceId, companyName, account (status, plan, renewalDate, owner when an account exists), status, score, components[] (key, label, weight, score, detail), signals, risks[], recommendations[], generatedAt }.

Route: GET /api/v1/customer-success/health (portfolio for platform administrators; ?workspaceId= for one account; a workspace member may read their own workspace).
## 5. Enterprise support and SLA (18.3 / 18.4)

SupportTicketModel: ticketNumber (TCK- prefix, unique), workspaceId, subject, description, category GENERAL|BILLING|TECHNICAL|ACCOUNT|SECURITY, priority LOW|NORMAL|HIGH|URGENT, status OPEN|IN_PROGRESS|WAITING|RESOLVED, createdBy, assigneeId (nullable), slaPolicyId, firstResponseDueAt, resolutionDueAt, firstResponseAt, resolvedAt, resolution, escalationLevel, breached, breachNotifiedAt, tags.
Indexes: unique ticketNumber, (workspaceId, status, createdAt), (status, priority, createdAt), (resolutionDueAt, status), assigneeId.

supportService: create (resolves the SLA policy for the priority, stamps both deadlines, notifies the assignee when one is supplied, audited SUPPORT_TICKET_CREATED), list (workspace members see their own workspace; administrators see all, with filters status, priority, assigneeId, breached, workspaceId), get, update (assignment, status, priority deadline re-scoring, resolution text; the first staff update stamps firstResponseAt; RESOLVED stamps resolvedAt; every transition is audited).

SLAPolicyModel: name (unique), priority, responseTimeMinutes, resolutionTimeMinutes, status ACTIVE|ARCHIVED, description. Defaults are seeded once per priority (LOW 24h/72h, NORMAL 8h/48h, HIGH 4h/24h, URGENT 1h/8h); administrators can archive or add policies, never edit history.

slaMonitoringService: applyDeadlines(ticket), sweep({ now }) - finds tickets past the first-response deadline without a response and unresolved tickets past the resolution deadline, marks them breached, raises the escalation level, writes SLA_BREACH_DETECTED audits and SYSTEM notifications to the assignee (or the creator when unassigned). The sweep is deterministic and idempotent: a ticket is notified once per breach.

Routes: POST /api/v1/support/tickets, GET /api/v1/support/tickets, GET /api/v1/support/tickets/:id, PATCH /api/v1/support/tickets/:id, GET /api/v1/support/sla, POST /api/v1/support/sla/sweep (administrator).
## 6. Compliance center (18.5)

EnterpriseComplianceService reports the posture of one workspace (or the platform for administrators) from recorded evidence only:

| Section | Weight | Evidence |
| --- | --- | --- |
| Audit coverage | 30 | Distinct actions in the audit log against the expected-action checklist for the window; missing actions are listed |
| Security controls | 25 | securityCenterService risk score and SecurityEventModel: open critical events, resolved share, session protections |
| Data access | 20 | Data-access audit entries (exports, deletions, privacy requests) and unresolved privacy requests |
| AI governance | 25 | Governance policies configured, governed decisions (allow / deny / approval) and pending approvals in the window |

Output: { workspaceId, window, score, grade (A-D), sections[] (key, label, weight, score, status OK|WARN|UNKNOWN, findings[]), evidence, generatedAt }. A section without evidence reports UNKNOWN and the aggregate reports the excluded weight - never a fabricated score.

Route: GET /api/v1/compliance/center (administrator; ?workspaceId= for one workspace; a member may read their own).
Frontend: /compliance with ComplianceScore, AuditCoverage and SecurityControls components.

## 7. Enterprise console (18.6)

/enterprise/console is the operator view over one workspace or the whole book: Account overview (18.1), Usage (Phase 13 usage records), Health (18.2), Security (Phase 8 security dashboard), Billing (Phase 15.8 analytics and the billing console) and Support (18.3). The page composes existing endpoints through one console client; each panel states its own window and reports "no data recorded" instead of estimates.

Note: /enterprise already serves the Phase 14 marketing page, so the console lives at /enterprise/console and is linked from the administrator surfaces.
## 8. Security posture review (18.7)

Reviewed in this phase: authentication (JWT + refresh rotation reused, no new auth path), authorization (every new route is guarded: accounts and compliance are administrator-only, support reads are workspace-scoped with 404 for foreign workspaces, SLA sweeps are administrator-only), tenant isolation (account and ticket queries always carry the workspace filter; cross-tenant reads return 404), API security (zod validation on every body, bounded page sizes), secrets handling (no secret is written to tickets, accounts, audits or notifications), and AI governance (the compliance section only reads policy and decision records).

Tests are added only where a surface was not already covered: RBAC denials, cross-workspace isolation and validation failures for the new routes, and the idempotency of the SLA sweep.

## 9. Deliverables

Models (new): EnterpriseAccountModel (18.1), SupportTicketModel (18.3), SLAPolicyModel (18.4).
Services (new): accountManagementService (18.1), customerSuccessIntelligenceService (18.2), supportService (18.3), slaMonitoringService (18.4), enterpriseComplianceService (18.5).
Routes (new): POST|GET /api/v1/accounts, GET|PATCH /api/v1/accounts/:id, GET /api/v1/customer-success/health, POST|GET /api/v1/support/tickets, GET|PATCH /api/v1/support/tickets/:id, GET /api/v1/support/sla, POST /api/v1/support/sla/sweep, GET /api/v1/compliance/center.
Frontend (new): /compliance (ComplianceScore, AuditCoverage, SecurityControls) and /enterprise/console (account, usage, health, security, billing and support panels).
Tests (new): enterpriseAccounts, customerSuccessIntelligence, supportSla, enterpriseCompliance (backend) and enterpriseConsole (frontend).
Docs (new): docs/PRODUCTION_LAUNCH_CHECKLIST.md (environment, database, Redis, payments, email, monitoring, backup, rollback) and the README production sections.
## 10. Access model

- Accounts: platform administrators only (the register spans tenants); a workspace member never sees another account.
- Success intelligence: administrators read the portfolio; members read their own workspace only.
- Support: members create and read their own workspace tickets; administrators assign, resolve and sweep across tenants; a foreign ticket resolves to 404.
- Compliance center: administrators platform-wide; members for their own workspace.
- SLA policies: administrators manage; the seeded defaults are readable so an SLA can be quoted.
- Console: an operator surface - administrator permissions apply to every panel that crosses tenants.

## 11. Non-goals

- No new authentication, SSO, SCIM, billing or AI runtime: Phase 18 only records accounts, tickets, SLA state and posture.
- No external helpdesk, CRM, email or paging integration: alerts are platform notifications and audit entries.
- No fabricated scores: a section without evidence reports UNKNOWN and the aggregate names the excluded weight.
- No automatic account status changes from the score: an operator decides, the score informs.
- No replacement of the Phase 8 SOC2 / GDPR / ISO evidence reports or the Phase 14 marketing pages.

## 12. Testing strategy

Supertest against the real app with an in-memory Mongo replica set. Coverage: account CRUD and status transitions with audits, duplicate-account and cross-tenant 404s, the intelligence score with a seeded healthy and a seeded critical workspace, the ticket lifecycle (create -> assign -> first response -> resolve) with SLA deadline stamping, breach detection and idempotent sweeps, compliance sections with and without evidence, and RBAC denials per surface. Frontend: vitest + Testing Library for the compliance page and the enterprise console with mocked services.

## 13. Implementation order

18.1 accounts -> 18.4 SLA policies + 18.3 tickets -> 18.2 success intelligence (needs support pressure) -> 18.5 compliance center -> 18.6 console -> 18.7 hardening review -> 18.8 launch checklist -> 18.9 quality gate -> 18.10 documentation and final commit.