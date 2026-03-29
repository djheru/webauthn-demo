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
  vi.resetAllMocks();
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
