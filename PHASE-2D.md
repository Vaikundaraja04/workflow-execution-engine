# Phase 2D: authentication and authorization

Phase 2D adds user accounts, bearer-token authentication, and per-user ownership enforcement to the existing API. The graph engine, queue layer, worker process, and execution lifecycle are not changed.

Status: planned. No code changes are made until this plan is approved.

## Goals

- Register and log in with email and password.
- Issue short-lived JWT access tokens and rotating, revocable refresh tokens.
- Require a valid access token on every workflow and execution endpoint.
- Enforce ownership: a user can read or modify only their own workflows and executions.
- Keep the existing JSON error shape and error-code style.

## Scope

### In scope

- User accounts with argon2id password hashing.
- Email and password registration and login.
- HS256 access tokens with a short TTL.
- Opaque refresh tokens stored hashed, with rotation and replay detection.
- Logout (session revocation) and a refresh-token collection with a TTL index.
- A requireAuth middleware and per-route protection of all Phase 2B and 2C endpoints.
- ownerId on workflows and executions with owner-scoped queries.
- New error codes, new environment variables, new tests, updated README.

### Out of scope

- OAuth or social login.
- Email verification and password reset.
- Roles, admin access, teams, or organization tenancy.
- API keys for machine-to-machine access.
- Rate limiting, login lockout, 2FA, audit logging.
- Frontend work of any kind.
- Backfill of pre-2D development data (see Migration notes).

## Design decisions

1. Access token: JWT (HS256) with sub = user id and exp; default TTL 15 minutes. Verified statelessly, with no database read per request.
2. Refresh token: 32 random bytes encoded as base64url; only its SHA-256 hash is stored. Default TTL 30 days; a TTL index deletes expired documents.
3. Refresh rotation: every refresh revokes the presented token and issues a new token in the same session family (familyId). Replaying a revoked token revokes the whole family (reuse detection) and returns 401 INVALID_REFRESH_TOKEN.
4. Password hashing: argon2id through the argon2 package (memoryCost 19456 KiB, timeCost 2, parallelism 1). Fallback if the native install causes friction on Windows: node:crypto scrypt (N=2^17, r=8, p=1, raised maxmem) behind the same passwordService interface.
5. Login errors: unknown email and wrong password both return 401 INVALID_CREDENTIALS. Unknown emails are still verified against a fixed dummy hash so response timing does not reveal account existence.
6. Cross-user access returns 404, not 403. Queries are scoped by ownerId and reuse WORKFLOW_NOT_FOUND and EXECUTION_NOT_FOUND, so the API never reveals which ids exist.
7. Ownership is stamped at creation. Executions copy ownerId from the workflow, and it never changes. Worker, retry, and recovery functions stay unscoped because they run in the trusted worker process.
8. JWT library: jose (ESM-native, typed, no @types package). jsonwebtoken was considered and rejected because it needs a separate types package.
9. Configuration is injected through createApp options, matching the existing ExecutionQueue injection, so tests pass a fixed secret and services never read process env directly.
10. Route protection is applied per route inside router factories, so unknown routes keep returning 404 NOT_FOUND (existing API test 16 stays valid).

## API contract

### Auth endpoints (public)

| Method | Path | Request body | Success | Failure |
| --- | --- | --- | --- | --- |
| POST | /api/auth/register | { email, password } | 201 session | 400 INVALID_REQUEST, 409 EMAIL_TAKEN |
| POST | /api/auth/login | { email, password } | 200 session | 400 INVALID_REQUEST, 401 INVALID_CREDENTIALS |
| POST | /api/auth/refresh | { refreshToken } | 200 rotated tokens | 400 INVALID_REQUEST, 401 INVALID_REFRESH_TOKEN |
| POST | /api/auth/logout | { refreshToken } | 204 | 400 INVALID_REQUEST |

Session response (register and login):

```json
{
  "user": { "id": "665f1c1e8f3a2b4c5d6e7f80", "email": "durai@example.com" },
  "accessToken": "<jwt>",
  "refreshToken": "<opaque-token>",
  "tokenType": "Bearer",
  "expiresIn": 900
}
```

Refresh response: accessToken, refreshToken, tokenType, expiresIn with a rotated pair and no user object.

Logout is idempotent: it revokes the family of the presented refresh token, and unknown or expired tokens still return 204 with no body.

Validation (strict zod schemas, unknown fields rejected):

- email: trimmed, lowercased, valid format, max 254 characters.
- password: 8 to 128 characters.

### Protected endpoints

All Phase 2B and 2C endpoints keep their paths and response bodies, and now require Authorization: Bearer <accessToken>. /health stays public.

