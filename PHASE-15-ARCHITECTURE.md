# Phase 15 - SaaS Revenue Launch & Customer Acquisition Platform (Architecture Plan)

Status: Implemented and verified (backend typecheck clean, 91/91 test files, 972/972 tests; frontend typecheck clean, 17/17 test files, 182/182 tests, production build).
Branch: phase-2e-production-hardening
Depends on: the Phase 13 commercial foundation (TenantAccountModel, CustomerProfileModel, SubscriptionModel, PlanModel, BillingService, usageMeteringService, saasOnboardingService, demoWorkspaceService, customer console + marketing pages) and the Phase 14 revenue engine (productPackagingService, featureEntitlementService, leadService, solutionTemplateService, customerHealthService, conversionTrackingService, the provider verifyPayment/createInvoice contract and the /api/v1/marketing, /api/v1/solutions, /api/v1/sales, /api/v1/customer-health, /api/v1/entitlements routes).

## 1. Goal

Turn the verified commercial APIs into a complete customer-facing selling system: a public site that sells the real catalog, a self-serve checkout that activates a subscription and its entitlements, webhook processing that keeps subscriptions truthful, a guided onboarding wizard that lands a new customer in a working workspace, a notification layer that talks to customers at the right moments, CRM-ready lead handoff, and a business analytics dashboard covering the whole funnel through MRR and churn.

Hard rule: no rebuilds. Every capability extends an existing Phase 13/14 service; no parallel billing, metering, entitlement, lead or notification implementation is introduced.

## 2. Reuse map (existing asset -> Phase 15 action)

| Existing asset | Phase 15 action |
| --- | --- |
| productPackagingService + ProductPlanModel (14.1) | Source of truth for /pricing, the billing console and the checkout plan selection |
| featureEntitlementService (14.2) | Re-read after activation; no stored entitlement copy is introduced |
| BillingService + createBillingProvider registry | Extended with checkout session creation and subscription activation; provider resolution unchanged |
| Provider verifyPayment + createInvoice (14.3) | Used by the checkout verification step and the payment history/invoice surfaces |
| Provider handleWebhook (13.7) | Kept as the signature-verification layer; the new BillingWebhookService adds idempotency, normalization and audit |
| billingWebhookRouter (13.2) | Delegates to BillingWebhookService instead of handling events inline |
| saasOnboardingService + TenantAccountModel.onboarding (13.1) | Extended into a step-tracked wizard; no second onboarding model |
| solutionTemplateService.install (14.6) | Powers the "install a solution" wizard step |
| createWorkflow (workflowService) | Powers the "first workflow" wizard step |
| inviteMember (memberService) | Powers the "invite team" wizard step |
| demoWorkspaceService (13.5) | Demo request flow provisions the sandbox and links it to the lead |
| leadService + LeadModel (14.5) | Source for CRM export, follow-up status and demo conversion metrics |
| conversionTrackingService + ConversionEventModel (14.9) | Funnel metrics for the business dashboard |
| notificationService + realtime events | Reused for in-app notifications; the email layer adds a provider-agnostic transport beside it |
| customerHealthService (14.7) | Churn/at-risk inputs for the business dashboard |
| Phase 13 marketing pages + customer console | Extended (not replaced) with the live catalog, billing console and demo/contact routes |

## 3. Deliverables

Frontend (new/extended): /pricing (live catalog + comparison + upgrade CTA), /features (comparison matrix), /solutions (catalog browsing from solutionTemplateService), /demo (demo request), /contact-sales (sales lead), /customer/billing (billing console), /analytics/business (business dashboard).
Services (new): BillingWebhookService, checkoutService, onboardingWizardService, notificationTemplateService + emailProvider (mock/SMTP/HTTP), businessAnalyticsService, leadExportService (CRM).
Models (new): WebhookEventModel (idempotency), EmailDeliveryModel (delivery log).
Routes (new/extended): POST /api/v1/billing/checkout (+ /checkout/verify activation), POST /api/v1/billing/webhook (rewired), POST /api/v1/onboarding/start (+ /industry, /solution, /workflow, /invite, /complete steps), GET /api/v1/sales/leads/export, GET /api/v1/analytics/business.
Email templates: welcome, demo created, payment success, trial ending, usage limit warning, subscription renewal.
Tests (new): billingFlow, checkout, webhook, onboarding, customerBilling, conversionDashboard.

## 4. 15.1 Customer SaaS frontend

