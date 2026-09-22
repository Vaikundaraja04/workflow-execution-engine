# Phase 14 - Go-To-Market, Customer Acquisition & Revenue Engine (Architecture Plan)

Status: Implemented and verified (typecheck clean, 84/84 test files, 920/920 tests).
Branch: phase-2e-production-hardening
Depends on: the Phase 13 commercial foundation (TenantAccountModel, CustomerProfileModel, SubscriptionModel, PlanModel, BillingService + BillingProvider registry, usageMeteringService, demoWorkspaceService, RBAC + requirePermission, the hash-chained audit log), the existing workflow/agent creation services and the template marketplace.

## 1. Goal

Turn the commercial foundation into a working go-to-market engine: sellable product packaging over the internal plan grid, plan entitlements enforced at the API boundary, an inbound lead pipeline wired to the demo sandbox, industry solution packages that install into a workspace, customer-health scoring for the operator console, payment verification and invoicing across billing providers, and marketing conversion tracking for the acquisition funnel.

Hard rule: no rebuilds. The workflow engine, AI platform, agents, governance, marketplace and observability modules are untouched - Phase 14 composes them through new packaging, entitlement, pipeline and health services.

## 2. Reuse map (existing asset -> Phase 14 action)

| Existing asset | Phase 14 action |
| --- | --- |
| PlanModel + DEFAULT_PLANS (FREE/STARTER/PROFESSIONAL/ENTERPRISE) | Kept as the internal plan grid; ProductPlanModel projects it as the sellable catalog (STARTER/BUSINESS/ENTERPRISE) |
| SubscriptionModel (plan, status, provider, periods) | Read by the entitlement engine and the checkout verification route; no schema change |
| BillingService + BillingProvider registry | Extended with verifyPayment + createInvoice on the provider contract; provider resolution stays in the registry |
| usageMeteringService / UsageMeterModel / PLAN_LIMITS | Compose the entitlement quota picture (used vs limit per feature) |
| demoWorkspaceService | Reused from the sales console to provision a demo sandbox for a lead |
| RBAC (permissionsForRole, requirePermission, roleHasPermission) | Remains authoritative for who may act; entitlements only gate what the plan includes |
| WorkspaceModel / AgentModel / WorkflowModel / WorkflowExecutionModel / AIUsageModel | Health scoring and entitlement quotas read them directly - no duplicate tracking |
| createWorkflow + AgentModel + WorkflowTemplateModel | Solution install composes these - no parallel installer |
| auditService / AuditLogModel | Records LEAD_CAPTURED, LEAD_UPDATED, LEAD_DEMO_LINKED, SOLUTION_INSTALLED, CUSTOMER_HEALTH_EVALUATED |
| requireActiveTenant / requirePlatformAdmin | Reused to gate customer and operator routes |

## 3. Deliverables

Models (new): ProductPlanModel, LeadModel, ConversionEventModel.
Services (new): productPackagingService, featureEntitlementService, leadService, solutionTemplateService, customerHealthService, conversionTrackingService.
Routes (new): /api/v1/marketing, /api/v1/solutions, /api/v1/sales, /api/v1/customer-health, /api/v1/entitlements, and billing additions (/checkout/verify, /invoices).
Middleware: requireEntitlement rewired to the entitlement engine; requireActiveTenant reused on the new customer routes.
BillingProvider: added verifyPayment and createInvoice, implemented for mock, Stripe and Razorpay.
Tests (new): tests/revenueEngine.test.ts.

## 4. Product packaging (14.1)

ProductPlanModel is the sellable catalog: id (STARTER | BUSINESS | ENTERPRISE), name, tagline, audience, internalPlan (the PlanModel row it bills as), priceMonthly + annualPriceMonthly, currency (USD | INR), packaging {includedWorkflows, executionLimit, aiRequestLimit, agentLimit, storageBytes, seats, supportLevel, supportResponseHours, trialDays}, entitlements (FeatureKey[]), highlights, addOns, version, sortOrder, isActive. DEFAULT_PRODUCT_PLANS seeds the three packages on first use; BUSINESS projects PROFESSIONAL.

productPackagingService: listProductPlans, getProductPlan (accepts the package id or the internal plan name), compareProductPlans (price delta, packaging deltas, entitlements added/removed, recommended), packageForPlan, packageWorkspace(packageId, useCase), defaultPackaging, PLAN_BY_PACKAGE / PACKAGE_BY_PLAN maps. Indexes: unique id, (sortOrder, priceMonthly), (isActive).

