# Server Unit Tests — Design Spec

## Goal

Add a comprehensive, descriptive unit test suite for the Express server using **Vitest + Supertest**. Tests mock `@simplewebauthn/server` and `./db` so they exercise route logic, middleware, session handling, and error paths without touching real cryptography or SQLite.

## Testability Refactor

`app.ts` currently calls `app.listen()` at module scope. Split into:

- **`app.ts`** — Configures and `export default app` (no `listen()`)
- **`server.ts`** — Imports `app`, calls `app.listen()`. New entrypoint.

Update `package.json` scripts:

```json
"dev": "tsx watch src/server.ts",
"start": "node dist/server.js"
```

## Dependencies

Add to `devDependencies`:

- `vitest`
- `supertest`
- `@types/supertest`

## Config

`vitest.config.ts` at server root:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

`package.json` scripts (in addition to updated `dev`/`start`):

```json
"test": "vitest run",
"test:watch": "vitest"
```

### CJS Compatibility Note

`tsconfig.json` uses `"module": "commonjs"`. Vitest handles CJS interop natively, but if mock hoisting issues arise with `vi.mock()`, add `deps.interopDefault: true` to the Vitest config.

## Mocking Strategy

### `@simplewebauthn/server`

Mock all four public functions:

- `generateRegistrationOptions` — returns a fake options object with a known `challenge` string
- `generateAuthenticationOptions` — same
- `verifyRegistrationResponse` — returns `{ verified: true/false, registrationInfo: {...} }`
- `verifyAuthenticationResponse` — returns `{ verified: true/false, authenticationInfo: { newCounter } }`

### `./db`

Mock the entire module. Each test configures return values per function:

