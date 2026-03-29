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
  vi.resetAllMocks();
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
    vi.mocked(db.countPasskeysForUser).mockReturnValue(2);

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
