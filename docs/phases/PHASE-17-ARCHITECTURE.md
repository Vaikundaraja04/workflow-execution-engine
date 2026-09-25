# Phase 17 - Ecosystem & Marketplace Revenue Platform (Architecture Plan)

Status: Implemented and verified (backend: 7 suites, 57 tests; frontend: marketplaceRevenue suite, 5 tests).
Branch: phase-2e-production-hardening
Depends on: the Agent Marketplace (12.7: AgentMarketplaceModel + agentMarketplaceService + InstalledAgentModel + agentMarketplaceRoutes), the Template Marketplace and template system (10/12.7: WorkflowTemplateModel + templateService + marketplaceService + marketplaceRoutes), Billing (15.3: billing provider registry + PaymentRecordModel + checkoutService), the Partner channel (16.6: partnerService + PartnerModel), Revenue analytics (15.8 businessAnalyticsService, 16.1 growthAnalyticsService, 16.6 partnerService.revenueReport), AI Governance (12.6: AIGovernanceGate + AIGovernancePolicyService + AIFeaturePolicyModel) and the RBAC permission model (auth/permissions.ts).

## 1. Goal

Turn the delivered marketplaces and partner channel into a monetizable ecosystem with one commerce spine: pricing per asset, purchase -> license -> install, a single revenue ledger with platform commission and publisher earnings, a publisher portal, discovery that recommends from recorded signals with governed AI copy, reviews tied to verified purchases, an ecosystem analytics view and partner solution listings. Every capability extends a Phase 10/12/15/16 service.

Hard rule: no rebuilds. The existing listing, search, versioning, install, review and subscription implementations stay authoritative; Phase 17 adds commerce records around them and gates the existing paths with them.

## 2. Reuse map (existing asset -> Phase 17 action)

| Existing asset | Phase 17 action |
| --- | --- |
| AgentMarketplaceModel + agentMarketplaceService (12.7) | Pricing record keyed to the listing (17.1 MarketplacePricingModel); purchase/license lifecycle in agentMarketplaceBillingService; installAgent gains a license gate for paid listings |
| InstalledAgentModel | Stays the install state; MarketplaceLicenseModel (17.1) becomes the commercial record |
| WorkflowTemplateModel + templateService + MarketplaceListingModel (10/12.7) | Premium workflow commerce record (17.2 WorkflowTemplateMarketplaceModel keyed to templateId); installs reuse templateService.installTemplate; listing definitions stay in one place |
| Billing provider registry + PaymentRecordModel (15.3) | Marketplace purchases create provider payment intents and verify through the same providers; settled payments land in PaymentRecordModel unchanged |
| checkoutService (15.3) | Its session/verify pattern is the template for marketplace purchase; subscription plans are untouched |
| partnerService + PartnerModel (16.6) | Extended with PartnerMarketplaceModel solution listings; commission math stays in partnerService.revenueReport and is reused by the marketplace revenue ledger |
| marketplaceIntelligenceService (12.8) | MarketplaceRecommendationService (17.5) composes its ranking and adds industry, usage and workflow-history signals |
| aiGovernanceGate + AIGovernancePolicyService (12.6) | Governs AI-generated recommendation copy and AI content attached to published assets; DENY blocks, REQUIRE_APPROVAL returns pending |
| businessAnalyticsService (15.8) + growthAnalyticsService (16.1) | marketplaceAnalyticsService (17.8) computes GMV, top assets, publisher growth and adoption from the marketplace ledger; MRR/churn stay computed in one place |
| auditService + AuditLogModel | New Phase 17 actions for pricing, purchase, license, refund, review and payout events |

## 3. Ecosystem architecture

```
publisher workspace ──publishes──▶ listing (agent 12.7 / workflow 17.2)
        │                                   │
        │ pricing (17.1 / 17.2)             │ browse + search (existing, 17.5 ranking)
        ▼                                   ▼
 MarketplacePricingModel            buyer workspace purchase
        │                                   │  provider payment (15.3)
        │                                   ▼
        │                        MarketplaceLicenseModel (ACTIVE)
        │                                   │
        │  RevenueTransactionModel (17.3)   ▼
        └─────────◀── platform 20% ─── install (existing install paths)
                       publisher 80%
```

## 4. Marketplace revenue model

- Pricing models: FREE, ONE_TIME_PURCHASE, SUBSCRIPTION (monthly/yearly), ENTERPRISE_LICENSE (negotiated, seats + term).
- Default platform commission 20%; the publisher share is stored per pricing record as revenueSharePercentage (50-100) so negotiated deals do not need code changes.
- Example: a $100 one-time purchase is recorded as platform 20% ($20) and publisher 80% ($80) in one RevenueTransactionModel row.
- Refunds reverse the transaction (status REFUNDED with refundedAmount) and revoke the license; commission is always computed from the amount actually settled, never projected.
- Payouts are a ledger operation: transactions move PENDING -> AVAILABLE -> PAID_OUT with payout batch ids; external money movement is a non-goal.

