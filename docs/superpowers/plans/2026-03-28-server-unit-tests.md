# Server Unit Tests Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ~50 unit tests for the Express server covering all routes, middleware, and error paths.

**Architecture:** Mock `@simplewebauthn/server` and `./db` so tests exercise route logic in isolation. Split `app.ts` to separate the Express app from `listen()` for testability. Use Supertest agents with CSRF token helpers for HTTP-level assertions.

**Tech Stack:** Vitest, Supertest, vi.mock for module mocking.

**Spec:** `docs/superpowers/specs/2026-03-28-server-unit-tests-design.md`

---

## Chunk 1: Infrastructure Setup

### Task 1: Extract Express app from server entrypoint

**Files:**
- Modify: `server/src/app.ts:621-629` (remove listen block, add export)
- Create: `server/src/server.ts`
- Modify: `server/package.json:6-8` (update dev/start scripts)

- [ ] **Step 1: Remove listen block from app.ts and export the app**

Replace lines 621-629 of `server/src/app.ts`:

```typescript
// ============================================================
// START
// ============================================================

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`✦ Passkey Vault server on http://localhost:${PORT}`);
});
```

With:

```typescript
export default app;
```

- [ ] **Step 2: Create server.ts entrypoint**

Create `server/src/server.ts`:

```typescript
import app from "./app";

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`✦ Passkey Vault server on http://localhost:${PORT}`);
});
```

- [ ] **Step 3: Update package.json scripts**

Change the `dev` and `start` scripts in `server/package.json`:

```json
"dev": "tsx watch src/server.ts",
"start": "node dist/server.js"
```

- [ ] **Step 4: Verify the server still starts**

Run: `cd server && npm run dev`
Expected: `✦ Passkey Vault server on http://localhost:3001`
Kill the process after confirming.

- [ ] **Step 5: Commit**

```bash
git add server/src/app.ts server/src/server.ts server/package.json
git commit -m "refactor: extract Express app from listen() for testability"
```

---

### Task 2: Install test dependencies and configure Vitest

**Files:**
- Modify: `server/package.json` (add devDependencies and scripts)
- Create: `server/vitest.config.ts`

- [ ] **Step 1: Install dependencies**

```bash
cd server && npm install -D vitest supertest @types/supertest
```

- [ ] **Step 2: Add test scripts to package.json**

Add to the `"scripts"` section of `server/package.json`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create vitest.config.ts**

Create `server/vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    deps: { interopDefault: true },
  },
});
```

- [ ] **Step 4: Verify Vitest runs (no tests yet)**

Run: `cd server && npm test`
Expected: "No test files found" or similar — confirms Vitest is configured.

- [ ] **Step 5: Commit**

```bash
git add server/package.json server/package-lock.json server/vitest.config.ts
git commit -m "chore: add Vitest and Supertest for server tests"
```

---

### Task 3: Create test helpers and shared fixtures

**Files:**
- Create: `server/tests/helpers/setup.ts`

- [ ] **Step 1: Create the test helpers file**

Create `server/tests/helpers/setup.ts`:

