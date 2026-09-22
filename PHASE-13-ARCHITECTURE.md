# Phase 13 - Commercial SaaS Launch & Revenue Platform (Architecture Plan)

Status:
- Backend: Implemented and verified (typecheck clean, 83/83 test files, 894/894 tests).
- Frontend: Implemented and verified (typecheck clean, 15/15 test files, 166/166 tests, production build).
- Phase 14: Go-To-Market / Revenue Engine (product packaging, feature entitlements, lead pipeline, industry solutions, customer health, conversion tracking, payment verification) - implemented and verified (84/84 test files, 920/920 tests). See PHASE-14-ARCHITECTURE.md.
Branch: phase-2e-production-hardening
Depends on: the existing billing foundation (PlanModel + DEFAULT_PLANS, SubscriptionModel, WorkspaceUsageModel, BillingProvider, MockBillingProvider, BillingService, planService quota engine, subscription + billing routes), tenantManagementService, RBAC, the hash-chained audit log, AIUsageModel / AgentRunModel / WorkflowExecutionModel telemetry, WorkspaceModel lifecycle status, notificationService, and the frontend console patterns.

## 1. Goal

Convert the enterprise platform into a commercial SaaS product: self-serve tenant onboarding, subscription and pricing management, usage metering with quotas and overage detection, a multi-provider billing abstraction (Stripe / Razorpay / mock), customer and internal consoles, a sales/demo sandbox, and a marketing front site.

Hard rule: no rebuilds. The workflow engine, AI platform, agents, governance, marketplace, observability and release-readiness modules stay untouched - Phase 13 adds the commercial product layer around them and enforces what already exists (plan limits, entitlements, RBAC, audit).
## 2. Architecture review (what exists, verdict, Phase 13 action)