## 5. Feature entitlements (14.2)

featureEntitlementService is the single enforcement point for "can this workspace use this feature, and how much is left?". It composes the subscription plan, the package limits and metered usage, and never bypasses RBAC: when a role is supplied it also requires the mapped permission (FEATURE_PERMISSIONS).

- PLAN_ENTITLEMENTS maps each SubscriptionPlan to its included FeatureKeys; MINIMUM_PLAN_FOR_FEATURE drives upgrade prompts.
- evaluate(workspaceId, feature, {role}) returns one of ENTITLED, PLAN_UPGRADE_REQUIRED, QUOTA_EXCEEDED, SUBSCRIPTION_INACTIVE, NO_SUBSCRIPTION, ROLE_NOT_PERMITTED plus limit/used/remaining.
- getSummary(workspaceId) returns the full feature matrix, quota snapshots (WORKFLOWS, EXECUTIONS, AI_REQUESTS, AI_AGENTS), and upgrade targets.
- assertFeature throws FEATURE_NOT_ENTITLED; requireEntitlement(feature) wraps it for routes.

## 6. Checkout and invoicing (14.3)

BillingProvider gained two operations, both normalized across providers:
- verifyPayment({paymentId}) -> BillingPayment {id, customerId, amount, amountReceived, currency, status (succeeded | processing | requires_action | failed | refunded | unknown), method (card/upi/google_pay/...), paid, refundedAmount, created, metadata}. Stripe reads /v1/payment_intents, Razorpay reads /v1/payments/:id with UPI and Google Pay mapped as first-class rails, the mock provider returns deterministic state for local flows. Empty ids fail fast with INVALID_PAYMENT_ID.
- createInvoice({customerId, description?, amount?, currency?, daysUntilDue?, metadata?}) -> BillingInvoice. Stripe creates an invoice item plus a send_invoice invoice; Razorpay creates an invoice; providers that cannot invoice must throw UNSUPPORTED_PROVIDER_OPERATION instead of fabricating one.

Routes: POST /api/v1/billing/checkout/verify (workspace member; verifies through the provider recorded on the subscription) and POST /api/v1/billing/invoices (platform admin only).

## 7. Lead management (14.5)

LeadModel captures inbound demand: company, contact name/email/phone, industry, companySize, interest (STARTER | BUSINESS | ENTERPRISE | NOT_SURE), message, source (WEBSITE | PRICING_PAGE | DEMO_REQUEST | REFERRAL | OUTBOUND | PARTNER | OTHER), status (NEW -> CONTACTED -> QUALIFIED -> DEMO_SCHEDULED -> DEMO_COMPLETED -> PROPOSAL -> WON | LOST), demoStatus (NONE | REQUESTED | CREATED | COMPLETED | EXPIRED), demo workspace linkage, assignee, estimated value, lost reason, notes[], tags[], utm. Indexes: (contactEmail, createdAt), (status, createdAt), (demoStatus, updatedAt), (company), (demoWorkspaceId).

leadService: capture (idempotent per contact email - a repeat submission updates the existing record), list (filters + pipeline roll-up), get, update (qualification, status, assignment, notes, markContacted), attachDemo, pipeline (stage counts and value plus the demo funnel). scoreLead derives a 0-100 score from fit, intent and engagement with hot/warm/cold bands, and nextActionFor returns the recommended next step per stage.

## 8. Industry solutions (14.6)

solutionTemplateService ships a packaged catalog (SOLUTION_CATALOG) of industry solutions, each with workflows, agents, demo data, documentation, outcomes, tags and a recommendedPackage. listSolutions filters by industry and package; getSolution returns the full definition (SOLUTION_NOT_FOUND otherwise); install composes the existing createWorkflow, AgentModel and WorkflowTemplateModel to add the workflows, agents and marketplace templates into a workspace, reporting skipped items instead of failing the whole install, and audits SOLUTION_INSTALLED.

## 9. Customer health (14.7)

