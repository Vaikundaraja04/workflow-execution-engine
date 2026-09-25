# Phase 16 - Customer Acquisition & SaaS Growth Engine (Architecture Plan)

Status: Implemented and verified.
Branch: phase-2e-production-hardening
Depends on: the Phase 14 go-to-market assets (LeadModel + leadService, ConversionEventModel + conversionTrackingService, customerHealthService, solutionTemplateService, productPackagingService, the /api/v1/marketing, /api/v1/solutions, /api/v1/sales and /api/v1/customer-health routes) and the Phase 15 commercial assets (checkoutService, billingWebhookService, demoWorkspaceService, the notification layer - emailNotificationService + emailTemplates + notificationProvider, the onboarding wizard, businessAnalyticsService and the billing console).

## 1. Goal

Turn the delivered platform into a measurable growth machine: one lifecycle event ledger that answers "how do strangers become retained customers", sales intelligence that ranks the pipeline and recommends the next action, a demo platform that sells with real scenarios, a customer success surface that predicts churn, lifecycle communication that runs itself, a partner channel that pays for itself, and the growth dashboard that puts acquisition through retention on one screen.

Hard rule: no rebuilds. Every capability extends a Phase 13/14/15 service; no parallel lead, health, notification, entitlement or analytics implementation is introduced.

## 2. Reuse map (existing asset -> Phase 16 action)

| Existing asset | Phase 16 action |
| --- | --- |
| ConversionEventModel + conversionTrackingService (14.9) | Stays the marketing funnel event log; GrowthEventModel (16.1) becomes the canonical cross-lifecycle ledger and the funnel/conversion/retention reports are computed over it |
| LeadModel + leadService (14.5) | Extended by salesIntelligenceService (16.2): scoring, engagement, priority, intent and recommendations read leads + workspace telemetry, no new lead model |
| demoWorkspaceService (13.5/15.x) | Extended by the scenario platform (16.3): POST /api/v1/demo/start/:scenario provisions a sandbox and installs the scenario solution; the existing create/reset/expire path is untouched |
| customerHealthService (14.8) | Composed by customerSuccessService (16.4): adds category naming (Healthy/At Risk/Critical), active users and feature adoption; scoring stays in one place |
| emailNotificationService + emailTemplates + notificationProvider (15.6) | Extended with lifecycle templates (trial started, upgrade opportunity, inactive customer) and driven by lifecycleAutomationService (16.5); NotificationLogModel keeps delivery history |
| solutionTemplateService (14.6) | Source of the demo scenario content (workflows, agents, sample runs, explanation) - scenarios reference solution ids instead of duplicating definitions |
| Marketplace (12.7) + LeadModel source PARTNER | Extended by PartnerModel + partnerService (16.6): partners, referrals, commission and referred-customer revenue |
| businessAnalyticsService (15.8) + customerHealthService | Inputs for the /growth dashboard (16.7); MRR/churn stay computed in one place |
| AIGovernanceGate + providers (12.6) | The proposal generator (16.8) runs through runGoverned: DENY fails, REQUIRE_APPROVAL returns a pending approval, ALLOW generates |

## 3. Customer lifecycle

```
visitor -> lead -> demo -> trial -> paying customer -> retained -> churned
```

| Transition | Growth event | Recorded by |
| --- | --- | --- |
| Stranger arrives | LANDING_VIEW | marketing /events (mirrored from conversion tracking) |
| Signup begins / completes | SIGNUP_STARTED / SIGNUP_COMPLETED | saasOnboardingService.signup |
| Demo requested | DEMO_REQUESTED | leadService.capture (source DEMO_REQUEST) |
| Demo provisioned | DEMO_STARTED | demoWorkspaceService.create / demo scenario start |
| Trial begins | TRIAL_STARTED | subscription trial start |
| Trial converts | TRIAL_ACTIVATED | webhook (ACTIVE after TRIALING) |
| First payment settles | PAYMENT_COMPLETED | checkout verification and provider webhooks |
| Becomes a customer | CUSTOMER_CONVERTED | checkout activation (demo/trial -> paying) |
| Leaves | CUSTOMER_CHURNED | subscription cancellation / expiry (webhook + lifecycle sweep) |

