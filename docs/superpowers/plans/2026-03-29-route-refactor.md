# Server Route Refactor Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose the monolithic `app.ts` into focused modules (config, middleware, route files) with a thin composition root.

**Architecture:** Extract config constants, middleware, and route handlers into separate files. Each route file exports an `express.Router`. `app.ts` becomes a ~45-line composition root that wires everything together. Handler logic moves verbatim — no behavior changes.

**Tech Stack:** Express Router, existing dependencies (no new packages).

**Spec:** `docs/superpowers/specs/2026-03-29-route-refactor-design.md`

---

## Chunk 1: Foundation + Small Route Files

### Task 1: Create config.ts

**Files:**
- Create: `server/src/config.ts`

- [ ] **Step 1: Create config.ts with all shared constants and session type augmentation**

Create `server/src/config.ts`:

```typescript
// --- Relying Party config ---
export const rpName = "Passkey Vault";
export const rpID = "localhost";
export const origin = "http://localhost:5173";

// --- Secrets (replace all of these in production) ---
export const sessionSecret = "replace-this-in-production";
export const cookieSecret = "replace-this-in-production";
export const csrfSecret = "replace-this-csrf-secret-in-production";

// --- Session type augmentation ---
declare module "express-session" {
  interface SessionData {
    userId?: string;
    stepUpUntil?: number;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/config.ts
git commit -m "refactor: extract config constants and session types to config.ts"
```

---

### Task 2: Create middleware.ts

**Files:**
- Create: `server/src/middleware.ts`

- [ ] **Step 1: Create middleware.ts with all middleware, helpers, and rate limiters**

Create `server/src/middleware.ts`:

```typescript
import { doubleCsrf } from "csrf-csrf";
import express from "express";
import rateLimit from "express-rate-limit";

export const getClientIp = (req: express.Request): string =>
  (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
  req.ip ||
  "unknown";

export const requireSession = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
};

export const requireRecentStepUp = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  if (!req.session.stepUpUntil || req.session.stepUpUntil < Date.now()) {
    return res.status(403).json({ error: "Fresh verification required" });
  }
  next();
};

export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

export const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts, please slow down" },
});

export const createCsrfProtection = (secret: string) =>
  doubleCsrf({
    getSecret: () => secret,
    cookieName: "__csrf",
    cookieOptions: { httpOnly: true, sameSite: "lax" as const, secure: false },
    getTokenFromRequest: (req) => req.headers["x-csrf-token"] as string,
  });
```

- [ ] **Step 2: Commit**

```bash
git add server/src/middleware.ts
git commit -m "refactor: extract middleware, helpers, and rate limiters to middleware.ts"
```

---

### Task 3: Create routes/user.ts

**Files:**
- Create: `server/src/routes/user.ts`

- [ ] **Step 1: Create the user router**

Create `server/src/routes/user.ts`:

```typescript
import express from "express";
import { findUserById, getPasskeysByUser } from "../db";
import { requireSession } from "../middleware";

export const userRouter = express.Router();

userRouter.get("/me", requireSession, (req, res) => {
  const user = findUserById(req.session.userId!);
  if (!user) return res.status(404).json({ error: "User not found" });

  const passkeys = getPasskeysByUser(user.id);
  res.json({
    id: user.id,
    email: user.email,
    passkeys: passkeys.map((pk) => ({
      id: pk.id,
      label: pk.label,
      deviceType: pk.device_type,
      backedUp: pk.backed_up === 1,
      createdAt: pk.created_at,
      lastUsedAt: pk.last_used_at,
    })),
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add server/src/routes/user.ts
git commit -m "refactor: extract GET /me to routes/user.ts"
```

---

### Task 4: Create routes/passkeys.ts

**Files:**
- Create: `server/src/routes/passkeys.ts`

- [ ] **Step 1: Create the passkeys router**

Create `server/src/routes/passkeys.ts`:

