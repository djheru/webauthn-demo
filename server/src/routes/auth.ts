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
  countPasskeysForUser,
  createUser,
  findUserByEmail,
  findUserById,
  getPasskeyById,
  getPasskeysByUser,
  logAuditEvent,
  parseTransports,
  savePasskey,
  setRecoveryCodeHash,
  storeChallenge,
  toUint8Array,
  updateCounter,
} from "../db";
import { authLimiter, extractChallenge, getClientIp, requireSession } from "../middleware";

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
      transports: parseTransports(pk.transports),
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
    const challengeFromClient = extractChallenge(req.body.response.clientDataJSON);

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

    const passkeyCount = countPasskeysForUser(user.id);
    let recoveryCode: string | undefined;
    if (passkeyCount === 1) {
      recoveryCode = randomBytes(16).toString("hex");
      const hash = createHash("sha256").update(recoveryCode).digest("hex");
      setRecoveryCodeHash(user.id, hash);
    }

    // Auto-login after registration
    req.session.userId = user.id;

    res.json({
      verified: true,
      recoveryCode,
      passkeyCount,
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
      transports: parseTransports(pk.transports),
    })),
    userVerification: "required",
  });

  storeChallenge(options.challenge, user.id, "authentication");
  res.json(options);
});

authRouter.post("/login/verify", authLimiter, async (req, res) => {
  try {
    const challengeFromClient = extractChallenge(req.body.response.clientDataJSON);

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
      transports: parseTransports(passkey.transports),
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
      transports: parseTransports(pk.transports),
    })),
    userVerification: "required",
  });

  storeChallenge(options.challenge, user.id, "step-up");
  res.json(options);
});

authRouter.post("/step-up/verify", requireSession, async (req, res) => {
  try {
    const challengeFromClient = extractChallenge(req.body.response.clientDataJSON);

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
      transports: parseTransports(passkey.transports),
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