## 5. Publisher workflow

1. Publisher workspace drafts pricing for an existing agent listing (17.1) or publishes a premium workflow (17.2: PREMIUM_WORKFLOW / INDUSTRY_SOLUTION / BUNDLE).
2. The listing is published through the existing publish paths; pricing becomes ACTIVE.
3. Buyers purchase; verification settles the payment and a license is issued.
4. The revenue ledger (17.3) accrues the transaction; the publisher portal (17.4) shows sales, revenue, ratings and content status.
5. Platform admins mark payout batches as PAID_OUT.

## 6. Commission flow

```
buyer purchase -> provider payment intent (amount = price)
              -> provider.verifyPayment -> PaymentRecordModel (15.3, unchanged)
              -> MarketplaceRevenueService records RevenueTransactionModel
                     amount, platformCommission, publisherEarnings, revenueSharePercentage
              -> MarketplaceLicenseModel ACTIVE (install unlocked)
refund -> platform admin records refund -> transaction REFUNDED + license REVOKED
```

## 7. Security model

- Purchases, renewals and revocations require AGENT_MARKETPLACE_MANAGE (spending is an owner/admin action); browsing keeps AGENT_MARKETPLACE_READ; installs keep AGENT_INSTALL / TEMPLATE_INSTALL.
- Publishing prices requires the same permission as publishing the asset: TEMPLATE_PUBLISH for workflows, AGENT_MARKETPLACE_CREATE for agents.
- Licenses are workspace-scoped and unique per (assetType, assetId, workspaceId); cross-tenant reads resolve to 404, never 403-with-data.
- Publisher revenue and portal endpoints resolve the seller workspace from the caller context; platform-wide revenue, refunds, payouts and ecosystem analytics require requirePlatformAdmin.
- All AI-generated marketplace content (recommendation copy, generated descriptions) runs through the AI governance gate: DENY blocks, REQUIRE_APPROVAL returns a pending approval, ALLOW generates; prompt-bearing content is validated with AISecurityService.
- Reviews require a verified purchase or an ACTIVE license, one per workspace per asset; repeat abuse reports hide a review; moderation is audited.
- No fabricated numbers: an empty ledger reports zeros and explicit notes, never estimates.

## 8. Deliverables

Models (new): MarketplacePricingModel (17.1), MarketplaceLicenseModel (17.1 licence lifecycle), WorkflowTemplateMarketplaceModel (17.2), RevenueTransactionModel (17.3), MarketplaceReviewModel (17.7), PartnerMarketplaceModel (17.6).
Services (new): agentMarketplaceBillingService (17.1), workflowMarketplaceService (17.2), marketplaceRevenueService (17.3), publisherService (17.4), marketplaceRecommendationService (17.5), marketplaceAnalyticsService (17.8).
Routes (new): POST /api/v1/marketplace/agents/:id/purchase, GET /api/v1/marketplace/licenses, GET /api/v1/marketplace/revenue, GET /api/v1/marketplace/workflows, POST /api/v1/marketplace/workflows/publish, POST /api/v1/marketplace/workflows/:id/install, POST /api/v1/marketplace/reviews, GET /api/v1/marketplace/reviews, GET /api/v1/marketplace/recommendations, GET /api/v1/marketplace/publisher/dashboard, POST /api/v1/partners/:partnerId/solutions, GET /api/v1/partners/solutions, GET /api/v1/analytics/marketplace.
Frontend (new): /publisher (PublisherOverview, SalesAnalytics, RevenueChart, ContentManager) and /analytics/marketplace (MarketplaceAnalyticsDashboard).
Tests (new): marketplaceBilling, workflowMarketplace, marketplaceRevenue, publisherPortal, marketplaceRecommendation, marketplaceReviews, ecosystemAnalytics (backend) and marketplaceRevenue (frontend) - 62 tests covering pricing and purchase -> license -> install, the 80/20 split and refund reversal, payouts, the publisher portal, recommendations with governance gating, review abuse handling and partner solutions.

## 9. Data model details