| Existing asset | Verdict | Phase 13 action |
| --- | --- | --- |
| PlanModel + DEFAULT_PLANS (FREE / STARTER / PROFESSIONAL / ENTERPRISE with PLAN_LIMITS) | Real catalog, seeded on demand | Reuse as THE pricing catalog. The brief's SubscriptionPlanModel maps onto this model - no duplicate is created. The brief's BUSINESS tier maps onto PROFESSIONAL |
| SubscriptionModel (workspace-scoped, plan, status incl. TRIALING, provider IDs, periods, trialEndsAt) | Real | Reuse as THE customer subscription (brief's CustomerSubscriptionModel). Add a trial start helper + lifecycle sweeper |
| BillingProvider interface + MockBillingProvider | Real abstraction, mock-only, BillingService instantiates the mock directly | Keep the interface; add Stripe and Razorpay adapters and a provider registry; BillingService resolves the provider by configuration |
| BillingService (subscribe, upgrade, downgrade, cancel, getUsage, checkFeatureEntitlement) | Real, except recordUsage is a console.log stub | Inject the provider from the registry; implement recordUsage through the new usage metering service |
| planService (getPlan, comparePlanLimits, validateWorkspaceQuota) | Real quota engine enforced per resource | Reuse for quota checks; metering feeds it real numbers |
| subscription + billing routes (plans, subscribe, subscription, upgrade, downgrade, cancel, change-plan, usage, check-feature, webhook) | Real and mounted | Reuse; add the /api/v1/billing/plans catalog alias and a trial start endpoint; provider-verified webhook handling |
| WorkspaceUsageModel | Real counters (workflows, executions, storage) | Reuse as the storage/workflow counter source for metering |
| tenantManagementService (settings, export, delete, hierarchy) | Real | Reuse for tenant settings; new lifecycle state lives in TenantAccountModel |
| WorkspaceModel.status (ACTIVE / SUSPENDED / DELETED) | Real | Reuse for tenant suspension - no parallel flag is introduced |
| Role permissions (OWNER/ADMIN/EDITOR/VIEWER) + requirePermission | Real RBAC | Unchanged source of truth for permissions; entitlements gate plan features, not roles |
| AIUsageModel, AgentRunModel, WorkflowExecutionModel | Real telemetry | Reuse as metering sources - no duplicate tracking |
| Notification service + hash-chained audit log | Real | Reuse for quota alerts and all Phase 13 audit events |
| Frontend console patterns (features/*, services/*Api, app/*) | Real | Follow for /customer, /admin/customers and the marketing pages |
| Next.js default landing page (app/page.tsx boilerplate) | Placeholder | Replaced by the Phase 13 marketing foundation |

Review conclusion: subscriptions, pricing, entitlement checks and quota enforcement already exist from Phase 5. Phase 13 adds the commercial product layer - tenant identity and onboarding, multi-provider billing, metered usage truth, the sales/demo sandbox, customer surfaces and the marketing front - without modifying the runtime modules.
## 3. Deliverables

Models (new): TenantAccountModel, CustomerProfileModel, UsageMeterModel.
Services (new): saasOnboardingService, usageMeteringService, customerManagementService, demoWorkspaceService, subscriptionLifecycleService; billing adapters stripeBillingProvider, razorpayBillingProvider, billingProviderRegistry.
Routes (new): /api/v1/saas (signup, onboarding, account, customers, suspend/reactivate, notes), /api/v1/usage (+ history), /api/v1/demo (create, reset); billing additions (plans alias, trial).
Middleware (new): requireEntitlement + tenant-status guard.
Frontend (new): /customer console, /admin/customers console, marketing pages (/, /pricing, /features, /solutions, /enterprise, /documentation).
Tests (new): saasOnboarding, billing, usageMetering, customerManagement, demoEnvironment; customerConsole frontend test.

## 4. SaaS onboarding (13.1)

Models:
- TenantAccountModel: workspaceId (unique), ownerUserId, companyName, status (TRIALING | ACTIVE | SUSPENDED | CLOSED), plan, subscriptionId, region, trialEndsAt, demo flag, onboarding { completed, steps[], startedAt, completedAt }, emailVerifiedAt (verification-ready placeholder).
- CustomerProfileModel: tenantId (unique), contact name/email/phone, company, billing address, tax id, timezone, locale, supportNotes[].

Flow - POST /api/v1/saas/signup { email, password, name, companyName, workspaceName?, useCase? }:
1. Reuse the existing auth hashing/registration helpers to create the user (duplicate email -> 409).
2. Create the workspace, slug unique, owner membership with OWNER role and full permissions.
3. Create the TenantAccount (TRIALING, SAAS_TRIAL_DAYS) and CustomerProfile.
4. Create the subscription through the existing BillingService using the selected plan (FREE by default, configured trial).
5. Install starter templates (built-in catalog rendered through the existing workflow creation service) and apply default tenant settings.
6. Audit SAAS_SIGNUP_COMPLETED; return session tokens + tenant/workspace identifiers.

POST /api/v1/saas/onboarding { steps, completed } records wizard progress and writes SAAS_ONBOARDING_COMPLETED.
GET /api/v1/saas/account returns tenant + profile + subscription + usage snapshot for the caller's workspace (tenant isolation enforced by workspace context).
## 5. Subscription & pricing (13.2)

All lifecycle endpoints already exist and are reused. Additions: startTrial(workspaceId, days) in BillingService (provider createSubscription with trialEnd), the GET /api/v1/billing/plans alias, and plan-change metadata corrections (previous plan captured before mutation). The catalog stays PlanModel-driven; the brief's BUSINESS tier maps to PROFESSIONAL and is documented in the API response.

## 6. Usage metering (13.3)

UsageMeterModel: workspaceId, metric (EXECUTIONS | AI_TOKENS | AGENT_RUNS | STORAGE_BYTES | API_REQUESTS), granularity (DAY | MONTH), periodKey (YYYY-MM-DD or YYYY-MM), value, limit, percent, alertState (OK | WARNING | EXCEEDED), unique (workspaceId, metric, granularity, periodKey).

usageMeteringService:
- record(metric, quantity) increments the day and month buckets.
- syncFromSources() recomputes buckets from real telemetry: executions from WorkflowExecutionModel, AI tokens from AIUsageModel, agent runs from AgentRunModel, storage from WorkspaceUsageModel, API requests from the in-process latency recorder.
- getSummary() joins current-period buckets with PLAN_LIMITS for quota status, overage (value > limit), and alert state (>=80% warning, >=100% exceeded).
- getHistory(days) returns daily buckets for charts.
Quota alerts: crossing 80% or 100% raises a notification (existing notificationService) and audits USAGE_QUOTA_ALERT_RAISED, deduplicated per metric/period/state.
Routes: GET /api/v1/usage, GET /api/v1/usage/history?days=n.
## 7. Customer + internal consoles (13.4, 13.6)

/customer: AccountOverview, SubscriptionCard (plan, status, trial, period, change/cancel actions), UsageDashboard (meter bars vs plan limits), InvoiceHistory (provider invoices; the mock provider synthesizes deterministic invoices), SecuritySettings (reuse existing session/security surfaces).
/admin/customers: tenant list with plan, status, usage headline, health score (subscription state + usage pressure + recent activity), suspend/reactivate actions and support notes; served by customerManagementService with admin-only access.

## 8. Demo & sales environment (13.5)

demoWorkspaceService.create() provisions an isolated sandbox: demo workspace (settings.demo = true, demoExpiresAt), demo owner user, starter + demo workflows, one sample AI agent, FREE/trial subscription, TenantAccount flagged demo. reset(workspaceId) wipes demo artifacts (workflows, executions, agents, runs) and re-seeds. Demo tenants are ordinary workspaces under the hood, so workspace scoping keeps them isolated from real customers. POST /api/v1/demo/create is public but rate-limited; POST /api/v1/demo/reset is restricted to the demo owner or platform admins. An opt-in interval (DEMO_RESET_INTERVAL_MS) expires stale sandboxes.

## 9. Billing providers (13.7)

Registry: createBillingProvider(name) resolves mock | stripe | razorpay; BILLING_PROVIDER selects the default (mock unless configured). StripeBillingProvider and RazorpayBillingProvider implement the existing BillingProvider contract over fetch + node crypto (no SDK dependencies): customer and subscription lifecycle, invoices, payment intents, and webhook signature verification (Stripe t/v1 HMAC-SHA256, Razorpay X-Razorpay-Signature HMAC-SHA256). Missing credentials fail fast with configuration errors instead of fabricating data. The webhook route verifies through the active provider and updates subscriptions via the existing handler.
## 10. SaaS security (13.8)

- Tenant suspension: reuse WorkspaceModel.status. A requireActiveTenant guard in the workspace-context middleware returns 403 TENANT_SUSPENDED for suspended tenants; TenantAccountModel.status mirrors it. Admin suspend/reactivate endpoints audit TENANT_SUSPENDED / TENANT_REACTIVATED.
- Subscription expiry: subscriptionLifecycleService.sweep() marks subscriptions EXPIRED past currentPeriodEnd (and PAST_DUE after a grace window), downgrades entitlements to FREE limits and audits SUBSCRIPTION_EXPIRED. Opt-in server interval (SUBSCRIPTION_SWEEP_INTERVAL_MS, unref'd).
- Entitlements: requireEntitlement(feature) middleware backed by BillingService.checkFeatureEntitlement; 403 FEATURE_NOT_ENTITLED. This complements RBAC - roles keep granting permissions, entitlements gate plan features.
- Usage limits: validateWorkspaceQuota stays the enforcement point, fed by metering.
## 11. Marketing site (13.9)

Static pages replace the Next.js default landing: / (outcome-led hero: AI workflow automation, AI agents, self-healing automation, enterprise governance), /pricing (catalog mirroring DEFAULT_PLANS), /features, /solutions, /enterprise, /documentation. Shared marketing components, updated root metadata, links into /register and /login.

## 12. Tests (13.10)

- saasOnboarding: signup creates user + workspace + owner membership + tenant account + profile + trial subscription + starter workflows + audit; duplicate email 409; onboarding step completion; account scoping.
- billing: catalog, subscribe + trial, change plan (captured previous plan), cancel, provider registry selection, entitlement checks, audit events.
- usageMetering: record + day/month aggregation, 80%/100% thresholds and alerts, overage flags, history endpoint, plan-limit join.
- customerManagement: admin listing + detail with health, suspend blocks tenant APIs, reactivate restores, support notes, non-admin 403.
- demoEnvironment: sandbox creation with starter content, isolation from real tenants, reset reseeds, demo flags.
- customerConsole (frontend): API client wiring + console component rendering with fixture data.
## 13. Frontend delivery (implemented and verified)

Design reference: PHASE-13-FRONTEND-ARCHITECTURE.md. Every screen renders an existing Phase 13 API through the existing services/apiClient + services/customerApi; no backend changes and no fixture data in product code.

### Routes

| Route | Purpose | Primary components |
| --- | --- | --- |
| / | Marketing home (replaces the Next.js boilerplate) | MarketingShell, MarketingHero, FeatureGrid, CallToAction |
| /pricing | Live plan catalog from GET /api/v1/billing/plans | MarketingShell, pricing cards |
| /features | Capability overview (workflow automation, agents, autonomy, governance, reliability, metering) | MarketingShell, FeatureGrid |
| /solutions | Use-case framing (operations, platform, AI teams, security, SaaS, internal platforms) | MarketingShell, FeatureGrid |
| /enterprise | Access control, tenant isolation, audit, governance, subscription lifecycle, operator console | MarketingShell, FeatureGrid |
| /documentation | Entry points into the working console routes | MarketingShell, link sections |
| /customer | Account overview, subscription summary, usage headline | AccountOverview, UsageDashboard |
| /customer/subscription | Plan, billing cycle, limits, upgrades/trial/cancel, invoices | SubscriptionCard, PlanComparison, InvoiceHistory |
| /customer/usage | Metered metrics against plan limits plus 30-day history | UsageDashboard, history series |
| /customer/settings | Profile, workspace information, security preferences | SecuritySettings (SessionManager), profile and workspace cards |
| /admin/customers | Customer list with plan, subscription, usage pressure and health | CustomerTable |
| /admin/customers/[id] | Customer detail, subscription status, usage, support notes, suspend/reactivate | CustomerDetails, SubscriptionStatus, UsageOverview |

### Components (frontend/features)

- customer-console: AccountOverview, SubscriptionCard (read-only mode for roles without billing rights), UsageDashboard, PlanComparison, InvoiceHistory, SecuritySettings, CustomerConsoleHeader; data hooks in useCustomerData (useAccount, useUsage, usePlans, useInvoices, useUsageHistory).
- customer-admin: CustomerTable, CustomerDetails, SubscriptionStatus, UsageOverview; data hooks in useCustomerAdmin (useCustomerList, useCustomerDetail).
- marketing: MarketingShell (nav + footer), MarketingHero, FeatureGrid, CallToAction.
- Shared: hooks/useResource.ts fetch state (data, isLoading, error, reload) used by both consoles.

### API usage

| Endpoint | Used by |
| --- | --- |
| GET /api/v1/saas/account | /customer, /customer/settings |
| GET /api/v1/usage, GET /api/v1/usage/history | /customer, /customer/usage |
| GET /api/v1/billing/plans | /pricing, /customer/subscription |
| GET /api/v1/billing/invoices | /customer/subscription |
| POST /api/v1/billing/upgrade, /trial, /cancel | /customer/subscription |
| GET /api/v1/saas/customers, GET /api/v1/saas/customers/:workspaceId | /admin/customers, /admin/customers/[id] |
| POST /api/v1/saas/customers/:workspaceId/suspend, /reactivate, /notes | /admin/customers/[id] |
| GET /api/v1/sessions (+ revoke endpoints) | /customer/settings |

### Permission model (frontend)

- Session gate: /customer and /admin redirect unauthenticated visitors to /login (console layouts).
- Billing mutations: hasPermission(role, WORKFLOW_CREATE) mirrors the backend guard on /upgrade, /trial and /cancel; VIEWER gets read-only billing.
- Admin console: OWNER/ADMIN UI gate (hasPermission(role, MEMBER_MANAGE)); the authoritative check remains server-side requirePlatformAdmin (PLATFORM_ADMIN_EMAILS) and the console surfaces the resulting 403 explicitly.

## 14. Screenshots

Placeholders to capture against a seeded environment after deployment (no image files are committed with this phase):

- [ ] / - marketing home
- [ ] /pricing - live plan catalog
- [ ] /customer - account overview
- [ ] /customer/subscription - plan, limits and invoices
- [ ] /customer/usage - meter bars and 30-day history
- [ ] /customer/settings - profile, workspace and security
- [ ] /admin/customers - customer list with health
- [ ] /admin/customers/[id] - customer detail and actions

## 15. Non-goals

- No rebuild of workflow / AI / agent / governance / marketplace modules; no new runtime engines.
- No live card processing in this phase: Stripe and Razorpay ship as verified HTTP adapters used when credentials exist; the mock provider remains the default for local and CI runs.
- No tax/VAT computation, dunning email sequences or revenue recognition - invoices come from the provider.
- No identity module changes (SSO/SCIM untouched).
- No new enterprise features beyond entitlement enforcement and the commercial surfaces described above.
