# Server Route Refactor — Design Spec

## Goal

Reorganize `app.ts` (621 lines) into focused modules so the server is easy to understand and extend as a boilerplate template. Route logic, middleware, and config each get their own files. `app.ts` becomes a thin composition root.

## Current State

`app.ts` contains everything: Express app creation, body parsing, session, CSRF, rate limiting, 3 middleware helpers, RP config, session type augmentation, and 13 route handlers across 6 domains. A developer looking to add a new feature has to read 600+ lines to understand the wiring before adding their code at the bottom.

## Target Structure

```
server/src/
├── app.ts              # Composition root (~40 lines)
├── server.ts           # listen() — already exists
├── db.ts               # Data layer — unchanged
├── config.ts           # RP config + session type augmentation
├── middleware.ts        # Auth middleware, helpers, CSRF factory, rate limiters
└── routes/
    ├── auth.ts          # /api/auth/* (register, login, logout, recover, step-up)
    ├── user.ts          # /api/me
    ├── passkeys.ts      # /api/passkeys/:id
    └── sensitive.ts     # /api/sensitive/action
```

## File Responsibilities

### `config.ts`

Exports:
- `rpName` — Relying party display name (`"Passkey Vault"`)
- `rpID` — Relying party ID (`"localhost"`)
- `origin` — Expected WebAuthn origin (`"http://localhost:5173"`)
- `sessionSecret` — Session secret (`"replace-this-in-production"`)
- `cookieSecret` — Cookie parser secret (`"replace-this-in-production"`)
- `csrfSecret` — CSRF secret (`"replace-this-csrf-secret-in-production"`)

All "replace in production" secrets are centralized here so template users have one file to update.

Contains:
- `declare module "express-session"` augmentation (adds `userId` and `stepUpUntil` to `SessionData`)

### `middleware.ts`

Exports:
- `requireSession` — Express middleware, returns 401 if no `req.session.userId`
- `requireRecentStepUp` — Express middleware, returns 403 if `stepUpUntil` is missing or expired
- `getClientIp` — Helper that extracts client IP from `x-forwarded-for` or `req.ip`
- `generalLimiter` — Rate limiter (100 req / 15 min)
- `authLimiter` — Rate limiter (10 req / 1 min)
- `createCsrfProtection(secret: string)` — Factory function that accepts a CSRF secret, calls `doubleCsrf(...)`, and returns `{ generateToken, doubleCsrfProtection }`. This lets `app.ts` pass the secret from `config.ts` and set up both the token endpoint and the protection middleware.

### `routes/auth.ts`

Exports: `authRouter` (an `express.Router`)

Mounts at `/api/auth` in `app.ts`. Contains:
- `POST /register/options` — with `authLimiter`
- `POST /register/verify` — with `authLimiter`
- `POST /login/options` — with `authLimiter`
- `POST /login/verify` — with `authLimiter`
- `POST /logout` — with `requireSession`
- `POST /recover` — with `authLimiter`
- `POST /step-up/options` — with `requireSession`
- `POST /step-up/verify` — with `requireSession`

Imports from: `../config`, `../middleware`, `../db`, `@simplewebauthn/server`, `@simplewebauthn/types`, `node:crypto`

### `routes/user.ts`

Exports: `userRouter` (an `express.Router`)

Mounts at `/api` in `app.ts`. Contains:
- `GET /me` — with `requireSession`

Imports from: `../middleware`, `../db`

### `routes/passkeys.ts`

Exports: `passkeysRouter` (an `express.Router`)

Mounts at `/api/passkeys` in `app.ts`. Contains:
- `PATCH /:id` — with `requireSession`
- `DELETE /:id` — with `requireSession`

Imports from: `../middleware` (`requireSession`, `getClientIp`), `../db` (`renamePasskey`, `deletePasskey`, `logAuditEvent`)

### `routes/sensitive.ts`

Exports: `sensitiveRouter` (an `express.Router`)

Mounts at `/api/sensitive` in `app.ts`. Contains:
- `POST /action` — with `requireSession`, `requireRecentStepUp`

Imports from: `../middleware` (`requireSession`, `requireRecentStepUp`, `getClientIp`), `../db` (`logAuditEvent`)

This is the example "protected route" that template users can replace or extend.

### `app.ts` — Composition root

Responsibilities (in order):
1. Create Express app
2. Mount body parser (`express.json()`) and cookie parser
3. Mount session middleware
4. Set up CSRF: mount `GET /api/csrf-token` endpoint, then mount `doubleCsrfProtection` globally
5. Mount `generalLimiter` on `/api`
6. Mount routers:
   - `app.use("/api/auth", authRouter)`
   - `app.use("/api", userRouter)`
   - `app.use("/api/passkeys", passkeysRouter)`
   - `app.use("/api/sensitive", sensitiveRouter)`
7. `export default app`

No business logic. No handler functions. Approximately 40-50 lines.

## Route Path Adjustment

When a router is mounted at a prefix, its internal routes are relative to that prefix:

| Current path in app.ts | Mounted at | Router-internal path |
|------------------------|------------|---------------------|
| `/api/auth/register/options` | `/api/auth` | `/register/options` |
| `/api/auth/register/verify` | `/api/auth` | `/register/verify` |
| `/api/auth/login/options` | `/api/auth` | `/login/options` |
| `/api/auth/login/verify` | `/api/auth` | `/login/verify` |
| `/api/auth/logout` | `/api/auth` | `/logout` |
| `/api/auth/recover` | `/api/auth` | `/recover` |
| `/api/auth/step-up/options` | `/api/auth` | `/step-up/options` |
| `/api/auth/step-up/verify` | `/api/auth` | `/step-up/verify` |
| `/api/me` | `/api` | `/me` |
| `/api/passkeys/:id` (PATCH) | `/api/passkeys` | `/:id` |
| `/api/passkeys/:id` (DELETE) | `/api/passkeys` | `/:id` |
| `/api/sensitive/action` | `/api/sensitive` | `/action` |

## Test Impact

- **No test logic changes.** The tests mock `../src/db` and `@simplewebauthn/server`. Since `db.ts` stays in the same location and the route handlers move but their behavior is identical, all 50 tests should pass without modification.
- The tests import `app` from `../src/app`, which still exports the fully composed Express app with all routers mounted.
- The `vi.mock("@simplewebauthn/server")` call still intercepts the import regardless of which file does the importing (route files import it, but the mock applies to the entire module graph).
- **Verification step:** Run `npm test` after the refactor to confirm all 50 tests pass.

## Constraints

- Pure refactor — no behavior changes, no new features, no route path changes
- All 50 existing tests must continue to pass without modification
- Handler logic moves verbatim — no rewriting, no "improving while we're at it"