MarketplacePricingModel: workspaceId (publisher), assetType AGENT|WORKFLOW, assetId, publisherId, pricingModel FREE|ONE_TIME_PURCHASE|SUBSCRIPTION|ENTERPRISE_LICENSE, price, currency, billingCycle NONE|MONTHLY|YEARLY, revenueSharePercentage (50-100, publisher share), seats (enterprise), termMonths (enterprise), status DRAFT|ACTIVE|ARCHIVED.
Indexes: unique (assetType, assetId), (publisherId, status), (status, pricingModel).

MarketplaceLicenseModel: workspaceId (buyer), assetType, assetId, publisherId, pricingModel, status ACTIVE|EXPIRED|REVOKED, seats, activatedAt, expiresAt, lastRenewedAt, revokedAt, revokedBy, revokeReason, paymentId, transactionId, revenueSharePercentage.
Indexes: unique (workspaceId, assetType, assetId), (publisherId, status), (status, expiresAt).

WorkflowTemplateMarketplaceModel: templateId (unique, ref WorkflowTemplate), workspaceId (publisher), publisherId, listingType PREMIUM_WORKFLOW|INDUSTRY_SOLUTION|BUNDLE, pricingModel, price, currency, billingCycle, revenueSharePercentage, bundleTemplateIds, industryTags, status DRAFT|PUBLISHED|ARCHIVED, marketplaceVersion, statistics { sales, installs, grossRevenue }.
Indexes: unique templateId, (status, listingType), (publisherId, status), tags.

RevenueTransactionModel: transactionId (unique, mt_ prefix), buyerWorkspaceId, sellerWorkspaceId, publisherId, assetType, assetId, paymentId, provider, amount, currency, platformCommission, publisherEarnings, revenueSharePercentage, status PENDING|AVAILABLE|PAID_OUT|REFUNDED|REVERSED, refundedAmount, refundedAt, payoutId, settledAt, metadata.
Indexes: unique transactionId, (buyerWorkspaceId, createdAt), (sellerWorkspaceId, status), (assetType, assetId, createdAt), (status, createdAt).

MarketplaceReviewModel: assetType, assetId, workspaceId, userId, publisherId, rating (1-5), review, verifiedPurchase, status PUBLISHED|HIDDEN, abuseReports (user ids), hiddenReason.
Indexes: unique (assetType, assetId, workspaceId), (assetId, status, createdAt), (publisherId, status).

PartnerMarketplaceModel: partnerId, workspaceId, listingType SOLUTION|CONSULTING|AGENCY, title, description, templateId, solutionId, industryTags, commissionRatePercent, status DRAFT|PUBLISHED|ARCHIVED, statistics { referrals, customers, commissionEarned }, createdBy.
Indexes: (partnerId, status), (status, listingType), tags.

## 10. Access model

- Buying: workspace owner/admin (AGENT_MARKETPLACE_MANAGE) for agent purchases; TEMPLATE_INSTALL holders for workflow installs with a settled payment; license reads follow the same read permissions as the marketplace.
- Publishing: TEMPLATE_PUBLISH for workflow listings and prices; AGENT_MARKETPLACE_CREATE for agent prices; AGENT_MARKETPLACE_MANAGE archives pricing.
- Publisher portal: scoped to the caller workspace as publisher; a member of another workspace sees only their own portfolio.
- Platform operations (revenue report, refunds, payouts, ecosystem analytics): requirePlatformAdmin, because they read across tenants.
- Partners: partner records and solution listings are created by platform administrators (a partner record never grants workspace access, per 16.6).

## 11. Non-goals

- No real money movement, payout transfers, tax/VAT handling or invoicing changes; payouts are a ledger state.
- No new billing provider and no changes to subscription plans, entitlements or core pricing.
- No rebuild of listing, search, versioning, install, review or partner systems.
- No publisher self-service identity/onboarding beyond the existing workspace and template publish permissions.
- No fabricated GMV, commission or adoption numbers when the ledger is empty.

## 12. Testing strategy

Supertest against the real app with an in-memory Mongo replica set, mirroring the existing suites. The mock billing provider settles payments in tests. Coverage: pricing CRUD, purchase -> license -> install, subscription renewal, revocation, the 80/20 revenue math and refund reversal, publisher portal aggregation, recommendation signals plus governance gating (DENY blocks AI copy; deterministic fallback still ranks), RBAC allowed/denied per role and cross-workspace isolation returning 404. Frontend: vitest + Testing Library for the publisher portal and marketplace analytics dashboard with mocked services.

## 13. Implementation order

17.1 pricing + purchase/license foundation -> 17.3 revenue ledger (needed by 17.1 publisher revenue) -> 17.2 workflow marketplace -> 17.7 reviews -> 17.5 recommendations -> 17.6 partner listings -> 17.8 analytics -> 17.4 publisher portal (backend + frontend) -> 17.10 tests -> verification gate.
