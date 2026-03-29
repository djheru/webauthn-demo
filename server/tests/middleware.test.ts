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
  vi.resetAllMocks();
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