```typescript
import { vi } from "vitest";
import supertest from "supertest";
import app from "../../src/app";
import * as db from "../../src/db";
import * as simplewebauthn from "@simplewebauthn/server";
import type { DbUser, DbPasskey } from "../../src/db";

// ── Shared Fixtures ──────────────────────────────────────────

export const TEST_USER: DbUser = {
  id: "user-1",
  email: "alice@example.com",
  webauthn_user_id: Buffer.from("fake-webauthn-user-id"),
  recovery_code_hash: null,
  created_at: "2024-01-01 00:00:00",
};

export const TEST_PASSKEY: DbPasskey = {
  id: "pk-1",
  user_id: "user-1",
  public_key: Buffer.from("fake-public-key"),
  counter: 5,
  device_type: "multiDevice",
  backed_up: 1,
  transports: JSON.stringify(["internal"]),
  label: "My Passkey",
  created_at: "2024-01-01 00:00:00",
  last_used_at: null,
};

// ── Body Builders ────────────────────────────────────────────

/** Encode a challenge into the base64url clientDataJSON format that verify routes parse. */
export const makeClientDataJSON = (challenge: string): string =>
  Buffer.from(
    JSON.stringify({ challenge, type: "webauthn.get", origin: "http://localhost:5173" }),
  ).toString("base64url");

/** Build a request body for login/verify or step-up/verify endpoints. */
export const makeAuthVerifyBody = (challenge: string, passkeyId = TEST_PASSKEY.id) => ({
  id: passkeyId,
  response: {
    clientDataJSON: makeClientDataJSON(challenge),
    authenticatorData: Buffer.from("fake").toString("base64url"),
    signature: Buffer.from("fake").toString("base64url"),
  },
  type: "public-key",
});

/** Build a request body for register/verify endpoint. */
export const makeRegisterVerifyBody = (challenge: string) => ({
  response: {
    clientDataJSON: makeClientDataJSON(challenge),
    attestationObject: Buffer.from("fake").toString("base64url"),
  },
  type: "public-key",
});

// ── Default Mock Setup ───────────────────────────────────────

/**
 * Set up sensible default return values for all mocked db and simplewebauthn functions.
 * Call this in `beforeEach` after `vi.restoreAllMocks()`.
 * Individual tests can override specific mocks as needed.
 */
export const setupDefaultMocks = () => {
  // DB mocks
  vi.mocked(db.findUserByEmail).mockReturnValue(TEST_USER);
  vi.mocked(db.findUserById).mockReturnValue(TEST_USER);
  vi.mocked(db.createUser).mockReturnValue(TEST_USER);
  vi.mocked(db.getPasskeysByUser).mockReturnValue([TEST_PASSKEY]);
  vi.mocked(db.getPasskeyById).mockReturnValue(TEST_PASSKEY);
  vi.mocked(db.consumeChallenge).mockReturnValue({ user_id: TEST_USER.id });
  vi.mocked(db.deletePasskey).mockReturnValue(true);
  vi.mocked(db.toUint8Array).mockImplementation(
    (buf: Buffer) => new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
  );

  // SimpleWebAuthn mocks
  vi.mocked(simplewebauthn.generateRegistrationOptions).mockResolvedValue({
    challenge: "test-challenge",
  } as any);
  vi.mocked(simplewebauthn.generateAuthenticationOptions).mockResolvedValue({
    challenge: "test-challenge",
  } as any);
  vi.mocked(simplewebauthn.verifyRegistrationResponse).mockResolvedValue({
    verified: true,
    registrationInfo: {
      credential: {
        id: "new-pk-id",
        publicKey: new Uint8Array([1, 2, 3]),
        counter: 0,
        transports: ["internal"],
      },
      credentialDeviceType: "multiDevice",
      credentialBackedUp: true,
    },
  } as any);
  vi.mocked(simplewebauthn.verifyAuthenticationResponse).mockResolvedValue({
    verified: true,
    authenticationInfo: {
      newCounter: 1,
      credentialID: TEST_PASSKEY.id,
      userVerified: true,
      credentialDeviceType: "multiDevice",
      credentialBackedUp: true,
    },
  } as any);
};

// ── Agent Factories ──────────────────────────────────────────

/**
 * Create a Supertest agent with a valid CSRF token.
 * The agent preserves cookies across requests.
 */
export const createCsrfAgent = async () => {
  const agent = supertest.agent(app);
  const res = await agent.get("/api/csrf-token");
  return { agent, csrfToken: res.body.token as string };
};

/**
 * Create a Supertest agent with a valid CSRF token AND an authenticated session.
 * Uses the login/verify flow with default mocks to establish the session.
 */
export const createAuthenticatedAgent = async () => {
  const { agent, csrfToken } = await createCsrfAgent();

  await agent
    .post("/api/auth/login/verify")
    .set("X-CSRF-Token", csrfToken)
    .send(makeAuthVerifyBody("test-challenge"));

  return { agent, csrfToken, userId: TEST_USER.id };
};
```

- [ ] **Step 2: Commit**

```bash
git add server/tests/helpers/setup.ts
git commit -m "test: add shared test helpers, fixtures, and agent factories"
```

---

## Chunk 2: Core Route Tests

### Task 4: Write middleware tests

**Files:**
- Create: `server/tests/middleware.test.ts`

- [ ] **Step 1: Write the middleware test file**

Create `server/tests/middleware.test.ts`:

```typescript
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../src/db");
vi.mock("@simplewebauthn/server");

import supertest from "supertest";
import app from "../src/app";
import {
  setupDefaultMocks,
  createCsrfAgent,
  createAuthenticatedAgent,
} from "./helpers/setup";

beforeEach(() => {
  vi.restoreAllMocks();
  setupDefaultMocks();
});

describe("CSRF protection", () => {
  it("rejects POST requests that do not include an X-CSRF-Token header", async () => {
    const res = await supertest(app)
      .post("/api/auth/register/options")
      .send({ email: "test@example.com" });

    expect(res.status).toBe(403);
  });

  it("allows POST requests that include a valid CSRF token", async () => {
    const { agent, csrfToken } = await createCsrfAgent();

    const res = await agent
      .post("/api/auth/register/options")
      .set("X-CSRF-Token", csrfToken)
      .send({ email: "test@example.com" });

    // Should reach the route handler (200), not be blocked by CSRF (403)
    expect(res.status).not.toBe(403);
  });
});

describe("requireSession middleware", () => {
  it("returns 401 Unauthorized when no session cookie is present", async () => {
    const { agent, csrfToken } = await createCsrfAgent();

    const res = await agent
      .post("/api/auth/logout")
      .set("X-CSRF-Token", csrfToken);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Unauthorized" });
  });
});

describe("requireRecentStepUp middleware", () => {
  it("returns 403 when the session has no active step-up elevation", async () => {
    const { agent, csrfToken } = await createAuthenticatedAgent();

    const res = await agent
      .post("/api/sensitive/action")
      .set("X-CSRF-Token", csrfToken)
      .send({ amount: 100 });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Fresh verification required" });
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `cd server && npm test -- tests/middleware.test.ts`
Expected: 4 tests pass.

- [ ] **Step 3: Commit**

```bash
git add server/tests/middleware.test.ts
git commit -m "test: add middleware tests (CSRF, requireSession, requireRecentStepUp)"
```

---

### Task 5: Write session tests

**Files:**
- Create: `server/tests/session.test.ts`

- [ ] **Step 1: Write the session test file**

Create `server/tests/session.test.ts`:

```typescript
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../src/db");
vi.mock("@simplewebauthn/server");

