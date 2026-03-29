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
  vi.resetAllMocks();
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
