import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../App";
import { registerPasskey, loginWithPasskey } from "../lib/webauthn";
import { apiFetch } from "../lib/api";
import {
  KeyRound,
  Fingerprint,
  LogIn,
  AlertCircle,
  CheckCircle2,
  Copy,
  LifeBuoy,
  ArrowLeft,
} from "lucide-react";

type Tab = "register" | "login" | "recover";

export default function Auth() {
  const navigate = useNavigate();
  const { refresh, user } = useAuth();

  const [tab, setTab] = useState<Tab>("register");
  const [email, setEmail] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [shownRecoveryCode, setShownRecoveryCode] = useState<string | null>(
    null
  );
  const [copied, setCopied] = useState(false);

  // Redirect if already logged in
  if (user) {
    navigate("/dashboard", { replace: true });
    return null;
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      const result = await registerPasskey(email);
      if (result.verified) {
        if (result.recoveryCode) {
          setShownRecoveryCode(result.recoveryCode);
        } else {
          await refresh();
          navigate("/dashboard");
        }
      } else {
        setError(result.error || "Registration failed");
      }
    } catch (err: any) {
      if (err.name === "NotAllowedError") {
        setError("Ceremony was cancelled. Try again.");
      } else {
        setError(err.message || "Registration failed");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const result = await loginWithPasskey(email);
      if (result.verified) {
        await refresh();
        navigate("/dashboard");
      } else {
        setError(result.error || "Login failed");
      }
    } catch (err: any) {
      if (err.name === "NotAllowedError") {
        setError("Ceremony was cancelled. Try again.");
      } else {
        setError(err.message || "Login failed");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleRecover(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      const resp = await apiFetch("/api/auth/recover", {
        method: "POST",
        body: JSON.stringify({ email, recoveryCode }),
      });
      const data = await resp.json();

      if (resp.ok) {
        if (data.newRecoveryCode) {
          setShownRecoveryCode(data.newRecoveryCode);
          setSuccess(
            "Recovery successful! Save your new recovery code below, then register a new passkey."
          );
        } else {
          await refresh();
          navigate("/dashboard");
        }
      } else {
        setError(data.error || "Recovery failed");
      }
    } catch (err: any) {
      setError(err.message || "Recovery failed");
    } finally {
      setLoading(false);
    }
  }

  function handleContinueAfterRecovery() {
    setShownRecoveryCode(null);
    refresh().then(() => navigate("/dashboard"));
  }

  async function copyCode() {
    if (!shownRecoveryCode) return;
    await navigator.clipboard.writeText(shownRecoveryCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Recovery code interstitial
  if (shownRecoveryCode) {
    return (
      <div className="min-h-screen grid-bg flex items-center justify-center p-6">
        <div className="vault-card max-w-md w-full p-8 animate-slide-up">
          <div className="w-12 h-12 rounded-xl bg-amber-900/40 border border-amber-800/40 flex items-center justify-center mb-6">
            <LifeBuoy className="w-6 h-6 text-amber-400" />
          </div>

          <h2 className="font-display text-2xl text-zinc-100 mb-2">
            Save your recovery code
          </h2>
          <p className="text-zinc-500 text-sm mb-6 leading-relaxed">
            This is your only way back in if you lose all your devices.
            Store it in a password manager or print it. It will not be shown
            again.
          </p>

          <div className="relative mb-6">
            <code className="block bg-surface-0 border border-surface-300 rounded-xl p-4 font-mono text-vault-300 text-sm tracking-widest break-all select-all">
              {shownRecoveryCode}
            </code>
            <button
              onClick={copyCode}
              className="absolute top-3 right-3 p-1.5 rounded-lg bg-surface-200 hover:bg-surface-300 transition-colors"
            >
              {copied ? (
                <CheckCircle2 className="w-4 h-4 text-vault-400" />
              ) : (
                <Copy className="w-4 h-4 text-zinc-500" />
              )}
            </button>
          </div>

          {success && (
            <div className="flex items-start gap-2 bg-vault-950/50 border border-vault-800/30 rounded-xl p-3 mb-4">
              <CheckCircle2 className="w-4 h-4 text-vault-400 mt-0.5 shrink-0" />
              <span className="text-vault-300 text-sm">{success}</span>
            </div>
          )}

          <button
            onClick={handleContinueAfterRecovery}
            className="vault-btn-primary w-full"
          >
            I've saved it — continue
          </button>
        </div>
      </div>
    );
  }

  const tabs: { key: Tab; label: string; icon: typeof Fingerprint }[] = [
    { key: "register", label: "Register", icon: Fingerprint },
    { key: "login", label: "Sign In", icon: LogIn },
    { key: "recover", label: "Recover", icon: LifeBuoy },
  ];

  return (
    <div className="min-h-screen grid-bg flex items-center justify-center p-6 relative">
      {/* Back link */}
      <Link
        to="/"
        className="absolute top-6 left-6 flex items-center gap-2 text-zinc-500 hover:text-zinc-300 transition-colors text-sm"
      >
        <ArrowLeft className="w-4 h-4" />
        Back
      </Link>

      <div className="w-full max-w-md animate-slide-up">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-vault-600 flex items-center justify-center">
            <KeyRound className="w-5 h-5 text-white" />
          </div>
          <span className="font-display text-xl text-zinc-100">
            Passkey Vault
          </span>
        </div>

        {/* Tab bar */}
        <div className="flex bg-surface-100 border border-surface-300 rounded-xl p-1 mb-6">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => {
                setTab(t.key);
                setError(null);
                setSuccess(null);
              }}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                tab === t.key
                  ? "bg-surface-300 text-zinc-100 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <t.icon className="w-4 h-4" />
              {t.label}
            </button>
          ))}
        </div>

        {/* Card */}
        <div className="vault-card p-8">
          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 bg-red-950/40 border border-red-900/40 rounded-xl p-3 mb-6 animate-slide-down">
              <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
              <span className="text-red-300 text-sm">{error}</span>
            </div>
          )}

          {tab === "register" && (
            <form onSubmit={handleRegister} className="space-y-5">
              <div>
                <label className="block text-zinc-400 text-sm font-medium mb-2">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="vault-input"
                  autoFocus
                />
              </div>

              <button
                type="submit"
                disabled={loading || !email}
                className="vault-btn-primary w-full"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Waiting for authenticator…
                  </span>
                ) : (
                  <>
                    <Fingerprint className="w-5 h-5" />
                    Create Passkey
                  </>
                )}
              </button>

              <p className="text-center text-zinc-600 text-xs">
                Your browser will prompt for biometric verification.
                <br />
                No password is created or stored.
              </p>
            </form>
          )}

          {tab === "login" && (
            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <label className="block text-zinc-400 text-sm font-medium mb-2">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="vault-input"
                  autoFocus
                />
              </div>

              <button
                type="submit"
                disabled={loading || !email}
                className="vault-btn-primary w-full"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Waiting for authenticator…
                  </span>
                ) : (
                  <>
                    <LogIn className="w-5 h-5" />
                    Sign In with Passkey
                  </>
                )}
              </button>

              <p className="text-center text-zinc-600 text-xs">
                Your device will verify your identity
                <br />
                using biometrics or a security key.
              </p>
            </form>
          )}

          {tab === "recover" && (
            <form onSubmit={handleRecover} className="space-y-5">
              <div>
                <label className="block text-zinc-400 text-sm font-medium mb-2">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="vault-input"
                />
              </div>

              <div>
                <label className="block text-zinc-400 text-sm font-medium mb-2">
                  Recovery Code
                </label>
                <input
                  type="text"
                  value={recoveryCode}
                  onChange={(e) => setRecoveryCode(e.target.value)}
                  placeholder="Paste your 32-character recovery code"
                  required
                  className="vault-input font-mono text-sm tracking-wider"
                />
              </div>

              <button
                type="submit"
                disabled={loading || !email || !recoveryCode}
                className="vault-btn-primary w-full"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Verifying…
                  </span>
                ) : (
                  <>
                    <LifeBuoy className="w-5 h-5" />
                    Recover Account
                  </>
                )}
              </button>

              <p className="text-center text-zinc-600 text-xs">
                After recovery, you'll be prompted to register
                <br />a new passkey on your current device.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