import * as db from "../src/db";
import {
  setupDefaultMocks,
  createCsrfAgent,
  createAuthenticatedAgent,
  TEST_USER,
  TEST_PASSKEY,
} from "./helpers/setup";

beforeEach(() => {
  vi.restoreAllMocks();
  setupDefaultMocks();
});

describe("GET /api/me", () => {
  it("returns the current user and their passkeys when authenticated", async () => {
    const { agent } = await createAuthenticatedAgent();

    const res = await agent.get("/api/me");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: TEST_USER.id,
      email: TEST_USER.email,
      passkeys: [
        {
          id: TEST_PASSKEY.id,
          label: TEST_PASSKEY.label,
          deviceType: TEST_PASSKEY.device_type,
          backedUp: true,
          createdAt: TEST_PASSKEY.created_at,
          lastUsedAt: TEST_PASSKEY.last_used_at,
        },
      ],
    });
  });

  it("returns 401 when there is no active session", async () => {
    const { agent } = await createCsrfAgent();

    const res = await agent.get("/api/me");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Unauthorized" });
  });

  it("returns 404 when the session user no longer exists in the database", async () => {
    const { agent } = await createAuthenticatedAgent();

    // After auth, override findUserById to simulate deleted user
    vi.mocked(db.findUserById).mockReturnValue(undefined);

    const res = await agent.get("/api/me");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "User not found" });
  });
});