The Phase 13 pages shipped static/partially-wired versions; Phase 15 connects them to the Phase 14 APIs.

| Route | Data source | Notes |
| --- | --- | --- |
| /pricing | GET /api/v1/marketing/plans + /plans/compare | Real package pricing (USD/INR), packaging limits and entitlements; each card links into /register?plan=<package> and logged-in owners get an upgrade CTA into /customer/billing |
| /features | GET /api/v1/marketing/plans | The comparison renders the real packaging/entitlement matrix instead of prose |
| /solutions | GET /api/v1/solutions (+ /:solutionId) | Browsing with industry/package filters and workflow/agent counts |
| /demo | POST /api/v1/demo/create + POST /api/v1/marketing/leads | Demo request form; creates the sandbox, links the lead, records DEMO_CREATED |
| /contact-sales | POST /api/v1/marketing/leads | Sales enquiry with company size, industry and interest captured for the pipeline |

## 5. 15.2 Customer billing console

/customer/billing (extending the Phase 13 console shell and design system) shows the current plan and package, the subscription status and period, metered usage against package limits (from /api/v1/entitlements), the plan grid with upgrade/downgrade actions, invoice history and payment records (provider-backed), and the checkout entry point. Read models come from the existing endpoints: /api/v1/saas/account, /api/v1/entitlements, /api/v1/billing/plans, /api/v1/billing/invoices and the new /api/v1/billing/payments.

## 6. 15.3 Checkout flow

Plan selection -> checkout session -> payment verification -> subscription activation -> entitlement refresh.

- POST /api/v1/billing/checkout { packageId, provider?, currency? } creates a provider checkout/payment intent through the existing registry (Stripe, Razorpay, mock) and returns the session id + client secret plus the priced package. Selecting a package a workspace already holds is rejected (INVALID_REQUEST).
- POST /api/v1/billing/checkout/verify { paymentId } verifies through the provider, and only when the payment is paid does it activate: BillingService subscribes/upgrades the workspace to the package's internal plan with the provider recorded, TenantAccountModel.plan is synced, the conversion funnel records SUBSCRIPTION_STARTED and the audit log records CHECKOUT_COMPLETED. Unpaid or failed payments return the normalized payment state and leave the subscription untouched.
- Entitlements need no separate write: featureEntitlementService derives them from the subscription, so activation is the entitlement update. The response includes the evaluated entitlement summary so the client can refresh immediately.
- UPI and Google Pay: Razorpay orders already accept both rails; the normalized BillingPayment.method reports card/upi/google_pay/netbanking, and the checkout response echoes the rails the active provider supports.

## 7. 15.4 Webhook processing

BillingWebhookService owns provider webhook processing and keeps the existing router as the transport:

1. Signature verification stays with the provider (Stripe t/v1 HMAC-SHA256, Razorpay X-Razorpay-Signature HMAC-SHA256, mock passthrough); a bad signature is rejected before any state change.
2. Idempotency: WebhookEventModel stores provider + eventId with a unique index, plus the normalized type and processing status. A repeated delivery returns the recorded outcome instead of re-applying it (duplicate-safe under retries).
3. Normalization maps provider events onto the platform vocabulary: payment_success, payment_failed, subscription_created, subscription_updated, subscription_cancelled, invoice_paid.
4. Application updates the subscription (and tenant plan) through the existing handlers and records the outcome; unhandled types are recorded as ignored rather than dropped silently.
5. Audit logging: every applied event writes a hash-chained audit entry (BILLING_WEBHOOK_RECEIVED with the normalized type, provider and event id); secrets, signatures and payload bodies are never written to the audit log.
6. A failure marks the event failed so a retry can re-apply it.

## 8. 15.5 Customer onboarding

onboardingWizardService drives the five-step activation flow on top of the Phase 13 onboarding record (TenantAccountModel.onboarding is the state store - no second model):

1. create-workspace - ensures the workspace exists and is owned by the caller.
2. select-industry - records the industry on the tenant/profile for solution recommendations.
3. install-solution - installs the recommended solution through solutionTemplateService.install (skippable).
4. create-first-workflow - creates the starter workflow through the existing workflow service (skippable).
5. invite-team - sends the first member invitation through memberService (skippable).