```typescript
import express from "express";
import { deletePasskey, logAuditEvent, renamePasskey } from "../db";
import { getClientIp, requireSession } from "../middleware";

export const passkeysRouter = express.Router();

passkeysRouter.patch("/:id", requireSession, (req: express.Request<{ id: string }>, res) => {
  const { label } = req.body;
  if (!label || typeof label !== "string" || label.length > 64) {
    return res
      .status(400)
      .json({ error: "Label is required (max 64 characters)" });
  }

  renamePasskey(req.params.id, req.session.userId!, label.trim());
  logAuditEvent(
    req.session.userId!,
    "passkey.renamed",
    `${req.params.id.substring(0, 16)}… → ${label}`,
    getClientIp(req),
  );
  res.json({ ok: true });
});

passkeysRouter.delete("/:id", requireSession, (req: express.Request<{ id: string }>, res) => {
  const deleted = deletePasskey(req.params.id, req.session.userId!);
  if (!deleted) {
    return res.status(400).json({
      error:
        "Cannot delete. Either not found or it is your only remaining credential.",
    });
  }

  logAuditEvent(
    req.session.userId!,
    "passkey.revoked",
    `${req.params.id.substring(0, 16)}…`,
    getClientIp(req),
  );
  res.json({ ok: true });
});
```

- [ ] **Step 2: Commit**

```bash
git add server/src/routes/passkeys.ts
git commit -m "refactor: extract PATCH/DELETE passkeys to routes/passkeys.ts"
```

---

### Task 5: Create routes/sensitive.ts

**Files:**
- Create: `server/src/routes/sensitive.ts`

- [ ] **Step 1: Create the sensitive action router**

Create `server/src/routes/sensitive.ts`:

```typescript
import express from "express";
import { logAuditEvent } from "../db";
import { getClientIp, requireRecentStepUp, requireSession } from "../middleware";

export const sensitiveRouter = express.Router();

// Example protected route — replace or extend for your use case
sensitiveRouter.post(
  "/action",
  requireSession,
  requireRecentStepUp,
  (req, res) => {
    logAuditEvent(
      req.session.userId!,
      "sensitive.action",
      JSON.stringify(req.body),
      getClientIp(req),
    );
    res.json({ ok: true, message: "Sensitive Action processed" });
  },
);
```

- [ ] **Step 2: Commit**

```bash
git add server/src/routes/sensitive.ts
git commit -m "refactor: extract sensitive action to routes/sensitive.ts"
```

---

## Chunk 2: Auth Router + Composition Root + Verification

### Task 6: Create routes/auth.ts

**Files:**
- Create: `server/src/routes/auth.ts`

- [ ] **Step 1: Create the auth router with all 8 auth routes**

Create `server/src/routes/auth.ts`:

```typescript
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type { WebAuthnCredential } from "@simplewebauthn/types";
import express from "express";
import { createHash, randomBytes, randomUUID } from "node:crypto";

import { origin, rpID, rpName } from "../config";
import {
  consumeChallenge,
  createUser,
  findUserByEmail,
  findUserById,
  getPasskeyById,
  getPasskeysByUser,
  logAuditEvent,
  savePasskey,
  setRecoveryCodeHash,
  storeChallenge,
  toUint8Array,
  updateCounter,
} from "../db";
import { authLimiter, getClientIp, requireSession } from "../middleware";

export const authRouter = express.Router();

// ============================================================
// REGISTRATION
// ============================================================

authRouter.post("/register/options", authLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "A valid email is required" });
  }

  const normalizedEmail = email.toLowerCase().trim();
  let user = findUserByEmail(normalizedEmail);

  if (!user) {
    user = createUser(randomUUID(), normalizedEmail, randomBytes(32));
    logAuditEvent(user.id, "user.created", normalizedEmail, getClientIp(req));
  }

  const existingPasskeys = getPasskeysByUser(user.id);

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: user.email,
    userDisplayName: user.email,
    userID: toUint8Array(user.webauthn_user_id),
    attestationType: "none",
    excludeCredentials: existingPasskeys.map((pk) => ({
      id: pk.id,
      transports: pk.transports ? JSON.parse(pk.transports) : undefined,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "required",
    },
  });

  storeChallenge(options.challenge, user.id, "registration");
  res.json(options);
});

authRouter.post("/register/verify", authLimiter, async (req, res) => {
  try {
    const clientDataJSON = JSON.parse(
      Buffer.from(req.body.response.clientDataJSON, "base64url").toString(),
    );
    const challengeFromClient = clientDataJSON.challenge;

    const challengeRecord = consumeChallenge(
      challengeFromClient,
      "registration",
    );
    if (!challengeRecord) {
      return res
        .status(400)
        .json({ verified: false, error: "Invalid or expired challenge" });
    }

    const user = findUserById(challengeRecord.user_id);
    if (!user) {
      return res.status(400).json({ verified: false });
    }

    const verification = await verifyRegistrationResponse({
      response: req.body,
      expectedChallenge: challengeFromClient,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });

    if (!verification.verified || !verification.registrationInfo) {
      logAuditEvent(
        user.id,
        "registration.failed",
        "Verification rejected",
        getClientIp(req),
      );
      return res.status(400).json({ verified: false });
    }

    const { credential, credentialDeviceType, credentialBackedUp } =
      verification.registrationInfo;

    savePasskey(
      credential.id,
      user.id,
      credential.publicKey,
      credential.counter,
      credentialDeviceType,
      credentialBackedUp,
      credential.transports,
    );

    logAuditEvent(
      user.id,
      "registration.success",
      `${credential.id.substring(0, 16)}…`,
      getClientIp(req),
    );

    const existingPasskeys = getPasskeysByUser(user.id);
    let recoveryCode: string | undefined;
    if (existingPasskeys.length === 1) {
      recoveryCode = randomBytes(16).toString("hex");
      const hash = createHash("sha256").update(recoveryCode).digest("hex");
      setRecoveryCodeHash(user.id, hash);
    }

    // Auto-login after registration
    req.session.userId = user.id;

    res.json({
      verified: true,
      recoveryCode,
      passkeyCount: existingPasskeys.length,
    });
  } catch (error) {
    logAuditEvent(null, "registration.error", String(error), getClientIp(req));
    return res.status(400).json({
      verified: false,
      error: error instanceof Error ? error.message : "Registration failed",
    });
  }
});

// ============================================================
// AUTHENTICATION
// ============================================================

authRouter.post("/login/options", authLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "A valid email is required" });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const user = findUserByEmail(normalizedEmail);

  if (!user) {
    // Return empty credentials to prevent user enumeration
    const dummyOptions = await generateAuthenticationOptions({
      rpID,
      allowCredentials: [],
      userVerification: "required",
    });
    storeChallenge(dummyOptions.challenge, "nonexistent", "authentication");
    return res.json(dummyOptions);
  }

  const passkeys = getPasskeysByUser(user.id);

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: passkeys.map((pk) => ({
      id: pk.id,
      transports: pk.transports ? JSON.parse(pk.transports) : undefined,
    })),
    userVerification: "required",
  });

  storeChallenge(options.challenge, user.id, "authentication");
  res.json(options);
});

authRouter.post("/login/verify", authLimiter, async (req, res) => {
  try {
    const clientDataJSON = JSON.parse(
      Buffer.from(req.body.response.clientDataJSON, "base64url").toString(),
    );
    const challengeFromClient = clientDataJSON.challenge;

    const challengeRecord = consumeChallenge(
      challengeFromClient,
      "authentication",
    );
    if (!challengeRecord) {
      logAuditEvent(
        null,
        "login.failed",
        "Invalid or expired challenge",
        getClientIp(req),
      );
      return res
        .status(400)
        .json({ verified: false, error: "Invalid or expired challenge" });
    }

    const user = findUserById(challengeRecord.user_id);
    if (!user) {
      return res.status(400).json({ verified: false });
    }

    const passkey = getPasskeyById(req.body.id);
    if (!passkey || passkey.user_id !== user.id) {
      logAuditEvent(
        user.id,
        "login.failed",
        "Passkey mismatch",
        getClientIp(req),
      );
      return res
        .status(400)
        .json({ verified: false, error: "Authentication failed" });
    }

    const credential: WebAuthnCredential = {
      id: passkey.id,
      publicKey: toUint8Array(passkey.public_key),
      counter: passkey.counter,
      transports: passkey.transports
        ? JSON.parse(passkey.transports)
        : undefined,
    };

    const verification = await verifyAuthenticationResponse({
      response: req.body,
      expectedChallenge: challengeFromClient,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential,
      requireUserVerification: true,
    });

    if (!verification.verified) {
      logAuditEvent(
        user.id,
        "login.failed",
        "Assertion rejected",
        getClientIp(req),
      );
      return res.status(400).json({ verified: false });
    }

    const newCounter = verification.authenticationInfo.newCounter;
    if (newCounter > 0 && newCounter <= passkey.counter) {
      logAuditEvent(
        user.id,
        "security.counter_mismatch",
        `stored=${passkey.counter} received=${newCounter}`,
        getClientIp(req),
      );
    }

    updateCounter(passkey.id, newCounter);
    req.session.userId = user.id;

    logAuditEvent(
      user.id,
      "login.success",
      `${passkey.id.substring(0, 16)}…`,
      getClientIp(req),
    );

    res.json({ verified: true });
  } catch (error) {
    logAuditEvent(null, "login.error", String(error), getClientIp(req));
    return res.status(400).json({
      verified: false,
      error: error instanceof Error ? error.message : "Authentication failed",
    });
  }
});

// ============================================================
// LOGOUT
// ============================================================

authRouter.post("/logout", requireSession, (req, res) => {
  const userId = req.session.userId;
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: "Logout failed" });
    logAuditEvent(userId ?? null, "logout", "", getClientIp(req));
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

// ============================================================
// RECOVERY
// ============================================================

authRouter.post("/recover", authLimiter, async (req, res) => {
  const { email, recoveryCode } = req.body;
  if (!email || !recoveryCode) {
    return res
      .status(400)
      .json({ error: "Email and recovery code are required" });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const user = findUserByEmail(normalizedEmail);

  if (!user || !user.recovery_code_hash) {
    logAuditEvent(null, "recovery.failed", normalizedEmail, getClientIp(req));
    return res
      .status(400)
      .json({ error: "Recovery failed. Check your email and code." });
  }

  const providedHash = createHash("sha256").update(recoveryCode).digest("hex");
  if (providedHash !== user.recovery_code_hash) {
    logAuditEvent(user.id, "recovery.failed", "Invalid code", getClientIp(req));
    return res
      .status(400)
      .json({ error: "Recovery failed. Check your email and code." });
  }

  setRecoveryCodeHash(user.id, "");
  req.session.userId = user.id;
  logAuditEvent(user.id, "recovery.success", "Code consumed", getClientIp(req));

  const newRecoveryCode = randomBytes(16).toString("hex");
  const newHash = createHash("sha256").update(newRecoveryCode).digest("hex");
  setRecoveryCodeHash(user.id, newHash);

  res.json({
    ok: true,
    message: "Recovery successful. Register a new passkey now.",
    newRecoveryCode,
  });
});

// ============================================================
// STEP-UP AUTHENTICATION
// ============================================================

authRouter.post("/step-up/options", requireSession, async (req, res) => {
  const user = findUserById(req.session.userId!);
  if (!user) return res.status(404).json({ error: "User not found" });

  const passkeys = getPasskeysByUser(user.id);
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: passkeys.map((pk) => ({
      id: pk.id,
      transports: pk.transports ? JSON.parse(pk.transports) : undefined,
    })),
    userVerification: "required",
  });

  storeChallenge(options.challenge, user.id, "step-up");
  res.json(options);
});

authRouter.post("/step-up/verify", requireSession, async (req, res) => {
  try {
    const clientDataJSON = JSON.parse(
      Buffer.from(req.body.response.clientDataJSON, "base64url").toString(),
    );
    const challengeFromClient = clientDataJSON.challenge;

    const challengeRecord = consumeChallenge(challengeFromClient, "step-up");
    if (!challengeRecord || challengeRecord.user_id !== req.session.userId) {
      return res
        .status(400)
        .json({ verified: false, error: "Invalid or expired challenge" });
    }

    const passkey = getPasskeyById(req.body.id);
    if (!passkey || passkey.user_id !== req.session.userId) {
      return res
        .status(400)
        .json({ verified: false, error: "Passkey not found" });
    }

    const credential: WebAuthnCredential = {
      id: passkey.id,
      publicKey: toUint8Array(passkey.public_key),
      counter: passkey.counter,
      transports: passkey.transports
        ? JSON.parse(passkey.transports)
        : undefined,
    };

    const verification = await verifyAuthenticationResponse({
      response: req.body,
      expectedChallenge: challengeFromClient,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential,
      requireUserVerification: true,
    });

    if (!verification.verified) {
      logAuditEvent(
        req.session.userId!,
        "stepup.failed",
        "Rejected",
        getClientIp(req),
      );
      return res.status(400).json({ verified: false });
    }

    updateCounter(passkey.id, verification.authenticationInfo.newCounter);
    req.session.stepUpUntil = Date.now() + 5 * 60 * 1000;

    logAuditEvent(
      req.session.userId!,
      "stepup.success",
      `${passkey.id.substring(0, 16)}…`,
      getClientIp(req),
    );
    res.json({ verified: true });
  } catch (error) {
    logAuditEvent(
      req.session.userId ?? null,
      "stepup.error",
      String(error),
      getClientIp(req),
    );
    return res.status(400).json({
      verified: false,
      error: error instanceof Error ? error.message : "Step-up failed",
    });
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add server/src/routes/auth.ts
git commit -m "refactor: extract all auth routes to routes/auth.ts"
```