describe("POST /api/auth/logout", () => {
  it("destroys the session, clears the cookie, and logs an audit event", async () => {
    const { agent, csrfToken } = await createAuthenticatedAgent();

    const res = await agent
      .post("/api/auth/logout")
      .set("X-CSRF-Token", csrfToken);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(db.logAuditEvent).toHaveBeenCalledWith(
      TEST_USER.id,
      "logout",
      "",
      expect.any(String),
    );

    // Verify session is actually destroyed — /me should now return 401
    const meRes = await agent.get("/api/me");
    expect(meRes.status).toBe(401);
  });

  it("returns 401 when there is no active session", async () => {
    const { agent, csrfToken } = await createCsrfAgent();

    const res = await agent
      .post("/api/auth/logout")
      .set("X-CSRF-Token", csrfToken);

    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `cd server && npm test -- tests/session.test.ts`
Expected: 5 tests pass.

- [ ] **Step 3: Commit**

```bash
git add server/tests/session.test.ts
git commit -m "test: add session tests (GET /me, POST /logout)"
```

---

### Task 6: Write registration tests

**Files:**
- Create: `server/tests/registration.test.ts`

- [ ] **Step 1: Write the registration test file**

Create `server/tests/registration.test.ts`:

```typescript
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../src/db");
vi.mock("@simplewebauthn/server");

import * as db from "../src/db";
import * as simplewebauthn from "@simplewebauthn/server";
import {
  setupDefaultMocks,
  createCsrfAgent,
  makeRegisterVerifyBody,
  TEST_USER,
  TEST_PASSKEY,
} from "./helpers/setup";

beforeEach(() => {
  vi.restoreAllMocks();
  setupDefaultMocks();
});

describe("POST /api/auth/register/options", () => {
  it("creates a new user and returns registration options when the email is unknown", async () => {
    vi.mocked(db.findUserByEmail).mockReturnValue(undefined);

    const { agent, csrfToken } = await createCsrfAgent();
    const res = await agent
      .post("/api/auth/register/options")
      .set("X-CSRF-Token", csrfToken)
      .send({ email: "new@example.com" });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("challenge", "test-challenge");
    expect(db.createUser).toHaveBeenCalledWith(
      expect.any(String),
      "new@example.com",
      expect.any(Uint8Array),
    );
    expect(db.storeChallenge).toHaveBeenCalledWith(
      "test-challenge",
      TEST_USER.id,
      "registration",
    );
    expect(db.logAuditEvent).toHaveBeenCalledWith(
      TEST_USER.id,
      "user.created",
      "new@example.com",
      expect.any(String),
    );
  });

  it("reuses the existing user and passes excludeCredentials when the email is known", async () => {
    const { agent, csrfToken } = await createCsrfAgent();
    const res = await agent
      .post("/api/auth/register/options")
      .set("X-CSRF-Token", csrfToken)
      .send({ email: TEST_USER.email });

    expect(res.status).toBe(200);
    expect(db.createUser).not.toHaveBeenCalled();
    expect(simplewebauthn.generateRegistrationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        excludeCredentials: [{ id: TEST_PASSKEY.id, transports: ["internal"] }],
      }),
    );
  });

  it("returns 400 when the email is missing or not a string", async () => {
    const { agent, csrfToken } = await createCsrfAgent();

    const res = await agent
      .post("/api/auth/register/options")
      .set("X-CSRF-Token", csrfToken)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "A valid email is required" });
  });
});

describe("POST /api/auth/register/verify", () => {
  it("verifies registration, saves the passkey, issues a recovery code on first passkey, and auto-logs in", async () => {
    // First passkey: getPasskeysByUser returns array of length 1 after save
    vi.mocked(db.getPasskeysByUser).mockReturnValue([TEST_PASSKEY]);

    const { agent, csrfToken } = await createCsrfAgent();
    const res = await agent
      .post("/api/auth/register/verify")
      .set("X-CSRF-Token", csrfToken)
      .send(makeRegisterVerifyBody("test-challenge"));

    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(res.body.passkeyCount).toBe(1);
    // Recovery code is a 32-char hex string (16 random bytes)
    expect(res.body.recoveryCode).toMatch(/^[a-f0-9]{32}$/);
    expect(db.savePasskey).toHaveBeenCalledWith(
      "new-pk-id",
      TEST_USER.id,
      new Uint8Array([1, 2, 3]),
      0,
      "multiDevice",
      true,
      ["internal"],
    );
    expect(db.setRecoveryCodeHash).toHaveBeenCalledWith(
      TEST_USER.id,
      expect.any(String),
    );
    expect(db.logAuditEvent).toHaveBeenCalledWith(
      TEST_USER.id,
      "registration.success",
      expect.stringContaining("new-pk-id"),
      expect.any(String),
    );

    // Verify auto-login: /me should now return the user
    const meRes = await agent.get("/api/me");
    expect(meRes.status).toBe(200);
  });

  it("does not issue a recovery code when the user already has multiple passkeys", async () => {
    const secondPasskey = { ...TEST_PASSKEY, id: "pk-2" };
    vi.mocked(db.getPasskeysByUser).mockReturnValue([TEST_PASSKEY, secondPasskey]);

    const { agent, csrfToken } = await createCsrfAgent();
    const res = await agent
      .post("/api/auth/register/verify")
      .set("X-CSRF-Token", csrfToken)
      .send(makeRegisterVerifyBody("test-challenge"));

    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(res.body.recoveryCode).toBeUndefined();
    expect(res.body.passkeyCount).toBe(2);
    expect(db.setRecoveryCodeHash).not.toHaveBeenCalled();
  });

  it("returns 400 and logs registration.failed when verification is rejected", async () => {
    vi.mocked(simplewebauthn.verifyRegistrationResponse).mockResolvedValue({
      verified: false,
      registrationInfo: undefined,
    } as any);

    const { agent, csrfToken } = await createCsrfAgent();
    const res = await agent
      .post("/api/auth/register/verify")
      .set("X-CSRF-Token", csrfToken)
      .send(makeRegisterVerifyBody("test-challenge"));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ verified: false });
    expect(db.logAuditEvent).toHaveBeenCalledWith(
      TEST_USER.id,
      "registration.failed",
      "Verification rejected",
      expect.any(String),
    );
  });

  it("returns 400 when the user was deleted between options and verify", async () => {
    vi.mocked(db.findUserById).mockReturnValue(undefined);

    const { agent, csrfToken } = await createCsrfAgent();
    const res = await agent
      .post("/api/auth/register/verify")
      .set("X-CSRF-Token", csrfToken)
      .send(makeRegisterVerifyBody("test-challenge"));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ verified: false });
  });

  it("returns 400 when the challenge is invalid or expired", async () => {
    vi.mocked(db.consumeChallenge).mockReturnValue(undefined);

    const { agent, csrfToken } = await createCsrfAgent();
    const res = await agent
      .post("/api/auth/register/verify")
      .set("X-CSRF-Token", csrfToken)
      .send(makeRegisterVerifyBody("expired-challenge"));

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      verified: false,
      error: "Invalid or expired challenge",
    });
  });

  it("returns 400 and logs registration.error when simplewebauthn throws an exception", async () => {
    vi.mocked(simplewebauthn.verifyRegistrationResponse).mockRejectedValue(
      new Error("Unexpected attestation format"),
    );

    const { agent, csrfToken } = await createCsrfAgent();
    const res = await agent
      .post("/api/auth/register/verify")
      .set("X-CSRF-Token", csrfToken)
      .send(makeRegisterVerifyBody("test-challenge"));

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      verified: false,
      error: "Unexpected attestation format",
    });
    expect(db.logAuditEvent).toHaveBeenCalledWith(
      null,
      "registration.error",
      expect.stringContaining("Unexpected attestation format"),
      expect.any(String),
    );
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `cd server && npm test -- tests/registration.test.ts`
Expected: 9 tests pass.

- [ ] **Step 3: Commit**

```bash
git add server/tests/registration.test.ts
git commit -m "test: add registration route tests (options + verify, 9 cases)"
```

---

### Task 7: Write authentication tests

**Files:**
- Create: `server/tests/authentication.test.ts`

- [ ] **Step 1: Write the authentication test file**

Create `server/tests/authentication.test.ts`:

```typescript
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../src/db");
vi.mock("@simplewebauthn/server");

import * as db from "../src/db";
import * as simplewebauthn from "@simplewebauthn/server";
import {
  setupDefaultMocks,
  createCsrfAgent,
  makeAuthVerifyBody,
  TEST_USER,
  TEST_PASSKEY,
} from "./helpers/setup";

beforeEach(() => {
  vi.restoreAllMocks();
  setupDefaultMocks();
});

describe("POST /api/auth/login/options", () => {
  it("returns authentication options with the user's credential IDs for a known email", async () => {
    const { agent, csrfToken } = await createCsrfAgent();
    const res = await agent
      .post("/api/auth/login/options")
      .set("X-CSRF-Token", csrfToken)
      .send({ email: TEST_USER.email });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("challenge", "test-challenge");
    expect(simplewebauthn.generateAuthenticationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        allowCredentials: [{ id: TEST_PASSKEY.id, transports: ["internal"] }],
        userVerification: "required",
      }),
    );
    expect(db.storeChallenge).toHaveBeenCalledWith(
      "test-challenge",
      TEST_USER.id,
      "authentication",
    );
  });

  it("returns valid-looking empty options for an unknown email to prevent user enumeration", async () => {
    vi.mocked(db.findUserByEmail).mockReturnValue(undefined);

    const { agent, csrfToken } = await createCsrfAgent();
    const res = await agent
      .post("/api/auth/login/options")
      .set("X-CSRF-Token", csrfToken)
      .send({ email: "unknown@example.com" });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("challenge");
    expect(simplewebauthn.generateAuthenticationOptions).toHaveBeenCalledWith(
      expect.objectContaining({ allowCredentials: [] }),
    );
    expect(db.storeChallenge).toHaveBeenCalledWith(
      "test-challenge",
      "nonexistent",
      "authentication",
    );
  });

  it("returns 400 when the email is missing or not a string", async () => {
    const { agent, csrfToken } = await createCsrfAgent();
    const res = await agent
      .post("/api/auth/login/options")
      .set("X-CSRF-Token", csrfToken)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "A valid email is required" });
  });
});

