import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Fingerprint,
  KeyRound,
  LogOut,
  Monitor,
  Pencil,
  Plus,
  Shield,
  ShieldCheck,
  Smartphone,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../App";
import {
  apiFetch,
  deletePasskeyApi,
  logout,
  renamePasskeyApi,
  resetCsrfToken,
  type UserInfo,
} from "../lib/api";
import { addPasskey, stepUpVerify } from "../lib/webauthn";

type PasskeyInfo = UserInfo["passkeys"][number];

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr + "Z").getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function PasskeyCard({
  pk,
  onRename,
  onDelete,
  isOnly,
}: {
  pk: PasskeyInfo;
  onRename: (id: string, label: string) => void;
  onDelete: (id: string) => void;
  isOnly: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(pk.label);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function handleSave() {
    if (label.trim() && label.trim() !== pk.label) {
      onRename(pk.id, label.trim());
    }
    setEditing(false);
  }

  return (
    <div className="group bg-surface-50 border border-surface-300 rounded-xl p-5 hover:border-surface-400 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3.5 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-surface-200 border border-surface-300 flex items-center justify-center shrink-0 mt-0.5">
            {pk.deviceType === "multiDevice" ? (
              <Smartphone className="w-4 h-4 text-vault-400" />
            ) : (
              <Monitor className="w-4 h-4 text-zinc-500" />
            )}
          </div>
          <div className="min-w-0">
            {editing ? (
              <div className="flex items-center gap-2">
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSave()}
                  maxLength={64}
                  autoFocus
                  className="bg-surface-100 border border-vault-600 rounded-lg px-2.5 py-1 text-sm text-zinc-200 font-medium focus:outline-none focus:ring-1 focus:ring-vault-500/50 w-48"
                />
                <button
                  onClick={handleSave}
                  className="text-vault-400 hover:text-vault-300 text-xs font-medium"
                >
                  Save
                </button>
                <button
                  onClick={() => {
                    setLabel(pk.label);
                    setEditing(false);
                  }}
                  className="text-zinc-600 hover:text-zinc-400"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <h4 className="text-zinc-200 font-medium text-sm truncate">
                {pk.label}
              </h4>
            )}

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
              <span className="flex items-center gap-1 text-zinc-600 text-xs">
                <Clock className="w-3 h-3" />
                Used {timeAgo(pk.lastUsedAt)}
              </span>
              {pk.backedUp && (
                <span className="flex items-center gap-1 text-vault-600 text-xs">
                  <Shield className="w-3 h-3" />
                  Synced
                </span>
              )}
              <span className="text-zinc-700 text-xs font-mono">
                {pk.id.substring(0, 12)}…
              </span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              className="p-1.5 rounded-lg hover:bg-surface-200 text-zinc-600 hover:text-zinc-300 transition-colors"
              title="Rename"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}

          {confirmDelete ? (
            <div className="flex items-center gap-1 animate-slide-down">
              <button
                onClick={() => {
                  onDelete(pk.id);
                  setConfirmDelete(false);
                }}
                className="px-2 py-1 rounded-lg bg-red-900/50 text-red-400 text-xs font-medium hover:bg-red-900/70 transition-colors"
              >
                Confirm
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="p-1 text-zinc-600 hover:text-zinc-400"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={isOnly}
              className="p-1.5 rounded-lg hover:bg-red-950/50 text-zinc-600 hover:text-red-400 transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
              title={isOnly ? "Cannot delete your only passkey" : "Revoke"}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, refresh } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [stepUpActive, setStepUpActive] = useState(false);

  const clearMessages = useCallback(() => {
    setError(null);
    setSuccess(null);
  }, []);

  async function handleLogout() {
    await logout();
    navigate("/auth");
  }

  async function handleAddPasskey() {
    clearMessages();
    setLoading(true);
    try {
      const result = await addPasskey();
      if (result.verified) {
        setSuccess("New passkey registered successfully.");
        await refresh();
      } else {
        setError(result.error || "Registration failed");
      }
    } catch (err: any) {
      if (err.name === "NotAllowedError") {
        setError("Ceremony was cancelled.");
      } else {
        setError(err.message || "Failed to add passkey");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleRename(id: string, label: string) {
    clearMessages();
    const ok = await renamePasskeyApi(id, label);
    if (ok) {
      await refresh();
    } else {
      setError("Failed to rename passkey");
    }
  }

  async function handleDelete(id: string) {
    clearMessages();
    const result = await deletePasskeyApi(id);
    if (result.ok) {
      setSuccess("Passkey revoked.");
      await refresh();
    } else {
      setError(result.error || "Failed to delete passkey");
    }
  }

  async function handleStepUp() {
    clearMessages();
    setLoading(true);
    try {
      const result = await stepUpVerify();
      if (result.verified) {
        setStepUpActive(true);
        setSuccess("Step-up verified. You have a 5-minute elevated window.");
      } else {
        setError("Step-up verification failed");
      }
    } catch (err: any) {
      if (err.name === "NotAllowedError") {
        setError("Ceremony was cancelled.");
      } else {
        setError(err.message || "Step-up failed");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleSensitiveAction() {
    clearMessages();
    setLoading(true);
    try {
      const resp = await apiFetch("/api/sensitive/action", {
        method: "POST",
        body: JSON.stringify({ amount: 100, currency: "USD" }),
      });
      const data = await resp.json();
      if (resp.ok) {
        setSuccess("Sensitive action processed successfully.");
      } else {
        if (resp.status === 403) {
          resetCsrfToken();
          setStepUpActive(false);
          setError("Step-up expired. Please verify again.");
        } else {
          setError(data.error || "Sensitive action failed");
        }
      }
    } catch (err: any) {
      setError(err.message || "Sensitive action failed");
    } finally {
      setLoading(false);
    }
  }

  if (!user) return null;

  return (
    <div className="min-h-screen grid-bg">
      {/* Top bar */}
      <nav className="border-b border-surface-200 bg-surface-0/80 backdrop-blur-md sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-vault-600 flex items-center justify-center">
              <KeyRound className="w-4 h-4 text-white" />
            </div>
            <span className="font-display text-lg text-zinc-100">
              Passkey Vault
            </span>
          </Link>

          <div className="flex items-center gap-4">
            <span className="text-zinc-500 text-sm hidden sm:block">
              {user.email}
            </span>
            <button
              onClick={handleLogout}
              className="vault-btn-ghost text-xs px-3 py-2"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-10 space-y-8">
        {/* Welcome */}
        <div className="animate-fade-in">
          <h1 className="font-display text-3xl md:text-4xl text-zinc-100 mb-2">
            Welcome back
          </h1>
          <p className="text-zinc-500">
            You're authenticated with a device-bound passkey. Your session
            expires in 10 minutes.
          </p>
        </div>

        {/* Messages */}
        {error && (
          <div className="flex items-start gap-2 bg-red-950/40 border border-red-900/40 rounded-xl p-4 animate-slide-down">
            <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
            <span className="text-red-300 text-sm">{error}</span>
            <button
              onClick={() => setError(null)}
              className="ml-auto text-red-600 hover:text-red-400"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {success && (
          <div className="flex items-start gap-2 bg-vault-950/50 border border-vault-800/30 rounded-xl p-4 animate-slide-down">
            <CheckCircle2 className="w-4 h-4 text-vault-400 mt-0.5 shrink-0" />
            <span className="text-vault-300 text-sm">{success}</span>
            <button
              onClick={() => setSuccess(null)}
              className="ml-auto text-vault-700 hover:text-vault-500"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="grid lg:grid-cols-5 gap-8">
          {/* Left: Passkeys */}
          <div className="lg:col-span-3 space-y-6">
            <div className="vault-card p-6 md:p-8 animate-slide-up">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <Fingerprint className="w-5 h-5 text-vault-400" />
                  <h2 className="font-body font-semibold text-zinc-100 text-lg">
                    Your Passkeys
                  </h2>
                  <span className="bg-surface-300 text-zinc-400 text-xs font-mono px-2 py-0.5 rounded-md">
                    {user.passkeys.length}
                  </span>
                </div>

                <button
                  onClick={handleAddPasskey}
                  disabled={loading}
                  className="vault-btn-ghost text-xs px-3 py-2"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Passkey
                </button>
              </div>

              <div className="space-y-3">
                {user.passkeys.map((pk) => (
                  <PasskeyCard
                    key={pk.id}
                    pk={pk}
                    onRename={handleRename}
                    onDelete={handleDelete}
                    isOnly={user.passkeys.length <= 1}
                  />
                ))}

                {user.passkeys.length === 0 && (
                  <div className="text-center py-12 text-zinc-600">
                    <Fingerprint className="w-8 h-8 mx-auto mb-3 opacity-50" />
                    <p className="text-sm">No passkeys registered yet.</p>
                  </div>
                )}
              </div>

              {user.passkeys.length === 1 && (
                <div className="mt-4 flex items-start gap-2 bg-amber-950/30 border border-amber-900/30 rounded-xl p-3">
                  <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                  <span className="text-amber-400/80 text-xs leading-relaxed">
                    You only have one passkey. Add a second from another device
                    or a security key as a backup.
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Right: Step-Up Demo */}
          <div className="lg:col-span-2 space-y-6">
            <div
              className="vault-card p-6 md:p-8 animate-slide-up"
              style={{ animationDelay: "100ms" }}
            >
              <div className="flex items-center gap-3 mb-5">
                <ShieldCheck className="w-5 h-5 text-vault-400" />
                <h2 className="font-body font-semibold text-zinc-100 text-lg">
                  Step-Up Demo
                </h2>
              </div>

              <p className="text-zinc-500 text-sm leading-relaxed mb-6">
                Sensitive actions require a fresh biometric verification, even
                when you're already signed in. This gives you a 5-minute
                elevated window.
              </p>

              {/* Status indicator */}
              <div
                className={`flex items-center gap-2.5 rounded-xl p-3 mb-5 border transition-colors duration-300 ${
                  stepUpActive
                    ? "bg-vault-950/50 border-vault-800/40"
                    : "bg-surface-50 border-surface-300"
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    stepUpActive ? "bg-vault-400 animate-pulse" : "bg-zinc-700"
                  }`}
                />
                <span
                  className={`text-sm font-medium ${
                    stepUpActive ? "text-vault-300" : "text-zinc-600"
                  }`}
                >
                  {stepUpActive ? "Elevated access active" : "Standard access"}
                </span>
              </div>

              <div className="space-y-3">
                <button
                  onClick={handleStepUp}
                  disabled={loading}
                  className="vault-btn-primary w-full text-sm"
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Verifying…
                    </span>
                  ) : (
                    <>
                      <Fingerprint className="w-4 h-4" />
                      Verify Identity
                    </>
                  )}
                </button>

                <button
                  onClick={handleSensitiveAction}
                  disabled={loading || !stepUpActive}
                  className="vault-btn-ghost w-full text-sm"
                >
                  <Zap className="w-4 h-4" />
                  Elevated Auth Action
                </button>
              </div>
            </div>

            {/* Session info card */}
            <div
              className="vault-card p-6 animate-slide-up"
              style={{ animationDelay: "200ms" }}
            >
              <h3 className="text-zinc-400 text-xs font-mono uppercase tracking-wider mb-4">
                Session Details
              </h3>
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-zinc-600">User ID</dt>
                  <dd className="text-zinc-400 font-mono text-xs truncate max-w-[180px]">
                    {user.id}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-zinc-600">Email</dt>
                  <dd className="text-zinc-300">{user.email}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-zinc-600">Credentials</dt>
                  <dd className="text-zinc-300">{user.passkeys.length}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-zinc-600">Session Type</dt>
                  <dd className="text-zinc-300">HTTP-only cookie</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-zinc-600">Max Age</dt>
                  <dd className="text-zinc-300">10 minutes</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
