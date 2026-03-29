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
  vi.resetAllMocks();
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