customerHealthService scores a workspace 0-100 from weighted factors - active usage (25%), reliability (25%), AI usage (15%), adoption (20%), support (15%) - over real telemetry (executions 30d vs previous 30d, failure rate, AI tokens vs limit, workflows/published, active agents, members, support notes, idle days, trial remaining). evaluate returns factors, risks (including USAGE_NEAR_LIMIT, SUPPORT_ESCALATION, LOW_ADOPTION), recommendations with owners, and the raw signals. portfolio aggregates tenants into healthy/watch/at_risk counts, an average score and risk counts; a tenant without telemetry is skipped rather than failing the page.

## 10. Conversion tracking (14.9)

ConversionEventModel is an append-only funnel log (LANDING_VIEW -> SIGNUP_STARTED -> SIGNUP_COMPLETED -> DEMO_CREATED -> SUBSCRIPTION_STARTED) carrying an optional workspace/lead/user reference, plan, package, source and coarse UTM data - never credentials or request bodies. Because it is analytics rather than a security-relevant mutation it is deliberately NOT written to the hash-chained audit log. conversionTrackingService records events (record, recordSafely, plus landing/signup/demo/subscription helpers) and reports the funnel with per-step and cumulative conversion, visitor/signup/demo/subscription totals and source attribution.

## 11. Routes and permission model

| Route | Purpose | Guards |
| --- | --- | --- |
| GET /api/v1/marketing/plans | Sellable catalog + free tier + plan aliases | Public |
| GET /api/v1/marketing/plans/compare?from=&to= | Packaging diff for an upgrade prompt | Public |
| POST /api/v1/marketing/leads | Website / pricing / demo-request lead capture | Public, rate limited, zod validated |
| POST /api/v1/marketing/events | Landing view and signup-started funnel steps | Public, rate limited |
| GET /api/v1/solutions, /:solutionId | Industry solution catalog and detail | Public |
| POST /api/v1/solutions/:solutionId/install | Install a solution into a workspace | requireAuth + requireActiveTenant + requireMembership + requireEntitlement(EXECUTIONS) |
| GET /api/v1/sales/leads, /leads/:leadId, /leads/pipeline, /funnel | Sales pipeline, lead detail, stage roll-up, conversion funnel | requireAuth + requirePlatformAdmin |
| PATCH /api/v1/sales/leads/:leadId, POST /leads/:leadId/demo | Qualify a lead; provision and link its demo sandbox | requireAuth + requirePlatformAdmin |
| GET /api/v1/customer-health, /:workspaceId | Customer health portfolio and per-customer report | requireAuth + requirePlatformAdmin |
| GET /api/v1/entitlements, /:feature | Workspace entitlement summary and single-feature decision | requireAuth + requireActiveTenant + requireMembership |
| POST /api/v1/billing/checkout/verify | Verify a provider payment for the workspace subscription | requireAuth + requireActiveTenant + requireMembership |
| POST /api/v1/billing/invoices | Create a provider invoice (overage, add-ons, manual billing) | requireAuth + requirePlatformAdmin |

Workspace scoping continues to come from the permission resolver (X-Workspace-Id header or workspace param). The client never decides authorization: the marketing and solution list endpoints expose only catalog data, and every mutating endpoint re-checks membership, RBAC and (where applicable) entitlements server-side.

## 12. Tests

tests/revenueEngine.test.ts covers packaging (catalog seeding, alias resolution, comparison, workspace packaging), the entitlement engine (matrix, NO_SUBSCRIPTION / PLAN_UPGRADE_REQUIRED / ROLE_NOT_PERMITTED, assertFeature, summary), leads (idempotent capture + audit, filters + pipeline, update + notes + demo linkage), conversion tracking (funnel math and source attribution, no audit-chain writes), solutions (catalog, unknown id, install creating workflows/agents), customer health (report, portfolio roll-up), and the routes (public catalog/lead/event endpoints and their validation, solution catalog with auth-gated install, sales console admin gating and demo provisioning, entitlement summary scoping, checkout verification and invoice admin gating).

## 13. Non-goals

- No rebuild of the workflow / AI / agent / governance / marketplace modules.
- No live card processing: Stripe and Razorpay remain verified HTTP adapters used when credentials exist; the mock provider stays the default for local and CI runs.
- No CRM sync, email sequencing or revenue recognition.
- No changes to the identity module (SSO/SCIM untouched).
- No new frontend surfaces in this phase: the Phase 13 marketing pages and consoles keep working; consuming the Phase 14 catalog and pipeline endpoints from the frontend is follow-up work.