| Endpoint | Ownership rule |
| --- | --- |
| POST /api/workflows | created with ownerId = authenticated user |
| GET /api/workflows/:id | owner only |
| PUT /api/workflows/:id/draft | owner only |
| POST /api/workflows/:id/validate | owner only |
| POST /api/workflows/:id/publish | owner only |
| GET /api/workflows/:id/versions | owner only |
| POST /api/workflows/:id/executions | owner of the workflow; the execution copies ownerId |
| GET /api/executions/:executionId | owner only |
| GET /api/workflows/:id/executions | owner of the workflow |

Idempotency semantics are unchanged: keys remain unique per workflow, requests are authorized before idempotency is evaluated, and a user can never reach another user execution through their own workflow.

## Error codes

Added to the central ERROR_MAP in src/api/middleware/errorHandler.ts:

| Code | Status | Message |
| --- | --- | --- |
| UNAUTHENTICATED | 401 | Authentication required |
| INVALID_TOKEN | 401 | Access token is invalid |
| TOKEN_EXPIRED | 401 | Access token has expired |
| INVALID_CREDENTIALS | 401 | Email or password is incorrect |
| INVALID_REFRESH_TOKEN | 401 | Refresh token is invalid or expired |
| EMAIL_TAKEN | 409 | Email is already registered |

Duplicate-key errors during registration are caught in the service and rethrown as EMAIL_TAKEN, so the generic MongoDB 11000 mapping (VERSION_CONFLICT) never applies to users.

## Data model changes

### New collection: users (UserModel)

| Field | Type | Notes |
| --- | --- | --- |
| email | string | required, unique index, trimmed, lowercased, max 254 |
| passwordHash | string | required, select: false, never loaded unless explicitly requested |
| createdAt, updatedAt | Date | timestamps |

Responses use a toUserView helper that returns only { id, email }.

### New collection: refresh_tokens (RefreshTokenModel)

| Field | Type | Notes |
| --- | --- | --- |
| userId | ObjectId ref User | required |
| tokenHash | string | required, unique index (SHA-256 of the opaque token) |
| familyId | string | required, session family id |
| expiresAt | Date | required, TTL index (expireAfterSeconds: 0) |
| revokedAt | Date | optional; set on rotation, logout, or replay detection |
| createdAt | Date | timestamps, createdAt only |

### Changed: Workflow (WorkflowModel)

- ownerId: ObjectId ref User, required.
- No new index in this phase (queries are by _id). A future "list my workflows" endpoint should add { ownerId: 1, createdAt: -1 }.

### Changed: WorkflowExecution (WorkflowExecutionModel)

- ownerId: ObjectId ref User, required, copied from the workflow at creation and immutable.
- Version records remain owned indirectly through their workflow.

## Configuration

New environment variables, validated in src/config/env.ts and documented in .env.example and README:

```env
AUTH_JWT_SECRET=change-me-to-a-random-32-byte-secret
AUTH_ACCESS_TOKEN_TTL_SECONDS=900
AUTH_REFRESH_TOKEN_TTL_SECONDS=2592000
```

AUTH_JWT_SECRET is required and at least 32 characters; startup fails fast otherwise. server.ts builds an AuthConfig object from env and passes it to createApp. createApp requires authConfig, and tests pass a fixed test secret.

## Code changes by file

New files:

| File | Purpose |
| --- | --- |
| src/types/auth.ts | AuthConfig, AuthenticatedUser, UserView, SessionView |
| src/types/express.d.ts | Request.user augmentation |
| src/models/UserModel.ts | users collection |
| src/models/RefreshTokenModel.ts | refresh_tokens collection with TTL index |
| src/services/passwordService.ts | hashPassword and verifyPassword |
| src/services/tokenService.ts | access sign/verify, refresh create/hash, JWT error mapping |
| src/services/authService.ts | registerUser, loginUser, issueSession, rotateSession, revokeSession |
| src/schemas/authSchema.ts | strict zod schemas for the four auth requests |
| src/api/middleware/requireAuth.ts | createRequireAuth(config): bearer parsing, verification, req.user |
| src/api/routes/authRoutes.ts | createAuthRouter(config) factory |
| tests/authApi.test.ts | auth integration suite |
| tests/authz.test.ts | ownership integration suite |
| tests/authHelpers.ts | shared test helpers (flat file, no new folder) |
| tests/passwordService.test.ts, tests/tokenService.test.ts | unit suites |

Changed files:

