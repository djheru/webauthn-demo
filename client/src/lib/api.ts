let csrfToken: string | null = null;

async function getCsrfToken(): Promise<string> {
  if (!csrfToken) {
    const resp = await fetch("/api/csrf-token", { credentials: "same-origin" });
    const data = await resp.json();
    csrfToken = data.token;
  }
  return csrfToken!;
}

export async function apiFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = await getCsrfToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-CSRF-Token": token,
    ...(options.headers as Record<string, string>),
  };
  return fetch(url, {
    ...options,
    credentials: "same-origin",
    headers,
  });
}

// Invalidate cached CSRF token (e.g. on 403)
export function resetCsrfToken() {
  csrfToken = null;
}

export type UserInfo = {
  id: string;
  email: string;
  passkeys: {
    id: string;
    label: string;
    deviceType: string;
    backedUp: boolean;
    createdAt: string;
    lastUsedAt: string | null;
  }[];
};

export async function fetchMe(): Promise<UserInfo | null> {
  try {
    const resp = await fetch("/api/me", { credentials: "same-origin" });
    if (!resp.ok) return null;
    return resp.json();
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  await apiFetch("/api/auth/logout", { method: "POST" });
  resetCsrfToken();
}

export async function renamePasskeyApi(
  id: string,
  label: string
): Promise<boolean> {
  const resp = await apiFetch(`/api/passkeys/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ label }),
  });
  return resp.ok;
}

export async function deletePasskeyApi(id: string): Promise<{
  ok: boolean;
  error?: string;
}> {
  const resp = await apiFetch(`/api/passkeys/${id}`, { method: "DELETE" });
  const data = await resp.json();
  return { ok: resp.ok, error: data.error };
}
