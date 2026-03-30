# WebAuthn Passkey Authentication Demo

A production-hardened WebAuthn (passkey) authentication boilerplate with a Node.js/Express backend and React frontend. Users register biometric passkeys, authenticate with device-bound cryptographic proof, and access protected routes through short-lived server sessions.

Use this as a **GitHub template** to build passwordless authentication into your own application.

## Quick Start

```bash
# Clone from template
gh repo create my-app --template djheru/webauthn-demo
cd my-app

# Terminal 1 - Backend
cd server
npm install
npm run dev          # http://localhost:3001

# Terminal 2 - Frontend
cd client
npm install
npm run dev          # http://localhost:5173
```

Open `http://localhost:5173`, register with any email, and authenticate with Touch ID / Face ID / Windows Hello / a security key.

> WebAuthn requires a **secure context**. Use `localhost` for development. For deployment, you'll need HTTPS.

## How the Authentication Works

### The WebAuthn Flow

WebAuthn replaces passwords with public-key cryptography. The server never sees or stores a secret -- it only stores the **public key**. The private key never leaves the user's device.

```
Registration:
  Browser                        Server                      Authenticator
    |-- POST /register/options -->|                              |
    |<-- challenge + RP config ---|                              |
    |                             |                              |
    |-- "Create credential" ----->|                              |
    |                             |------- User verification --->|
    |                             |<------ New key pair ---------|
    |                             |                              |
    |-- POST /register/verify --->|                              |
    |   (public key + attestation)|                              |
    |<-- { verified, session } ---|                              |

Authentication:
  Browser                        Server                      Authenticator
    |-- POST /login/options ----->|                              |
    |<-- challenge + credential --|                              |
    |                             |                              |
    |-- "Sign challenge" -------->|                              |
    |                             |------- User verification --->|
    |                             |<------ Signed assertion -----|
    |                             |                              |
    |-- POST /login/verify ------>|                              |
    |   (signed assertion)        |                              |
    |<-- { verified, session } ---|                              |
```

### Session Model

- **Session lifetime:** 10 minutes (configurable in `server/src/app.ts`)
- **Session cookie:** `httpOnly`, `sameSite: lax`, `secure: false` (set `true` in production)
- **Step-up window:** 5 minutes after a fresh WebAuthn ceremony for sensitive operations

### Challenge Storage

Challenges are stored in a **SQLite table**, not in `req.session`. This prevents a race condition where two browser tabs overwrite each other's pending challenge. Each challenge is consumed atomically via `DELETE ... RETURNING`.

### Security Features

| Feature | How It Works |
|---------|-------------|
| **Anti-enumeration** | `/login/options` returns valid-looking empty options for unknown emails |
| **Counter detection** | Backward counters are logged as `security.counter_mismatch` (cloned authenticator signal) |
| **CSRF protection** | Double-submit cookie via `csrf-csrf` (`X-CSRF-Token` header) |
| **Rate limiting** | 100 req/15min general, 10 req/min on auth endpoints |
| **Step-up auth** | Sensitive operations require a fresh WebAuthn ceremony within 5 minutes |
| **Recovery codes** | SHA-256 hashed, issued on first passkey registration, single-use with rotation |
| **Audit logging** | Every auth event logged with user ID, event type, detail, and IP |

## Project Structure

```
webauthn-demo/
├── server/                          # Express + TypeScript backend
│   └── src/
│       ├── app.ts                   # Composition root (~50 lines)
│       ├── server.ts                # listen() entrypoint
│       ├── config.ts                # RP config + secrets (edit this first)
│       ├── middleware.ts            # Auth guards, CSRF, rate limiters
│       ├── db.ts                    # SQLite data layer
│       └── routes/
│           ├── auth.ts              # Register, login, logout, recover, step-up
│           ├── user.ts              # GET /me
│           ├── passkeys.ts          # Rename / revoke passkeys
│           └── sensitive.ts         # Example protected route
│
├── client/                          # React + Vite + TailwindCSS frontend
│   └── src/
│       ├── App.tsx                  # Router + AuthContext provider
│       ├── lib/
│       │   ├── api.ts              # Fetch wrapper with CSRF handling
│       │   └── webauthn.ts         # SimpleWebAuthn browser helpers
│       └── pages/
│           ├── Landing.tsx          # Marketing / home page
│           ├── Auth.tsx             # Register / login / recover tabs
│           └── Dashboard.tsx        # Passkey management + step-up demo
```