describe("POST /api/auth/login/verify", () => {
  it("authenticates the user, updates the counter, and sets the session", async () => {
    const { agent, csrfToken } = await createCsrfAgent();
    const res = await agent
      .post("/api/auth/login/verify")
      .set("X-CSRF-Token", csrfToken)
      .send(makeAuthVerifyBody("test-challenge"));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ verified: true });
    expect(db.updateCounter).toHaveBeenCalledWith(TEST_PASSKEY.id, 1);
    expect(db.logAuditEvent).toHaveBeenCalledWith(
      TEST_USER.id,
      "login.success",
      expect.stringContaining(TEST_PASSKEY.id.substring(0, 16)),
      expect.any(String),
    );

    // Verify session was established
    const meRes = await agent.get("/api/me");
    expect(meRes.status).toBe(200);
  });

  it("logs a security.counter_mismatch audit event when the counter goes backward but still succeeds", async () => {
    vi.mocked(simplewebauthn.verifyAuthenticationResponse).mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 3 },
    } as any);

    const { agent, csrfToken } = await createCsrfAgent();
    const res = await agent
      .post("/api/auth/login/verify")
      .set("X-CSRF-Token", csrfToken)
      .send(makeAuthVerifyBody("test-challenge"));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ verified: true });
    expect(db.logAuditEvent).toHaveBeenCalledWith(
      TEST_USER.id,
      "security.counter_mismatch",
      expect.stringContaining("stored=5"),
      expect.any(String),
    );
  });

  it("returns 400 when the authentication assertion is rejected", async () => {
    vi.mocked(simplewebauthn.verifyAuthenticationResponse).mockResolvedValue({
      verified: false,
      authenticationInfo: { newCounter: 0 },
    } as any);

    const { agent, csrfToken } = await createCsrfAgent();
    const res = await agent
      .post("/api/auth/login/verify")
      .set("X-CSRF-Token", csrfToken)
      .send(makeAuthVerifyBody("test-challenge"));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ verified: false });
    expect(db.logAuditEvent).toHaveBeenCalledWith(
      TEST_USER.id,
      "login.failed",
      "Assertion rejected",
      expect.any(String),
    );
  });

  it("returns 400 when the passkey is not found or belongs to a different user", async () => {
    vi.mocked(db.getPasskeyById).mockReturnValue(undefined);

    const { agent, csrfToken } = await createCsrfAgent();
    const res = await agent
      .post("/api/auth/login/verify")
      .set("X-CSRF-Token", csrfToken)
      .send(makeAuthVerifyBody("test-challenge"));

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "Authentication failed" });
    expect(db.logAuditEvent).toHaveBeenCalledWith(
      TEST_USER.id,
      "login.failed",
      "Passkey mismatch",
      expect.any(String),
    );
  });

  it("returns 400 when the user no longer exists after consuming the challenge", async () => {
    vi.mocked(db.findUserById).mockReturnValue(undefined);

    const { agent, csrfToken } = await createCsrfAgent();
    const res = await agent
      .post("/api/auth/login/verify")
      .set("X-CSRF-Token", csrfToken)
      .send(makeAuthVerifyBody("test-challenge"));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ verified: false });
  });

  it("returns 400 when the challenge is invalid or expired", async () => {
    vi.mocked(db.consumeChallenge).mockReturnValue(undefined);

    const { agent, csrfToken } = await createCsrfAgent();
    const res = await agent
      .post("/api/auth/login/verify")
      .set("X-CSRF-Token", csrfToken)
      .send(makeAuthVerifyBody("expired-challenge"));

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "Invalid or expired challenge" });
    expect(db.logAuditEvent).toHaveBeenCalledWith(
      null,
      "login.failed",
      "Invalid or expired challenge",
      expect.any(String),
    );
  });

  it("returns 400 and logs login.error when simplewebauthn throws an exception", async () => {
    vi.mocked(simplewebauthn.verifyAuthenticationResponse).mockRejectedValue(
      new Error("Malformed authenticator data"),
    );

    const { agent, csrfToken } = await createCsrfAgent();
    const res = await agent
      .post("/api/auth/login/verify")
      .set("X-CSRF-Token", csrfToken)
      .send(makeAuthVerifyBody("test-challenge"));

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      verified: false,
      error: "Malformed authenticator data",
    });
    expect(db.logAuditEvent).toHaveBeenCalledWith(
      null,
      "login.error",
      expect.stringContaining("Malformed authenticator data"),
      expect.any(String),
    );
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `cd server && npm test -- tests/authentication.test.ts`
Expected: 10 tests pass.

