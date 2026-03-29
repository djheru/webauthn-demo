import {
  startRegistration,
  startAuthentication,
} from "@simplewebauthn/browser";
import { apiFetch, fetchMe } from "./api";

export type RegisterResult = {
  verified: boolean;
  recoveryCode?: string;
  passkeyCount?: number;
  error?: string;
};

export async function registerPasskey(
  email: string
): Promise<RegisterResult> {
  const optionsResp = await apiFetch("/api/auth/register/options", {
    method: "POST",
    body: JSON.stringify({ email }),
  });

  if (!optionsResp.ok) {
    const err = await optionsResp.json();
    throw new Error(err.error || "Failed to get registration options");
  }

  const optionsJSON = await optionsResp.json();
  const registrationResponse = await startRegistration({ optionsJSON });

  const verifyResp = await apiFetch("/api/auth/register/verify", {
    method: "POST",
    body: JSON.stringify(registrationResponse),
  });

  return verifyResp.json();
}

export type LoginResult = {
  verified: boolean;
  error?: string;
};

export async function loginWithPasskey(
  email: string
): Promise<LoginResult> {
  const optionsResp = await apiFetch("/api/auth/login/options", {
    method: "POST",
    body: JSON.stringify({ email }),
  });

  if (!optionsResp.ok) {
    const err = await optionsResp.json();
    throw new Error(err.error || "Failed to get login options");
  }

  const optionsJSON = await optionsResp.json();
  const authenticationResponse = await startAuthentication({ optionsJSON });

  const verifyResp = await apiFetch("/api/auth/login/verify", {
    method: "POST",
    body: JSON.stringify(authenticationResponse),
  });

  return verifyResp.json();
}

export async function addPasskey(): Promise<RegisterResult> {
  const me = await fetchMe();
  if (!me) throw new Error("Not authenticated");
  return registerPasskey(me.email);
}

export async function stepUpVerify(): Promise<{ verified: boolean }> {
  const optionsResp = await apiFetch("/api/auth/step-up/options", {
    method: "POST",
  });

  if (!optionsResp.ok) {
    throw new Error("Failed to get step-up options");
  }

  const optionsJSON = await optionsResp.json();
  const authenticationResponse = await startAuthentication({ optionsJSON });

  const verifyResp = await apiFetch("/api/auth/step-up/verify", {
    method: "POST",
    body: JSON.stringify(authenticationResponse),
  });

  return verifyResp.json();
}