| File | Change |
| --- | --- |
| package.json | add argon2 and jose |
| .env.example | add the three AUTH_* variables |
| src/config/env.ts | validate AUTH_JWT_SECRET and the two TTL values |
| src/models/WorkflowModel.ts | ownerId required |
| src/models/WorkflowExecutionModel.ts | ownerId required |
| src/services/workflowService.ts | ownerId scoping on create, get, update, validate, publish, versions |
| src/services/executionService.ts | ownerId scoping on create, get, and list; worker and recovery functions unchanged |
| src/api/middleware/errorHandler.ts | six new codes |
| src/api/routes/workflowRoutes.ts | convert to createWorkflowRouter(requireAuth) with per-route protection |
| src/api/routes/executionRoutes.ts | accept requireAuth and apply it per route |
| src/api/app.ts | authConfig option, mount the auth router, wire requireAuth |
| src/api/server.ts | build AuthConfig from env |
| tests/workflowApi.test.ts | pass test authConfig; register a user; send Authorization headers |
| tests/executionRuntime.test.ts | pass test authConfig; authenticate requests; pass ownerId in service calls |
| README.md | Phase 2D section, endpoints, error codes, env vars, limitations |

Unaffected files (confirmed by review): src/index.ts exports, src/demo.ts, src/engine/*, src/workers/*, src/queues/*, tests/executionContracts.test.ts, tests/index.test.ts, tests/executionQueue.test.ts.

## Testing plan

New suites:

- tests/authApi.test.ts (integration with MongoMemoryReplSet and supertest):
  - register returns 201 with a session and no passwordHash
  - duplicate email returns 409 EMAIL_TAKEN
  - invalid email and short password return 400 INVALID_REQUEST
  - email normalization: register with mixed case, log in with lowercase
  - wrong password and unknown email both return 401 INVALID_CREDENTIALS
  - refresh rotates tokens and the previous refresh token stops working
  - replay of a rotated token revokes the family (the newest token also stops working)
  - logout revokes the session; refresh after logout returns 401
  - expired access token returns 401 TOKEN_EXPIRED; malformed token returns 401 INVALID_TOKEN
- tests/authz.test.ts (integration):
  - user B gets 404 on every workflow endpoint for user A workflow
  - user B gets 404 for A execution id and A workflow execution list
  - user B cannot create an execution against A workflow
  - ownerId cannot be spoofed through request bodies (strict schemas reject it)
- Unit suites: password hashing roundtrip and failure; token sign/verify roundtrip; tampered token; expired token mapping.

Updated suites:

- tests/workflowApi.test.ts and tests/executionRuntime.test.ts register a user through the new helper and send Authorization headers; service-level calls pass ownerId.
- tests/authHelpers.ts provides createUser and authHeader helpers so the updates stay small.
- Suites that do not touch the API or the changed services need no changes.

## Security notes

- Passwords, access tokens, and refresh tokens are never logged or returned in responses.
- Refresh tokens are stored only as SHA-256 hashes; plaintext exists only in transit.
- Access tokens are validated statelessly; revocation is handled through refresh tokens.
- Production deployments should terminate TLS in front of the API.

## Migration notes

Development databases contain workflows and executions without ownerId. After Phase 2D they are not reachable through the API. This phase does not include a backfill; local development data should be recreated. Automated tests create their own data and are unaffected.

## Acceptance criteria

- npm run typecheck passes.
- npm test passes, including the new auth and authorization suites.
- Every /api/workflows* and /api/executions* request without a valid token returns 401 with a documented code.
- Cross-user access always returns 404 with the existing codes, and no response ever contains passwordHash or refresh-token data.
- Refresh replay revokes the session family; logout revokes the session.
- Startup fails fast when AUTH_JWT_SECRET is missing or shorter than 32 characters.
- npm audit --audit-level=high reports no high or critical issues.
- README documents Phase 2D, the auth endpoints, error codes, and env vars.

## Open questions for review

1. Password hashing dependency: accept the argon2 native package, or start with zero-dependency node:crypto scrypt?
2. Logout scope: revoke only the presented session family (current plan), or add an option to revoke all sessions of the user?

## Implementation order

1. Dependencies (argon2, jose), env schema, .env.example.
2. User model and passwordService; authService register and login with duplicate-key handling.
3. tokenService and RefreshToken model: access sign/verify, refresh issue, rotate, revoke.
4. Auth schemas, auth router factory, and app wiring; auth integration tests.
5. requireAuth middleware; per-route protection of the workflow and execution routers; 401 tests.
6. Ownership: ownerId on both models, owner scoping in the services.
7. Update existing suites, add authorization tests, run typecheck, full test run, audit.
8. Update README.