- `findUserByEmail`, `findUserById` — return a test user or `undefined`
- `createUser` — return a test user
- `getPasskeysByUser`, `getPasskeyById` — return test passkeys or empty arrays
- `consumeChallenge` — return `{ user_id }` or `undefined`
- `storeChallenge`, `savePasskey`, `updateCounter`, `renamePasskey`, `deletePasskey`, `setRecoveryCodeHash`, `logAuditEvent` — spies for call assertions
- `toUint8Array` — pass through real implementation (it's a pure Buffer→Uint8Array helper)

### `node:crypto`

Not mocked. Tests assert on structural properties (e.g., "response contains `recoveryCode` that is a 32-char hex string") rather than exact values. `randomUUID` and `randomBytes` are non-deterministic but their outputs are validated by shape, not value.

### CSRF

Tests use a Supertest agent that first hits `GET /api/csrf-token` to capture the token and `__csrf` cookie, then attaches the `X-CSRF-Token` header on subsequent requests.

### Sessions

`express-session` with the default in-memory store. Supertest agent preserves cookies, so session continuity works across requests within a test.

### Rate Limiting

Rate limiters (`generalLimiter`, `authLimiter`) are not tested in this suite. They use `express-rate-limit` with default in-memory stores and would require sending 10+ or 100+ requests to trigger, which is better suited for integration tests.

## Test File Structure

```
server/
├── src/
│   ├── app.ts          # export default app (no listen)
│   ├── server.ts       # NEW — import app, call listen()
│   └── db.ts
└── tests/
    ├── helpers/
    │   └── setup.ts
    ├── registration.test.ts
    ├── authentication.test.ts
    ├── session.test.ts
    ├── credentials.test.ts
    ├── recovery.test.ts
    ├── step-up.test.ts
    └── middleware.test.ts
```

## Test Helpers (`tests/helpers/setup.ts`)

```typescript
// Authenticated agent — CSRF token + active session
async function createAuthenticatedAgent(): Promise<{
  agent: supertest.SuperAgentTest;
  csrfToken: string;
  userId: string;
}>

// CSRF-only agent — token but no session
async function createCsrfAgent(): Promise<{
  agent: supertest.SuperAgentTest;
  csrfToken: string;
}>

// Shared fixtures
const TEST_USER: DbUser
const TEST_PASSKEY: DbPasskey
```

## Coverage Map

### `registration.test.ts` (~9 cases)

| Scenario | Verifies |
|----------|----------|
| Options — new user | Creates user, stores challenge, returns options |
| Options — existing user | Reuses user, passes `excludeCredentials` |
| Options — missing/invalid email | 400 |
| Verify success — first passkey | `verified: true`, recovery code, session set, audit log |
| Verify success — additional passkey | No recovery code (passkeyCount > 1) |
| Verify failure — rejected | 400, audit `registration.failed` |
| Verify — user deleted between options and verify | 400 |
| Verify — invalid/expired challenge | 400, `"Invalid or expired challenge"` |
| Verify — simplewebauthn throws | 400, audit `registration.error` |

### `authentication.test.ts` (~10 cases)

| Scenario | Verifies |
|----------|----------|
| Options — known user | Returns options with user's credentials |
| Options — unknown user (anti-enumeration) | Valid-looking empty options, stores dummy challenge |
| Options — missing/invalid email | 400 |
| Verify success | Session set, counter updated, audit log |
| Verify — counter mismatch | Logs `security.counter_mismatch`, still succeeds |
| Verify failure — assertion rejected | 400, no session |
| Verify — passkey not found or user mismatch | 400, audit `login.failed` with `"Passkey mismatch"` |
| Verify — user not found after challenge consumed | 400 |
| Verify — invalid/expired challenge | 400 |
| Verify — simplewebauthn throws | 400, audit `login.error` (user_id: null) |

### `session.test.ts` (~5 cases)

| Scenario | Verifies |
|----------|----------|
| `GET /me` — authenticated | Returns user + passkeys with correct shape |
| `GET /me` — no session | 401 |
| `GET /me` — user deleted | 404 |
| Logout — authenticated | Destroys session, clears cookie, audit log |
| Logout — no session | 401 |

### `credentials.test.ts` (~7 cases)

| Scenario | Verifies |
|----------|----------|
| Rename passkey | Calls `renamePasskey`, audit log |
| Rename — label too long / missing | 400 |
| Rename — no session | 401 |
| Delete passkey | Calls `deletePasskey`, audit log |
| Delete — last passkey (blocked) | 400, `"Cannot delete"` |
| Delete — passkey not found or not owned | 400 |
| Delete — no session | 401 |

### `recovery.test.ts` (~4 cases)

| Scenario | Verifies |
|----------|----------|
| Happy path | Validates hash, consumes code, issues new code, sets session |
| Wrong code | 400, audit `recovery.failed` |
| Unknown email | 400, same error message (no enumeration) |
| Missing fields | 400 |

### `step-up.test.ts` (~11 cases)

| Scenario | Verifies |
|----------|----------|
| Step-up options — authenticated | Returns challenge for user's passkeys |
| Step-up options — user deleted | 404 |
| Step-up options — no session | 401 |
| Step-up verify success | Sets `stepUpUntil`, audit log |
| Step-up verify failure — assertion rejected | 400, no `stepUpUntil` |
| Step-up verify — passkey not found | 400 |
| Step-up verify — challenge belongs to different user | 400 |
| Step-up verify — simplewebauthn throws | 400, audit `stepup.error` (user_id from session) |
| Sensitive action (`POST /api/sensitive/action`) — valid step-up | 200, audit log |
| Sensitive action — expired step-up | 403 |
| Sensitive action — no session | 401 |

### `middleware.test.ts` (~4 cases)

| Scenario | Verifies |
|----------|----------|
| CSRF — missing token | 403 on POST |
| CSRF — valid token | Passes through |
| `requireSession` — no session | 401 |
| `requireRecentStepUp` — expired | 403 |

**Total: ~50 test cases across 7 files.**

## Conventions

- Each test file mocks `../src/db` and `@simplewebauthn/server` at the top
- `beforeEach` restores all mocks and sets sensible defaults
- Assertions check: HTTP status, response body, DB function call arguments
- No test ordering dependencies — each test is self-contained
- Tests serve as documentation — descriptive `describe`/`it` labels explain the expected behavior
- The sensitive action route is `POST /api/sensitive/action` (not `/api/billing/payout` as referenced in some older docs)