## API Routes

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/csrf-token` | None | Fetch CSRF token |
| POST | `/api/auth/register/options` | None | Get registration challenge |
| POST | `/api/auth/register/verify` | None | Verify registration + auto-login |
| POST | `/api/auth/login/options` | None | Get authentication challenge |
| POST | `/api/auth/login/verify` | None | Verify authentication + set session |
| POST | `/api/auth/logout` | Session | Destroy session |
| POST | `/api/auth/recover` | None | Use recovery code |
| GET | `/api/me` | Session | Get current user + passkeys |
| PATCH | `/api/passkeys/:id` | Session | Rename a passkey |
| DELETE | `/api/passkeys/:id` | Session | Revoke a passkey (not last one) |
| POST | `/api/auth/step-up/options` | Session | Get step-up challenge |
| POST | `/api/auth/step-up/verify` | Session | Verify step-up response |
| POST | `/api/sensitive/action` | Session + Step-up | Example sensitive route |

## Configuration

All secrets and relying party config live in `server/src/config.ts`:

```typescript
// --- Relying Party config ---
export const rpName = "Passkey Vault";       // Display name in browser prompts
export const rpID = "localhost";             // Must match the domain
export const origin = "http://localhost:5173"; // Must match the client URL

// --- Secrets (replace all of these in production) ---
export const sessionSecret = "replace-this-in-production";
export const cookieSecret = "replace-this-in-production";
export const csrfSecret = "replace-this-csrf-secret-in-production";
```

For production, set `rpID` to your domain, `origin` to your HTTPS URL, and replace all secrets with random values.

## Extending the App

### Adding a New Route

1. Create a file in `server/src/routes/`:

```typescript
// server/src/routes/billing.ts
import express from "express";
import { logAuditEvent } from "../db";
import { getClientIp, requireRecentStepUp, requireSession } from "../middleware";

export const billingRouter = express.Router();

billingRouter.post("/payout", requireSession, requireRecentStepUp, (req, res) => {
  const { amount, currency } = req.body;

  // Your business logic here
  logAuditEvent(req.session.userId!, "billing.payout", `${amount} ${currency}`, getClientIp(req));

  res.json({ ok: true, message: `Payout of ${amount} ${currency} initiated` });
});
```

2. Mount it in `server/src/app.ts`:

```typescript
import { billingRouter } from "./routes/billing";

// ... after existing routes
app.use("/api/billing", billingRouter);
```

3. Call it from the client:

```typescript
const resp = await apiFetch("/api/billing/payout", {
  method: "POST",
  body: JSON.stringify({ amount: 100, currency: "USD" }),
});
```

### Available Middleware

| Middleware | Import | What It Does |
|-----------|--------|-------------|
| `requireSession` | `../middleware` | Returns 401 if no active session |
| `requireRecentStepUp` | `../middleware` | Returns 403 if step-up window expired (use after `requireSession`) |
| `authLimiter` | `../middleware` | Rate limits to 10 req/min |
| `generalLimiter` | `../middleware` | Rate limits to 100 req/15min (already applied globally) |

### Adding a Client Page

1. Create a page component in `client/src/pages/`
2. Add a route in `client/src/App.tsx`:

```tsx
import Billing from "./pages/Billing";

// Inside the Router:
<Route path="/billing" element={<ProtectedRoute><Billing /></ProtectedRoute>} />
```

Use the `useAuth()` hook to access the current user:

```tsx
import { useAuth } from "../App";

export default function Billing() {
  const { user } = useAuth();
  // user.id, user.email, user.passkeys are available
}
```

## Swapping the Database

The data layer is isolated in `server/src/db.ts`. It exports a set of functions that the route files consume. To switch databases, replace the implementations while keeping the same function signatures.

### Interface to Implement

```typescript
// Users
createUser(id: string, email: string, webauthnUserId: Uint8Array): DbUser
findUserByEmail(email: string): DbUser | undefined
findUserById(id: string): DbUser | undefined
setRecoveryCodeHash(userId: string, hash: string): void

// Passkeys
savePasskey(id, userId, publicKey, counter, deviceType, backedUp, transports?, label?): void
getPasskeysByUser(userId: string): DbPasskey[]
getPasskeyById(id: string): DbPasskey | undefined
updateCounter(passkeyId: string, newCounter: number): void
renamePasskey(passkeyId: string, userId: string, label: string): void
deletePasskey(passkeyId: string, userId: string): boolean
countPasskeysForUser(userId: string): number

// Challenges
storeChallenge(challenge: string, userId: string, purpose: string): void
consumeChallenge(challenge: string, purpose: string): { user_id: string } | undefined

// Audit
logAuditEvent(userId: string | null, event: string, detail: string, ip: string): void

