import express from "express";
import session from "express-session";
import cookieParser from "cookie-parser";
import { doubleCsrf } from "csrf-csrf";
import rateLimit from "express-rate-limit";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type WebAuthnCredential,
} from "@simplewebauthn/server";

import {
  createUser,
  findUserByEmail,
  findUserById,
  getPasskeysByUser,
  getPasskeyById,
  savePasskey,
  updateCounter,
  renamePasskey,
  deletePasskey,
  storeChallenge,
  consumeChallenge,
  logAuditEvent,
  setRecoveryCodeHash,
  toUint8Array,
} from "./db";

// --- Relying Party config ---
const rpName = "Passkey Vault";
const rpID = "localhost";
const origin = "http://localhost:5173";

// --- Session type augmentation ---
declare module "express-session" {
  interface SessionData {
    userId?: string;
    stepUpUntil?: number;
  }
}

// --- Express app ---
const app = express();
app.use(express.json());
app.use(cookieParser("replace-this-in-production"));

// --- Session ---
app.use(
  session({
    secret: "replace-this-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 10 * 60 * 1000,
    },
  })
);

// --- CSRF ---
const { generateToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => "replace-this-csrf-secret-in-production",
  cookieName: "__csrf",
  cookieOptions: { httpOnly: true, sameSite: "lax" as const, secure: false },
  getTokenFromRequest: (req) => req.headers["x-csrf-token"] as string,
});

app.get("/api/csrf-token", (req, res) => {
  const token = generateToken(req, res);
  res.json({ token });
});

app.use(doubleCsrfProtection);

// --- Rate limiting ---
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts, please slow down" },
});

app.use("/api", generalLimiter);

// --- Helpers ---
function getClientIp(req: express.Request): string {
  return (
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.ip ||
    "unknown"
  );
}

function requireSession(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

function requireRecentStepUp(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  if (!req.session.stepUpUntil || req.session.stepUpUntil < Date.now()) {
    return res.status(403).json({ error: "Fresh verification required" });
  }
  next();
}

// ============================================================
// REGISTRATION
// ============================================================

app.post("/api/auth/register/options", authLimiter, async (req, res) => {
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

app.post("/api/auth/register/verify", authLimiter, async (req, res) => {
  try {
    const clientDataJSON = JSON.parse(
      Buffer.from(req.body.response.clientDataJSON, "base64url").toString()
    );
    const challengeFromClient = clientDataJSON.challenge;

    const challengeRecord = consumeChallenge(
      challengeFromClient,
      "registration"
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
        getClientIp(req)
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
      credential.transports
    );

    logAuditEvent(
      user.id,
      "registration.success",
      `${credential.id.substring(0, 16)}…`,
      getClientIp(req)
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

app.post("/api/auth/login/options", authLimiter, async (req, res) => {
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

app.post("/api/auth/login/verify", authLimiter, async (req, res) => {
  try {
    const clientDataJSON = JSON.parse(
      Buffer.from(req.body.response.clientDataJSON, "base64url").toString()
    );
    const challengeFromClient = clientDataJSON.challenge;

    const challengeRecord = consumeChallenge(
      challengeFromClient,
      "authentication"
    );
    if (!challengeRecord) {
      logAuditEvent(
        null,
        "login.failed",
        "Invalid or expired challenge",
        getClientIp(req)
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
        getClientIp(req)
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
        getClientIp(req)
      );
      return res.status(400).json({ verified: false });
    }

    const newCounter = verification.authenticationInfo.newCounter;
    if (newCounter > 0 && newCounter <= passkey.counter) {
      logAuditEvent(
        user.id,
        "security.counter_mismatch",
        `stored=${passkey.counter} received=${newCounter}`,
        getClientIp(req)
      );
    }

    updateCounter(passkey.id, newCounter);
    req.session.userId = user.id;

    logAuditEvent(
      user.id,
      "login.success",
      `${passkey.id.substring(0, 16)}…`,
      getClientIp(req)
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
// SESSION & USER
// ============================================================

app.get("/api/me", requireSession, (req, res) => {
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

app.post("/api/auth/logout", requireSession, (req, res) => {
  const userId = req.session.userId;
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: "Logout failed" });
    logAuditEvent(userId ?? null, "logout", "", getClientIp(req));
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

// ============================================================
// CREDENTIAL MANAGEMENT
// ============================================================

app.patch("/api/passkeys/:id", requireSession, (req, res) => {
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
    getClientIp(req)
  );
  res.json({ ok: true });
});

app.delete("/api/passkeys/:id", requireSession, (req, res) => {
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
    getClientIp(req)
  );
  res.json({ ok: true });
});

// ============================================================
// RECOVERY
// ============================================================

app.post("/api/auth/recover", authLimiter, async (req, res) => {
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

  const providedHash = createHash("sha256")
    .update(recoveryCode)
    .digest("hex");
  if (providedHash !== user.recovery_code_hash) {
    logAuditEvent(
      user.id,
      "recovery.failed",
      "Invalid code",
      getClientIp(req)
    );
    return res
      .status(400)
      .json({ error: "Recovery failed. Check your email and code." });
  }

  setRecoveryCodeHash(user.id, "");
  req.session.userId = user.id;
  logAuditEvent(
    user.id,
    "recovery.success",
    "Code consumed",
    getClientIp(req)
  );

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

app.post("/api/auth/step-up/options", requireSession, async (req, res) => {
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

app.post("/api/auth/step-up/verify", requireSession, async (req, res) => {
  try {
    const clientDataJSON = JSON.parse(
      Buffer.from(req.body.response.clientDataJSON, "base64url").toString()
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
        getClientIp(req)
      );
      return res.status(400).json({ verified: false });
    }

    updateCounter(passkey.id, verification.authenticationInfo.newCounter);
    req.session.stepUpUntil = Date.now() + 5 * 60 * 1000;

    logAuditEvent(
      req.session.userId!,
      "stepup.success",
      `${passkey.id.substring(0, 16)}…`,
      getClientIp(req)
    );
    res.json({ verified: true });
  } catch (error) {
    logAuditEvent(
      req.session.userId ?? null,
      "stepup.error",
      String(error),
      getClientIp(req)
    );
    return res.status(400).json({
      verified: false,
      error: error instanceof Error ? error.message : "Step-up failed",
    });
  }
});

// Example protected sensitive route
app.post(
  "/api/billing/payout",
  requireSession,
  requireRecentStepUp,
  (req, res) => {
    logAuditEvent(
      req.session.userId!,
      "billing.payout",
      JSON.stringify(req.body),
      getClientIp(req)
    );
    res.json({ ok: true, message: "Payout processed" });
  }
);

// ============================================================
// START
// ============================================================

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`✦ Passkey Vault server on http://localhost:${PORT}`);
});