- [ ] **Step 3: Commit**

```bash
git add server/tests/authentication.test.ts
git commit -m "test: add authentication route tests (options + verify, 10 cases)"
```

---

## Chunk 3: Remaining Route Tests

### Task 8: Write credentials tests

**Files:**
- Create: `server/tests/credentials.test.ts`

- [ ] **Step 1: Write the credentials test file**

Create `server/tests/credentials.test.ts`:

```typescript
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../src/db");
vi.mock("@simplewebauthn/server");

import * as db from "../src/db";
import {
  setupDefaultMocks,
  createCsrfAgent,
  createAuthenticatedAgent,
  TEST_USER,
  TEST_PASSKEY,
} from "./helpers/setup";

beforeEach(() => {
  vi.restoreAllMocks();
  setupDefaultMocks();
});

describe("PATCH /api/passkeys/:id", () => {
  it("renames a passkey and logs an audit event", async () => {
    const { agent, csrfToken } = await createAuthenticatedAgent();

    const res = await agent
      .patch(`/api/passkeys/${TEST_PASSKEY.id}`)
      .set("X-CSRF-Token", csrfToken)
      .send({ label: "Work Laptop" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(db.renamePasskey).toHaveBeenCalledWith(
      TEST_PASSKEY.id,
      TEST_USER.id,
      "Work Laptop",
    );
    expect(db.logAuditEvent).toHaveBeenCalledWith(
      TEST_USER.id,
      "passkey.renamed",
      expect.stringContaining("Work Laptop"),
      expect.any(String),
    );
  });

  it("returns 400 when the label is missing, empty, or exceeds 64 characters", async () => {
    const { agent, csrfToken } = await createAuthenticatedAgent();

    // Missing label
    const res1 = await agent
      .patch(`/api/passkeys/${TEST_PASSKEY.id}`)
      .set("X-CSRF-Token", csrfToken)
      .send({});
    expect(res1.status).toBe(400);
    expect(res1.body).toEqual({ error: "Label is required (max 64 characters)" });

    // Label too long
    const res2 = await agent
      .patch(`/api/passkeys/${TEST_PASSKEY.id}`)
      .set("X-CSRF-Token", csrfToken)
      .send({ label: "x".repeat(65) });
    expect(res2.status).toBe(400);
  });

  it("returns 401 when there is no active session", async () => {
    const { agent, csrfToken } = await createCsrfAgent();

    const res = await agent
      .patch(`/api/passkeys/${TEST_PASSKEY.id}`)
      .set("X-CSRF-Token", csrfToken)
      .send({ label: "New Label" });

    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/passkeys/:id", () => {
  it("deletes a passkey and logs an audit event", async () => {
    const { agent, csrfToken } = await createAuthenticatedAgent();

    const res = await agent
      .delete(`/api/passkeys/${TEST_PASSKEY.id}`)
      .set("X-CSRF-Token", csrfToken);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(db.deletePasskey).toHaveBeenCalledWith(TEST_PASSKEY.id, TEST_USER.id);
    expect(db.logAuditEvent).toHaveBeenCalledWith(
      TEST_USER.id,
      "passkey.revoked",
      expect.stringContaining(TEST_PASSKEY.id.substring(0, 16)),
      expect.any(String),
    );
  });

  it("returns 400 when the passkey is the user's only remaining credential", async () => {
    vi.mocked(db.deletePasskey).mockReturnValue(false);

    const { agent, csrfToken } = await createAuthenticatedAgent();

    const res = await agent
      .delete(`/api/passkeys/${TEST_PASSKEY.id}`)
      .set("X-CSRF-Token", csrfToken);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Cannot delete");
  });

  it("returns 400 when the passkey is not found or not owned by the user", async () => {
    vi.mocked(db.deletePasskey).mockReturnValue(false);

    const { agent, csrfToken } = await createAuthenticatedAgent();

    const res = await agent
      .delete("/api/passkeys/nonexistent-pk-id")
      .set("X-CSRF-Token", csrfToken);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Cannot delete");
  });

  it("returns 401 when there is no active session", async () => {
    const { agent, csrfToken } = await createCsrfAgent();

    const res = await agent
      .delete(`/api/passkeys/${TEST_PASSKEY.id}`)
      .set("X-CSRF-Token", csrfToken);

    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `cd server && npm test -- tests/credentials.test.ts`
Expected: 7 tests pass.

- [ ] **Step 3: Commit**

```bash
git add server/tests/credentials.test.ts
git commit -m "test: add credential management tests (rename + delete, 7 cases)"
```

---

### Task 9: Write recovery tests

**Files:**
- Create: `server/tests/recovery.test.ts`

- [ ] **Step 1: Write the recovery test file**

Create `server/tests/recovery.test.ts`:

```typescript
import { vi, describe, it, expect, beforeEach } from "vitest";
import { createHash } from "node:crypto";

vi.mock("../src/db");
vi.mock("@simplewebauthn/server");

import * as db from "../src/db";
import {
  setupDefaultMocks,
  createCsrfAgent,
  TEST_USER,
} from "./helpers/setup";