GET /api/v1/onboarding/status returns the wizard state with per-step status and the recommended solution; POST /api/v1/onboarding/start begins it, and POST /api/v1/onboarding/industry, /solution, /workflow, /invite and /complete each complete a step and return the updated wizard. ONBOARDING_STARTED is audited on the first step and ONBOARDING_COMPLETED when the required steps finish; the conversion funnel records SIGNUP_COMPLETED on completion.

## 9. 15.6 Email notification layer

notificationTemplateService renders the customer lifecycle emails from a versioned template registry:
welcome (signup), demo_created (sandbox provisioned), payment_success (checkout/webhook), trial_ending (lifecycle sweep), usage_limit_warning (meter threshold), subscription_renewal (period rollover).

An EmailProvider abstraction transports them: the interface is send({to, subject, html, text, template, metadata}), with a logging/mock provider as the default (no external calls in tests or local runs) and optional HTTP/SMTP providers configured by environment. Sends go through emailDeliveryService, which records each attempt in EmailDeliveryModel (template, recipient, provider, status, providerMessageId, error) and audits nothing customer-visible beyond the delivery record. Wiring is event-driven so no caller blocks on email: signup -> welcome, demo create -> demo_created, checkout/webhook payment -> payment_success, sweep -> trial_ending, usage alert -> usage_limit_warning, period rollover -> subscription_renewal.

## 10. 15.7 Sales automation

- CRM-ready export: GET /api/v1/sales/leads/export?format=csv|json returns the filtered pipeline with contact fields, score and band, next action, follow-up status, demo status, owner and estimated value - the column set a CRM import expects.
- Follow-up status: leadService derives followUpStatus (overdue / due / scheduled / none) from lastContactedAt and status, surfaced on the lead row and in the export.
- Demo conversion and lifecycle: the pipeline reports demo requested -> created -> completed conversion, win rate and the lead lifecycle (new -> qualified -> demo -> proposal -> won/lost) for the sales board.

## 11. 15.8 Business analytics dashboard

/analytics/business (frontend) renders GET /api/v1/analytics/business, backed by businessAnalyticsService over real data only:

- Acquisition: visitors (LANDING_VIEW), signups (SIGNUP_COMPLETED), demos (DEMO_CREATED) and conversions (SUBSCRIPTION_STARTED) with step-to-step rates, from ConversionEventModel.
- Revenue: MRR from active/trialing subscriptions priced at the package priceMonthly (annual billing normalized to its effective monthly price), ARPA, and the plan mix by package.
- Customers: active customers (non-suspended, non-demo tenants with an active subscription), new customers in the window, trials ending soon, and churn (subscriptions EXPIRED/CANCELLED in the window) with a churn rate against the starting base.
- Health overlay: at-risk customer count from customerHealthService so revenue and risk sit on one screen.
The window is queryable (?days=), defaults to 30, and the endpoint is restricted to platform administrators.

## 12. 15.9 Tests

| File | Covers |
| --- | --- |
| tests/billingFlow.test.ts | Plan selection -> checkout session -> verification -> activation -> entitlement change, including the unpaid path leaving the subscription untouched |
| tests/checkout.test.ts | Checkout session creation for each provider, rail reporting (UPI/Google Pay), invalid package rejection and authorization |
| tests/webhook.test.ts | Signature rejection, the five normalized event types applied to subscriptions, idempotent redelivery, audit entries and the failed-event retry path |
| tests/onboarding.test.ts | Wizard state, step completion, ONBOARDING_STARTED/COMPLETED audit, solution/workflow/invite steps and skips |
| tests/customerBilling.test.ts | Billing console read models: account + entitlements + plans + invoices/payments scoping, and upgrade/downgrade rights |
| tests/conversionDashboard.test.ts | Business analytics: funnel rates, MRR/ARPA, active customers, churn and admin-only access |

## 13. Verification and non-goals

Verification gate: `npm run typecheck` and `npm test` (backend) plus `npm run typecheck`, `npm test` and `npm run build` (frontend), with zero regressions in the existing suites (920 backend tests, 166 frontend tests before this phase).

Non-goals:
- No rebuild of the workflow / AI / agent / governance / marketplace modules, and no parallel billing, entitlement, lead or notification implementations.
- No live card processing: Stripe and Razorpay stay verified HTTP adapters used when credentials exist; the mock provider remains the default for local and CI runs, and no real charge is ever attempted in tests.
- No tax/VAT, dunning sequences or revenue recognition - invoices come from the provider.
- No identity module changes (SSO/SCIM untouched).
- No changes to the Phase 14 route contracts beyond the additions listed here; existing consumers keep working.
