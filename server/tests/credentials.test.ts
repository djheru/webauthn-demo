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