// Pre-compute a known recovery code and its SHA-256 hash
const RECOVERY_CODE = "abcdef1234567890abcdef1234567890";
const RECOVERY_CODE_HASH = createHash("sha256").update(RECOVERY_CODE).digest("hex");

beforeEach(() => {
  vi.restoreAllMocks();
  setupDefaultMocks();
  // Default: user has a recovery code hash
  vi.mocked(db.findUserByEmail).mockReturnValue({
    ...TEST_USER,
    recovery_code_hash: RECOVERY_CODE_HASH,
  });
});

describe("POST /api/auth/recover", () => {
  it("validates the recovery code, consumes it, issues a new one, and establishes a session", async () => {
    const { agent, csrfToken } = await createCsrfAgent();
    const res = await agent
      .post("/api/auth/recover")
      .set("X-CSRF-Token", csrfToken)
      .send({ email: TEST_USER.email, recoveryCode: RECOVERY_CODE });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.message).toContain("Recovery successful");
    // New recovery code is a 32-char hex string
    expect(res.body.newRecoveryCode).toMatch(/^[a-f0-9]{32}$/);

    // Old code was consumed (hash cleared then new hash set)
    expect(db.setRecoveryCodeHash).toHaveBeenCalledWith(TEST_USER.id, "");
    expect(db.setRecoveryCodeHash).toHaveBeenCalledWith(
      TEST_USER.id,
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );
    expect(db.logAuditEvent).toHaveBeenCalledWith(
      TEST_USER.id,
      "recovery.success",
      "Code consumed",
      expect.any(String),
    );

    // Session was established
    const meRes = await agent.get("/api/me");
    expect(meRes.status).toBe(200);
  });

  it("returns 400 and logs recovery.failed when the recovery code is wrong", async () => {
    const { agent, csrfToken } = await createCsrfAgent();
    const res = await agent
      .post("/api/auth/recover")
      .set("X-CSRF-Token", csrfToken)
      .send({ email: TEST_USER.email, recoveryCode: "wrong-code-value" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Recovery failed");
    expect(db.logAuditEvent).toHaveBeenCalledWith(
      TEST_USER.id,
      "recovery.failed",
      "Invalid code",
      expect.any(String),
    );
  });

  it("returns 400 with the same error message when the email is unknown (no user enumeration)", async () => {
    vi.mocked(db.findUserByEmail).mockReturnValue(undefined);

    const { agent, csrfToken } = await createCsrfAgent();
    const res = await agent
      .post("/api/auth/recover")
      .set("X-CSRF-Token", csrfToken)
      .send({ email: "unknown@example.com", recoveryCode: RECOVERY_CODE });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Recovery failed");
    expect(db.logAuditEvent).toHaveBeenCalledWith(
      null,
      "recovery.failed",
      "unknown@example.com",
      expect.any(String),
    );
  });

  it("returns 400 when required fields are missing", async () => {
    const { agent, csrfToken } = await createCsrfAgent();

    const res = await agent
      .post("/api/auth/recover")
      .set("X-CSRF-Token", csrfToken)
      .send({ email: TEST_USER.email });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Email and recovery code are required" });
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `cd server && npm test -- tests/recovery.test.ts`
Expected: 4 tests pass.

- [ ] **Step 3: Commit**

```bash
git add server/tests/recovery.test.ts
git commit -m "test: add recovery route tests (4 cases)"
```

---

### Task 10: Write step-up and sensitive action tests

**Files:**
- Create: `server/tests/step-up.test.ts`

- [ ] **Step 1: Write the step-up test file**

Create `server/tests/step-up.test.ts`:

```typescript
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../src/db");
vi.mock("@simplewebauthn/server");

import * as db from "../src/db";
import * as simplewebauthn from "@simplewebauthn/server";
import {
  setupDefaultMocks,
  createCsrfAgent,
  createAuthenticatedAgent,
  makeAuthVerifyBody,
  TEST_USER,
  TEST_PASSKEY,
} from "./helpers/setup";

beforeEach(() => {
  vi.restoreAllMocks();
  setupDefaultMocks();
});

describe("POST /api/auth/step-up/options", () => {
  it("returns authentication options for the authenticated user's passkeys", async () => {
    const { agent, csrfToken } = await createAuthenticatedAgent();

    const res = await agent
      .post("/api/auth/step-up/options")
      .set("X-CSRF-Token", csrfToken);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("challenge", "test-challenge");
    expect(simplewebauthn.generateAuthenticationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        allowCredentials: [{ id: TEST_PASSKEY.id, transports: ["internal"] }],
        userVerification: "required",
      }),
    );
    expect(db.storeChallenge).toHaveBeenCalledWith(
      "test-challenge",
      TEST_USER.id,
      "step-up",
    );
  });

  it("returns 404 when the session user no longer exists in the database", async () => {
    const { agent, csrfToken } = await createAuthenticatedAgent();

    vi.mocked(db.findUserById).mockReturnValue(undefined);

    const res = await agent
      .post("/api/auth/step-up/options")
      .set("X-CSRF-Token", csrfToken);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "User not found" });
  });

  it("returns 401 when there is no active session", async () => {
    const { agent, csrfToken } = await createCsrfAgent();

    const res = await agent
      .post("/api/auth/step-up/options")
      .set("X-CSRF-Token", csrfToken);

    expect(res.status).toBe(401);
  });
});

describe("POST /api/auth/step-up/verify", () => {
  it("verifies step-up, sets stepUpUntil in the session, and logs an audit event", async () => {
    const { agent, csrfToken } = await createAuthenticatedAgent();

    const res = await agent
      .post("/api/auth/step-up/verify")
      .set("X-CSRF-Token", csrfToken)
      .send(makeAuthVerifyBody("test-challenge"));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ verified: true });
    expect(db.updateCounter).toHaveBeenCalled();
    expect(db.logAuditEvent).toHaveBeenCalledWith(
      TEST_USER.id,
      "stepup.success",
      expect.stringContaining(TEST_PASSKEY.id.substring(0, 16)),
      expect.any(String),
    );
  });

  it("returns 400 and logs stepup.failed when the assertion is rejected", async () => {
    const { agent, csrfToken } = await createAuthenticatedAgent();

    // Override AFTER login so the step-up verify gets the rejected response
    vi.mocked(simplewebauthn.verifyAuthenticationResponse).mockResolvedValue({
      verified: false,
      authenticationInfo: { newCounter: 0 },
    } as any);

    const res = await agent
      .post("/api/auth/step-up/verify")
      .set("X-CSRF-Token", csrfToken)
      .send(makeAuthVerifyBody("test-challenge"));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ verified: false });
    expect(db.logAuditEvent).toHaveBeenCalledWith(
      TEST_USER.id,
      "stepup.failed",
      "Rejected",
      expect.any(String),
    );
  });

  it("returns 400 when the passkey is not found or not owned by the session user", async () => {
    const { agent, csrfToken } = await createAuthenticatedAgent();

    vi.mocked(db.getPasskeyById).mockReturnValue(undefined);

    const res = await agent
      .post("/api/auth/step-up/verify")
      .set("X-CSRF-Token", csrfToken)
      .send(makeAuthVerifyBody("test-challenge"));

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "Passkey not found" });
  });

  it("returns 400 when the challenge was issued for a different user", async () => {
    const { agent, csrfToken } = await createAuthenticatedAgent();

    vi.mocked(db.consumeChallenge).mockReturnValue({ user_id: "different-user-id" });

    const res = await agent
      .post("/api/auth/step-up/verify")
      .set("X-CSRF-Token", csrfToken)
      .send(makeAuthVerifyBody("test-challenge"));

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "Invalid or expired challenge" });
  });

  it("returns 400 and logs stepup.error when simplewebauthn throws an exception", async () => {
    const { agent, csrfToken } = await createAuthenticatedAgent();

    vi.mocked(simplewebauthn.verifyAuthenticationResponse).mockRejectedValue(
      new Error("Corrupted signature"),
    );

    const res = await agent
      .post("/api/auth/step-up/verify")
      .set("X-CSRF-Token", csrfToken)
      .send(makeAuthVerifyBody("test-challenge"));

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      verified: false,
      error: "Corrupted signature",
    });
    expect(db.logAuditEvent).toHaveBeenCalledWith(
      TEST_USER.id,
      "stepup.error",
      expect.stringContaining("Corrupted signature"),
      expect.any(String),
    );
  });
});

describe("POST /api/sensitive/action", () => {
  /**
   * Helper: create an authenticated agent with an active step-up window.
   * Performs login, then step-up verify, leaving the session with stepUpUntil set.
   */
  async function createStepUpAgent() {
    const { agent, csrfToken } = await createAuthenticatedAgent();

    await agent
      .post("/api/auth/step-up/verify")
      .set("X-CSRF-Token", csrfToken)
      .send(makeAuthVerifyBody("test-challenge"));

    return { agent, csrfToken };
  }

  it("processes the sensitive action when the user has an active step-up window", async () => {
    const { agent, csrfToken } = await createStepUpAgent();

    const res = await agent
      .post("/api/sensitive/action")
      .set("X-CSRF-Token", csrfToken)
      .send({ amount: 100, currency: "USD" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, message: "Sensitive Action processed" });
    expect(db.logAuditEvent).toHaveBeenCalledWith(
      TEST_USER.id,
      "sensitive.action",
      expect.any(String),
      expect.any(String),
    );
  });

  it("returns 403 when the step-up window has expired", async () => {
    const { agent, csrfToken } = await createAuthenticatedAgent();
    // No step-up performed — stepUpUntil is not set

    const res = await agent
      .post("/api/sensitive/action")
      .set("X-CSRF-Token", csrfToken)
      .send({ amount: 100 });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Fresh verification required" });
  });

  it("returns 401 when there is no active session", async () => {
    const { agent, csrfToken } = await createCsrfAgent();

    const res = await agent
      .post("/api/sensitive/action")
      .set("X-CSRF-Token", csrfToken)
      .send({ amount: 100 });

    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `cd server && npm test -- tests/step-up.test.ts`
Expected: 11 tests pass.

- [ ] **Step 3: Commit**

```bash
git add server/tests/step-up.test.ts
git commit -m "test: add step-up and sensitive action tests (11 cases)"
```

---

### Task 11: Run the full test suite and verify

- [ ] **Step 1: Run all tests**

Run: `cd server && npm test`
Expected: All ~50 tests pass across 7 files.

- [ ] **Step 2: Final commit (if any adjustments were needed)**

```bash
git add -A server/tests/
git commit -m "test: finalize server unit test suite (50 cases across 7 files)"
```