// Helpers
toUint8Array(buf: Buffer): Uint8Array
parseTransports(raw: string | null): string[] | undefined
```

### Example: PostgreSQL with `pg`

```bash
cd server && npm install pg @types/pg
```

```typescript
// server/src/db.ts
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export type DbUser = {
  id: string;
  email: string;
  webauthn_user_id: Buffer;
  recovery_code_hash: string | null;
  created_at: string;
};

export type DbPasskey = {
  id: string;
  user_id: string;
  public_key: Buffer;
  counter: number;
  device_type: "singleDevice" | "multiDevice";
  backed_up: number;
  transports: string | null;
  label: string;
  created_at: string;
  last_used_at: string | null;
};

export const createUser = async (
  id: string,
  email: string,
  webauthnUserId: Uint8Array,
): Promise<DbUser> => {
  const result = await pool.query(
    `INSERT INTO users (id, email, webauthn_user_id)
     VALUES ($1, $2, $3) RETURNING *`,
    [id, email, Buffer.from(webauthnUserId)],
  );
  return result.rows[0];
};

export const findUserByEmail = async (email: string): Promise<DbUser | undefined> => {
  const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
  return result.rows[0];
};

export const findUserById = async (id: string): Promise<DbUser | undefined> => {
  const result = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
  return result.rows[0];
};

export const savePasskey = async (
  id: string,
  userId: string,
  publicKey: Uint8Array,
  counter: number,
  deviceType: string,
  backedUp: boolean,
  transports?: string[],
  label?: string,
): Promise<void> => {
  await pool.query(
    `INSERT INTO passkeys (id, user_id, public_key, counter, device_type, backed_up, transports, label)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, userId, Buffer.from(publicKey), counter, deviceType, backedUp ? 1 : 0,
     transports ? JSON.stringify(transports) : null, label ?? "Unnamed passkey"],
  );
};

export const consumeChallenge = async (
  challenge: string,
  purpose: string,
): Promise<{ user_id: string } | undefined> => {
  const result = await pool.query(
    `DELETE FROM challenges WHERE challenge = $1 AND purpose = $2
     AND expires_at > NOW() RETURNING user_id`,
    [challenge, purpose],
  );
  return result.rows[0];
};

// ... implement remaining functions following the same pattern

export const toUint8Array = (buf: Buffer): Uint8Array =>
  new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);

export const parseTransports = (raw: string | null): string[] | undefined =>
  raw ? JSON.parse(raw) : undefined;
```

**Schema (PostgreSQL):**

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  webauthn_user_id BYTEA NOT NULL,
  recovery_code_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE passkeys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  public_key BYTEA NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  device_type TEXT NOT NULL CHECK (device_type IN ('singleDevice', 'multiDevice')),
  backed_up INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  label TEXT DEFAULT 'Unnamed passkey',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

CREATE TABLE challenges (
  challenge TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('registration', 'authentication', 'step-up')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE audit_log (
  id SERIAL PRIMARY KEY,
  user_id TEXT,
  event TEXT NOT NULL,
  detail TEXT,
  ip TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

> **Important:** When switching to PostgreSQL (async), all `db.ts` functions become `async` and all route handlers that call them must `await` the results. The current SQLite implementation is synchronous, so routes call db functions without `await`.

### Example: DynamoDB with `@aws-sdk/client-dynamodb`

```bash
cd server && npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
```

```typescript
// server/src/db.ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? "webauthn";

export const createUser = async (
  id: string,
  email: string,
  webauthnUserId: Uint8Array,
): Promise<DbUser> => {
  const user: DbUser = {
    id,
    email,
    webauthn_user_id: Buffer.from(webauthnUserId),
    recovery_code_hash: null,
    created_at: new Date().toISOString(),
  };
  await client.send(new PutCommand({
    TableName: TABLE,
    Item: { PK: `USER#${id}`, SK: "PROFILE", ...user, webauthn_user_id: Array.from(webauthnUserId) },
    ConditionExpression: "attribute_not_exists(PK)",
  }));
  return user;
};

export const findUserByEmail = async (email: string): Promise<DbUser | undefined> => {
  // Requires a GSI on email
  const result = await client.send(new QueryCommand({
    TableName: TABLE,
    IndexName: "email-index",
    KeyConditionExpression: "email = :email",
    ExpressionAttributeValues: { ":email": email },
  }));
  return result.Items?.[0] as DbUser | undefined;
};

