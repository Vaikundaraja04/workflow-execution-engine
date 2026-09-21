# Phase 13 - Customer-Facing SaaS Frontend (Architecture)

Status: Design complete - implementation in progress.
Branch: phase-2e-production-hardening
Backend counterpart: PHASE-13-ARCHITECTURE.md (backend implemented and verified)
Depends on: the existing frontend foundation (App Router shell, components/ui design system, services/apiClient + customerApi, stores/authStore + workspaceStore, types/permissions RBAC, the security session surfaces) and the Phase 13 backend APIs (/api/v1/saas, /api/v1/usage, /api/v1/billing, /api/v1/sessions).

## 1. Goal

Complete the customer-facing SaaS layer on top of the verified Phase 13 backend: a customer console (/customer), an internal customer-management console (/admin/customers) and the marketing foundation (/pricing, /features, /solutions, /enterprise, /documentation). No backend logic changes, no duplicated services, no fixture data in product code - every screen reads from an existing API through an existing service client.

## 2. Reuse map (existing frontend assets)

| Existing asset | Location | Phase 13 action |
| --- | --- | --- |
| App Router shell + theme | app/layout.tsx, app/globals.css | Reuse; root metadata updated to the product name; boilerplate landing replaced by the marketing home |
| Design system | components/ui (Button, Card, Badge, Table, Input, Loading/Spinner/Skeleton, ErrorState, EmptyState, Modal, dropdown-menu) | Reuse in every new surface - no parallel components |
| Console header pattern | features/customer-console/components/CustomerConsoleHeader.tsx | Completed previously; reused as the /customer shell navigation |
| Workspace switcher | components/WorkspaceSwitcher.tsx | Reused inside the customer console header |
| API client | services/apiClient.ts (bearer token, X-Workspace-Id, refresh queue, ApiClientError mapping) | Reused as the only transport |
| SaaS API client | services/customerApi.ts | Reused as-is for account, onboarding, usage, plans, invoices, billing lifecycle and admin customer endpoints |
| SaaS DTOs | types/saas.ts | Reused for all console typing |
| Customer console hooks | features/customer-console/useCustomerData.ts | Reused; generic resource hook extracted to hooks/useResource.ts so the admin console shares it |
| Customer console components | features/customer-console/components (AccountOverview, SubscriptionCard, UsageDashboard, PlanComparison, InvoiceHistory, CustomerConsoleHeader) | Completed (SecuritySettings added); SubscriptionCard extended with a read-only mode for the permission model |
| Auth store | stores/authStore.ts | Reused for the session gate (redirect to /login when unauthenticated) |
| Workspace store | stores/workspaceStore.ts | Reused for the active workspace and the caller role |
| RBAC | types/permissions.ts (hasPermission) | Reused for every role gate - mirrors the backend matrices |
| Security surfaces | features/security/components/SessionManager.tsx via stores/securityStore + services/securityApi | Reused in /customer/settings for session/security preferences |
| Test harness | vitest.config.ts, tests/setup.ts, tests/dashboard.test.tsx patterns | Reused for the customer console test |

## 3. Route map (new)

| Route | Surface | Components | Data source | Access |
| --- | --- | --- | --- | --- |
| /customer | Account overview + usage headline + subscription summary | AccountOverview, UsageDashboard (compact) | GET /api/v1/saas/account, GET /api/v1/usage | Authenticated + workspace membership (requireActiveTenant + requireMembership) |
| /customer/subscription | Plan, billing cycle, limits, upgrade/cancel | SubscriptionCard, PlanComparison, InvoiceHistory | GET /api/v1/saas/account, GET /api/v1/billing/plans, /api/v1/billing/invoices; POST /api/v1/billing/upgrade, /trial, /cancel | Read: membership. Mutations: WORKFLOW_CREATE (mirrors the backend billing guard) |
| /customer/usage | Executions, AI tokens, agent runs, API requests, storage | UsageDashboard + history series | GET /api/v1/usage, GET /api/v1/usage/history | Membership |
| /customer/settings | Profile, security preferences, workspace information | SecuritySettings (SessionManager), profile + workspace cards | GET /api/v1/saas/account, GET /api/v1/sessions, workspace store | Membership; session revocation is self-scoped |
| /admin/customers | Customer list with health, plan, usage pressure | CustomerTable | GET /api/v1/saas/customers | OWNER/ADMIN UI gate; backend requires the PLATFORM_ADMIN_EMAILS allowlist (403 surfaces in the table) |
| /admin/customers/[id] | Customer detail, subscription status, usage, notes, suspend/reactivate | CustomerDetails, SubscriptionStatus, UsageOverview | GET /api/v1/saas/customers/:workspaceId; POST /suspend, /reactivate, /notes | Same as above |
| /pricing | Plan catalog mirroring the real catalog | Catalog cards | GET /api/v1/billing/plans (public catalog) | Public |
| /features | Capability overview (workflow automation, agents, governance, reliability) | Marketing sections | Static content, no invented metrics | Public |
| /solutions | Use-case framing | Marketing sections | Static content | Public |
| /enterprise | Enterprise posture (security, RBAC, audit, deployment) | Marketing sections | Static content | Public |
| /documentation | Documentation index linking the real consoles/API surfaces | Marketing sections | Static content | Public |
| / | Marketing home (replaces the Next.js boilerplate) | Hero + capability sections | Static content | Public |

