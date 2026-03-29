import { vi } from "vitest";
import supertest from "supertest";
import app from "../../src/app";
import * as db from "../../src/db";
import * as simplewebauthn from "@simplewebauthn/server";
import type { DbUser, DbPasskey } from "../../src/db";

// ── Shared Fixtures ──────────────────────────────────────────

export const TEST_USER: DbUser = {
  id: "user-1",
  email: "alice@example.com",
  webauthn_user_id: Buffer.from("fake-webauthn-user-id"),
  recovery_code_hash: null,
  created_at: "2024-01-01 00:00:00",
};

export const TEST_PASSKEY: DbPasskey = {
  id: "pk-1",
  user_id: "user-1",
  public_key: Buffer.from("fake-public-key"),
  counter: 5,
  device_type: "multiDevice",
  backed_up: 1,
  transports: JSON.stringify(["internal"]),
  label: "My Passkey",
  created_at: "2024-01-01 00:00:00",
  last_used_at: null,
};

// ── Body Builders ────────────────────────────────────────────

/** Encode a challenge into the base64url clientDataJSON format that verify routes parse. */
export const makeClientDataJSON = (challenge: string): string =>
  Buffer.from(
    JSON.stringify({ challenge, type: "webauthn.get", origin: "http://localhost:5173" }),
  ).toString("base64url");

/** Build a request body for login/verify or step-up/verify endpoints. */
export const makeAuthVerifyBody = (challenge: string, passkeyId = TEST_PASSKEY.id) => ({
  id: passkeyId,
  response: {
    clientDataJSON: makeClientDataJSON(challenge),
    authenticatorData: Buffer.from("fake").toString("base64url"),
    signature: Buffer.from("fake").toString("base64url"),
  },
  type: "public-key",
});

/** Build a request body for register/verify endpoint. */
export const makeRegisterVerifyBody = (challenge: string) => ({
  response: {
    clientDataJSON: makeClientDataJSON(challenge),
    attestationObject: Buffer.from("fake").toString("base64url"),
  },
  type: "public-key",
});

// ── Default Mock Setup ───────────────────────────────────────

/**
 * Set up sensible default return values for all mocked db and simplewebauthn functions.
 * Call this in `beforeEach` after `vi.resetAllMocks()`.
 *
 * NOTE: Test files MUST call `vi.mock("../src/db")` and `vi.mock("@simplewebauthn/server")`
 * at the top level before importing this module. Vitest hoists those calls so the mocks
 * are in place when this module's imports resolve.
 */
export const setupDefaultMocks = () => {
  // DB mocks
  vi.mocked(db.findUserByEmail).mockReturnValue(TEST_USER);
  vi.mocked(db.findUserById).mockReturnValue(TEST_USER);
  vi.mocked(db.createUser).mockReturnValue(TEST_USER);
  vi.mocked(db.getPasskeysByUser).mockReturnValue([TEST_PASSKEY]);
  vi.mocked(db.getPasskeyById).mockReturnValue(TEST_PASSKEY);
  vi.mocked(db.consumeChallenge).mockReturnValue({ user_id: TEST_USER.id });
  vi.mocked(db.deletePasskey).mockReturnValue(true);
  vi.mocked(db.toUint8Array).mockImplementation(
    (buf: Buffer) => new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
  );
  vi.mocked(db.parseTransports).mockImplementation(
    (raw: string | null) => (raw ? JSON.parse(raw) : undefined),
  );
  vi.mocked(db.countPasskeysForUser).mockReturnValue(1);

  // SimpleWebAuthn mocks
  vi.mocked(simplewebauthn.generateRegistrationOptions).mockResolvedValue({
    challenge: "test-challenge",
  } as any);
  vi.mocked(simplewebauthn.generateAuthenticationOptions).mockResolvedValue({
    challenge: "test-challenge",
  } as any);
  vi.mocked(simplewebauthn.verifyRegistrationResponse).mockResolvedValue({
    verified: true,
    registrationInfo: {
      credential: {
        id: "new-pk-id",
        publicKey: new Uint8Array([1, 2, 3]),
        counter: 0,
        transports: ["internal"],
      },
      credentialDeviceType: "multiDevice",
      credentialBackedUp: true,
    },
  } as any);
  vi.mocked(simplewebauthn.verifyAuthenticationResponse).mockResolvedValue({
    verified: true,
    authenticationInfo: {
      newCounter: 1,
      credentialID: TEST_PASSKEY.id,
      userVerified: true,
      credentialDeviceType: "multiDevice",
      credentialBackedUp: true,
    },
  } as any);
};

// ── Agent Factories ──────────────────────────────────────────

/**
 * Create a Supertest agent with a valid CSRF token.
 * The agent preserves cookies across requests.
 */
export const createCsrfAgent = async () => {
  const agent = supertest.agent(app);
  const res = await agent.get("/api/csrf-token");
  return { agent, csrfToken: res.body.token as string };
};

/**
 * Create a Supertest agent with a valid CSRF token AND an authenticated session.
 * Uses the login/verify flow with default mocks to establish the session.
 */
export const createAuthenticatedAgent = async () => {
  const { agent, csrfToken } = await createCsrfAgent();

  await agent
    .post("/api/auth/login/verify")
    .set("X-CSRF-Token", csrfToken)
    .send(makeAuthVerifyBody("test-challenge"));

  return { agent, csrfToken, userId: TEST_USER.id };
};
