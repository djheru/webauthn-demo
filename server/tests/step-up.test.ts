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
  vi.resetAllMocks();
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

  it("returns 403 when the step-up window has not been established", async () => {
    const { agent, csrfToken } = await createAuthenticatedAgent();

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
