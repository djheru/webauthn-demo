# WebAuthn Passwordless Authentication Demo

## Project Overview

A production-hardened WebAuthn (passkey) authentication system with a Node.js/Express backend and React frontend. Users register biometric passkeys, authenticate with device-bound cryptographic proof, and access protected routes through short-lived server sessions.

## Architecture

```
webauthn-demo/
├── server/          # Express + TypeScript backend
│   └── src/
│       ├── app.ts   # Express server, routes, middleware
│       └── db.ts    # SQLite data layer (better-sqlite3)
└── client/          # React + Vite + TailwindCSS frontend
    └── src/
        ├── App.tsx           # Router + auth context provider
        ├── lib/webauthn.ts   # WebAuthn browser helpers (SimpleWebAuthn)
        ├── pages/            # Route-level page components
        └── components/       # Shared UI components
```

## Tech Stack

- **Backend**: Express 4, TypeScript, better-sqlite3, @simplewebauthn/server, express-session, express-rate-limit, csrf-csrf, pino
- **Frontend**: React 18, Vite, TailwindCSS, @simplewebauthn/browser, react-router-dom
- **Auth model**: WebAuthn passkeys → short server sessions (10 min) → step-up re-auth for sensitive ops

## Key Design Decisions

### Challenge Storage
Challenges are stored in the SQLite `challenges` table, NOT in `req.session`. This prevents a race condition where two browser tabs overwrite each other's pending challenge. Each challenge is consumed atomically via `DELETE ... RETURNING`.

### Public Key Serialization
`publicKey` is stored as a SQLite `BLOB` (raw binary). The `toUint8Array()` helper in `db.ts` converts `Buffer → Uint8Array` at the read boundary. Never serialize public keys as hex strings or JSON arrays — this causes subtle verification failures.

### User Enumeration Prevention
The `/auth/login/options` endpoint returns valid-looking empty options for unknown emails. The authenticator ceremony will simply fail (no matching credential), which is indistinguishable from a canceled prompt.

### Consistent User Verification
`userVerification` is set to `'required'` across all three ceremony types (registration, authentication, step-up). Inconsistency here causes failures on certain authenticators that create credentials without UV capability.

### Counter Mismatch Detection
Authentication verifies that `newCounter > storedCounter`. A backward counter is logged as a `security.counter_mismatch` audit event — it's one of the few signals for detecting cloned authenticators.

## Running Locally

```bash
# Terminal 1 — backend
cd server
npm install
npm run dev          # Runs on :3001

# Terminal 2 — frontend
cd client
npm install
npm run dev          # Runs on :5173, proxies /api → :3001
```

## API Routes

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /api/csrf-token | None | Fetch CSRF token |
| POST | /api/auth/register/options | None | Get registration challenge |
| POST | /api/auth/register/verify | None | Verify registration response |
| POST | /api/auth/login/options | None | Get authentication challenge |
| POST | /api/auth/login/verify | None | Verify authentication response |
| POST | /api/auth/logout | Session | Destroy session |
| POST | /api/auth/recover | None | Use recovery code |
| GET | /api/me | Session | Get current user + passkeys |
| PATCH | /api/passkeys/:id | Session | Rename a passkey |
| DELETE | /api/passkeys/:id | Session | Revoke a passkey (not last one) |
| POST | /api/auth/step-up/options | Session | Get step-up challenge |
| POST | /api/auth/step-up/verify | Session | Verify step-up response |
| POST | /api/billing/payout | Session + Step-up | Example sensitive route |

## Session & Cookie Config

- Session lifetime: 10 minutes (`maxAge`)
- Session cookie: `httpOnly`, `sameSite: lax`, `secure: false` (localhost)
- CSRF token: sent via `X-CSRF-Token` header on all POST/PATCH/DELETE
- Step-up window: 5 minutes after fresh WebAuthn ceremony

## SQLite Schema (auto-created)

- `users` — id, email, webauthn_user_id (BLOB), recovery_code_hash
- `passkeys` — id, user_id (FK), public_key (BLOB), counter, device_type, backed_up, transports (JSON), label
- `challenges` — challenge (PK), user_id, purpose, expires_at
- `audit_log` — id, user_id, event, detail, ip, created_at

## Testing WebAuthn Locally

- Must use `localhost` — WebAuthn requires a secure context
- rpID is set to `localhost`, origin to `http://localhost:5173`
- Use Touch ID, Face ID, Windows Hello, or a security key
- Chrome DevTools → Application → WebAuthn can simulate virtual authenticators

## Common Issues

- **"The operation is not supported"**: Browser doesn't support WebAuthn or isn't on localhost/HTTPS
- **Verification failures after DB changes**: Ensure `public_key` round-trips as binary, not string. Use `toUint8Array()` from `db.ts`
- **Challenge expired**: Challenges auto-expire after 5 minutes. Stale tabs will fail — retry the flow
- **"Cannot delete last passkey"**: By design. Register a second credential first, or use the recovery flow