## 4. API integration plan

| Endpoint | Method | Client method | Used by |
| --- | --- | --- | --- |
| /api/v1/saas/account | GET | customerApi.getAccount | /customer, /customer/settings |
| /api/v1/usage | GET | customerApi.getUsage | /customer, /customer/usage |
| /api/v1/usage/history | GET | customerApi.getUsageHistory | /customer/usage |
| /api/v1/billing/plans | GET | customerApi.getPlans | /pricing, /customer/subscription |
| /api/v1/billing/invoices | GET | customerApi.getInvoices | /customer/subscription |
| /api/v1/billing/upgrade | POST | customerApi.changePlan | /customer/subscription |
| /api/v1/billing/trial | POST | customerApi.startTrial | /customer/subscription |
| /api/v1/billing/cancel | POST | customerApi.cancelSubscription | /customer/subscription |
| /api/v1/saas/customers | GET | customerApi.listCustomers | /admin/customers |
| /api/v1/saas/customers/:workspaceId | GET | customerApi.getCustomer | /admin/customers/[id] |
| /api/v1/saas/customers/:workspaceId/suspend, /reactivate, /notes | POST | customerApi.suspendCustomer, reactivateCustomer, addCustomerNote | /admin/customers/[id] |
| /api/v1/sessions (+ /revoke-others) | GET/POST | securityApi via securityStore | /customer/settings |

No new API client and no new DTOs: customerApi and types/saas.ts already cover the Phase 13 surface. All workspace scoping is carried by the apiClient request interceptor (X-Workspace-Id from the workspace store/localStorage).

## 5. Permission model

- Authentication: /customer and /admin are session-gated; unauthenticated callers are redirected to /login by the console layout (same behavior as /dashboard).
- Customer console reads: any active workspace membership (the backend enforces requireActiveTenant + requireMembership).
- Billing mutations (plan change, trial, cancel): gated in the UI by hasPermission(role, WORKFLOW_CREATE), exactly the permission the backend requires for /api/v1/billing/upgrade, /trial and /cancel. VIEWER sees read-only billing.
- Admin customer console: the UI gate allows OWNER and ADMIN roles only (hasPermission(role, MEMBER_MANAGE)); the authoritative check stays server-side - the customer-management endpoints require the PLATFORM_ADMIN_EMAILS allowlist and return 403 for anyone else, which the console renders as an explicit access error instead of hiding it.
- The client never decides authorization on its own: every gate is a UX affordance over an existing backend check.

## 6. Data flow and state

- hooks/useResource.ts provides the shared fetch state machine (data, isLoading, error, reload) used by the customer and admin hooks; it follows the existing console pattern (explicit loading/error/reload, no silent failure).
- features/customer-console/useCustomerData.ts exposes useAccount, useUsage, usePlans, useInvoices, useUsageHistory.
- features/admin-customers/useCustomerAdmin.ts exposes useCustomerList(params) and useCustomerDetail(workspaceId).
- Global state stays in the existing stores: authStore (session/user) and workspaceStore (active workspace + role). No new stores are introduced.

## 7. Marketing foundation

- A shared marketing shell (nav + footer) composes the public pages so the theme stays consistent with the console (Tailwind + the existing emerald/teal accent, light surfaces).
- Messaging covers the real Phase 13 scope: AI workflow automation, AI agents, autonomous execution, governance and enterprise reliability - descriptive, no invented customer counts, uptime figures or performance numbers.
- /pricing renders the live catalog (GET /api/v1/billing/plans); the other public pages are static content. CTAs link to the existing /register and /login routes.
- The Next.js boilerplate landing (app/page.tsx) is replaced by the marketing home, as recorded in PHASE-13-ARCHITECTURE.md section 11.

## 8. Testing strategy

- tests/customerConsole.test.tsx (vitest + Testing Library, mocking customerApi and next/navigation, following tests/dashboard.test.tsx):
  - customer dashboard renders account, plan and usage headlines from account data;
  - subscription data displays (plan, status, billing period, invoices);
  - usage dashboard displays all metered metrics with limits;
  - loading state renders while the account request is pending;
  - error state renders the API error message and offers a retry;
  - permission restrictions - billing controls are disabled for a role without WORKFLOW_CREATE, and /admin/customers renders an access-denied state for a non-OWNER/ADMIN role.
- Existing backend suites stay green (npm run typecheck, npm test); frontend verification is npm run typecheck, npm test, npm run build.

## 9. Impact and non-goals

- No backend, schema, index or migration impact: this layer only renders existing Phase 13 APIs.
- No new state stores, API clients or design-system primitives; no fixture/mock data in product code.
- No i18n, billing portal redirect or checkout flow in this phase.
- Screenshots are captured manually after deployment (see PHASE-13-ARCHITECTURE.md).