Every transition carries the workspace, lead and user reference that produced it, so funnel and retention numbers trace back to real activity rather than estimates.

## 4. Sales funnel and analytics model

- Acquisition: visitors -> signups -> demos -> trials -> customers with step conversion rates (16.1 funnel report).
- Conversion: per-source conversion, demo-to-customer rate, trial-to-paid rate, activation rate (first workflow executed within 14 days of signup) and CAC (marketing spend is not tracked by the platform: CAC is reported as cost-per-acquisition against recorded spend when supplied via query, otherwise null - never fabricated).
- Retention: monthly cohort retention (customers active N months after signup), churn rate in window, expansion signals (plan upgrades, usage growth) and LTV estimate (ARPA / churn rate when churn > 0).
- Sales intelligence (16.2): lead score 0-100 (firmographic + behavioural), engagement score, company priority, buying intent band and a recommended next action.
- Customer success (16.4): health score 0-100 with categories Healthy (>=70) / At Risk (40-69) / Critical (<40), successful-adoption metrics (active users, feature adoption, failed workflow pressure).

## 5. Deliverables

Models (new): GrowthEventModel (16.1), DemoScenarioModel (16.3), PartnerModel (16.6).
Services (new): growthAnalyticsService (16.1), salesIntelligenceService (16.2), demoScenarioService (16.3), customerSuccessService (16.4), lifecycleAutomationService (16.5), partnerService (16.6), proposalGeneratorService (16.8).
Routes (new): GET /api/v1/growth/funnel, GET /api/v1/growth/conversion, GET /api/v1/growth/retention, POST /api/v1/growth/lifecycle/run, GET /api/v1/growth/lifecycle/log, GET /api/v1/sales/intelligence, GET /api/v1/sales/leads/:leadId/score, POST /api/v1/sales/proposals, GET /api/v1/demo/scenarios, POST /api/v1/demo/start/:scenario, GET /api/v1/customers/health, GET /api/v1/customers/:workspaceId/health, POST /api/v1/partners, GET /api/v1/partners, GET /api/v1/partners/revenue.
Frontend (new): /growth dashboard with GrowthOverview, FunnelChart, RevenueMetrics, CustomerHealthWidget and SalesPipeline components.
Tests (new): growthAnalytics, salesIntelligence, demoScenarios, customerSuccess, partnerSystem (backend) and growthDashboard (frontend).
Email templates (new): TRIAL_STARTED, UPGRADE_OPPORTUNITY, INACTIVE_CUSTOMER (added to the 15.6 registry).

## 6. Access model

- Growth analytics, sales intelligence, proposals, partner management and the cross-customer success report are platform-administrator endpoints (requirePlatformAdmin), because they read across tenants.
- The single-customer health route additionally allows workspace members to read their own tenant (tenant isolation is enforced by comparing the resolved workspace context).
- Demo scenario listing is public (marketing surface); starting a scenario is public but rate limited, exactly like POST /api/v1/demo/create.
- Partners are created and listed by platform administrators; a partner record never grants workspace access, and partner revenue never exposes customer data beyond ids and amounts.

## 7. Non-goals

- No new workflow engine, AI runtime, governance or marketplace functionality: Phase 16 only reads what those layers already produce.
- No billing changes: subscriptions, payments and webhooks stay as delivered in Phase 13/15; growth events are recorded alongside.
- No marketing spend ingestion, ad-platform connectors or attribution modelling beyond the recorded source/utm fields.
- No fabricated metrics: a number the data cannot support (for example CAC without supplied spend) is reported as null with the reason, never guessed.
- No CRM replacement: partner and lead surfaces support the platform's own pipeline, not third-party sync.
- No identity, SSO/SCIM or region changes.