export const savePasskey = async (
  id: string,
  userId: string,
  publicKey: Uint8Array,
  counter: number,
  deviceType: string,
  backedUp: boolean,
  transports?: string[],
  label?: string,
): Promise<void> => {
  await client.send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK: `USER#${userId}`,
      SK: `PASSKEY#${id}`,
      id, user_id: userId,
      public_key: Array.from(publicKey),
      counter, device_type: deviceType,
      backed_up: backedUp ? 1 : 0,
      transports: transports ? JSON.stringify(transports) : null,
      label: label ?? "Unnamed passkey",
      created_at: new Date().toISOString(),
      last_used_at: null,
    },
  }));
};

export const consumeChallenge = async (
  challenge: string,
  purpose: string,
): Promise<{ user_id: string } | undefined> => {
  try {
    const result = await client.send(new DeleteCommand({
      TableName: TABLE,
      Key: { PK: `CHALLENGE#${challenge}`, SK: purpose },
      ConditionExpression: "expires_at > :now",
      ExpressionAttributeValues: { ":now": new Date().toISOString() },
      ReturnValues: "ALL_OLD",
    }));
    return result.Attributes ? { user_id: result.Attributes.user_id as string } : undefined;
  } catch {
    return undefined; // ConditionalCheckFailedException = expired or not found
  }
};

// ... implement remaining functions following the single-table pattern

export const toUint8Array = (buf: Buffer): Uint8Array =>
  new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);

export const parseTransports = (raw: string | null): string[] | undefined =>
  raw ? JSON.parse(raw) : undefined;
```

**DynamoDB table design (single-table):**

| PK | SK | Use |
|----|-----|-----|
| `USER#<id>` | `PROFILE` | User record |
| `USER#<id>` | `PASSKEY#<id>` | Passkey credential |
| `CHALLENGE#<challenge>` | `<purpose>` | Pending challenge (with TTL) |
| `AUDIT#<id>` | `<timestamp>` | Audit log entry |

GSIs: `email-index` (partition key: `email`), `user-passkeys` (partition key: `PK`, begins_with `PASSKEY#`)

> **Note:** DynamoDB items have a 400KB limit. Public keys are small (~100 bytes), so this is not a concern. Use a TTL attribute on the challenges table to auto-expire them.

## Testing

The server has a comprehensive test suite (50 tests) using Vitest + Supertest:

```bash
cd server
npm test              # Run all tests
npm run test:watch    # Watch mode
```

Tests mock `@simplewebauthn/server` and `./db` so they run without a database or real WebAuthn credentials. See `server/tests/helpers/setup.ts` for the test fixtures and mock setup.

### Testing WebAuthn Locally

- **Must use `localhost`** -- WebAuthn requires a secure context
- Use Touch ID, Face ID, Windows Hello, or a security key
- Chrome DevTools > Application > WebAuthn can simulate virtual authenticators

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18, Vite, TailwindCSS, TypeScript |
| **WebAuthn (browser)** | `@simplewebauthn/browser` |
| **Backend** | Express 4, TypeScript, `tsx` for dev |
| **WebAuthn (server)** | `@simplewebauthn/server` |
| **Database** | SQLite via `better-sqlite3` (swappable) |
| **Session** | `express-session` (in-memory store) |
| **CSRF** | `csrf-csrf` (double-submit cookie) |
| **Rate Limiting** | `express-rate-limit` |
| **Testing** | Vitest, Supertest |

## Common Issues

| Issue | Solution |
|-------|---------|
| "The operation is not supported" | Browser doesn't support WebAuthn, or you're not on localhost/HTTPS |
| Verification failures after DB changes | Ensure `public_key` round-trips as binary (Buffer/BLOB), not string |
| Challenge expired | Challenges expire after 5 minutes. Stale tabs will fail -- retry the flow |
| "Cannot delete last passkey" | By design. Register a second credential first, or use the recovery flow |
| CSRF 403 errors | Ensure your client sends the `X-CSRF-Token` header. Use the `apiFetch` wrapper from `client/src/lib/api.ts` |

## Production Checklist

- [ ] Replace all secrets in `server/src/config.ts`
- [ ] Set `rpID` to your domain and `origin` to your HTTPS URL
- [ ] Set `secure: true` on session and CSRF cookies (`app.ts` and `middleware.ts`)
- [ ] Replace the in-memory session store with a persistent store (e.g., `connect-redis`, `connect-pg-simple`)
- [ ] Replace SQLite with PostgreSQL or DynamoDB (see above)
- [ ] Add HTTPS (required for WebAuthn outside localhost)
- [ ] Set proper CORS headers if frontend and backend are on different origins

## License

MIT