---

### Task 7: Rewrite app.ts as composition root

**Files:**
- Modify: `server/src/app.ts` (replace entire contents)

- [ ] **Step 1: Replace app.ts with the thin composition root**

Replace the entire contents of `server/src/app.ts` with:

```typescript
import cookieParser from "cookie-parser";
import express from "express";
import session from "express-session";

import { cookieSecret, csrfSecret, sessionSecret } from "./config";
import { createCsrfProtection, generalLimiter } from "./middleware";
import { authRouter } from "./routes/auth";
import { passkeysRouter } from "./routes/passkeys";
import { sensitiveRouter } from "./routes/sensitive";
import { userRouter } from "./routes/user";

const app = express();
app.use(express.json());
app.use(cookieParser(cookieSecret));

app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 10 * 60 * 1000,
    },
  }),
);

// --- CSRF ---
const { generateToken, doubleCsrfProtection } = createCsrfProtection(csrfSecret);

app.get("/api/csrf-token", (req, res) => {
  const token = generateToken(req, res);
  res.json({ token });
});

app.use(doubleCsrfProtection);

// --- Rate limiting ---
app.use("/api", generalLimiter);

// --- Routes ---
app.use("/api/auth", authRouter);
app.use("/api", userRouter);
app.use("/api/passkeys", passkeysRouter);
app.use("/api/sensitive", sensitiveRouter);

export default app;
```

- [ ] **Step 2: Commit**

```bash
git add server/src/app.ts
git commit -m "refactor: rewrite app.ts as thin composition root"
```

---

### Task 8: Verify all tests pass

- [ ] **Step 1: Run the full test suite**

Run: `cd server && npm test`
Expected: All 50 tests pass across 7 files, no modifications to test files needed.

- [ ] **Step 2: Run the TypeScript compiler**

Run: `cd server && npx tsc --noEmit`
Expected: No new errors (the pre-existing `db.ts` export error may remain but no new ones).

- [ ] **Step 3: Final commit if any adjustments were needed**

```bash
git add server/src/
git commit -m "refactor: complete route decomposition — all 50 tests passing"
```
