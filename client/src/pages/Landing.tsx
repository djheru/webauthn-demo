import { Link } from "react-router-dom";
import { useAuth } from "../App";
import {
  Fingerprint,
  ShieldCheck,
  KeyRound,
  Timer,
  ArrowRight,
} from "lucide-react";

const features = [
  {
    icon: Fingerprint,
    title: "Biometric Proof",
    desc: "Your device signs a fresh challenge with a private key that never leaves the authenticator. No passwords to steal.",
  },
  {
    icon: ShieldCheck,
    title: "Phishing Resistant",
    desc: "WebAuthn binds credentials to the origin. A fake site can't trigger a ceremony — the browser blocks it at the protocol level.",
  },
  {
    icon: KeyRound,
    title: "Asymmetric Trust",
    desc: "The server stores only a public key. A database breach gives an attacker nothing they can replay.",
  },
  {
    icon: Timer,
    title: "Short Sessions",
    desc: "10-minute server sessions replace long-lived JWTs. Sensitive actions require a fresh biometric step-up.",
  },
];

export default function Landing() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen grid-bg relative overflow-hidden">
      {/* Top nav */}
      <nav className="relative z-10 flex items-center justify-between px-6 md:px-12 py-5 max-w-7xl mx-auto">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-vault-600 flex items-center justify-center">
            <KeyRound className="w-4 h-4 text-white" />
          </div>
          <span className="font-display text-lg text-zinc-100 tracking-tight">
            Passkey Vault
          </span>
        </div>

        <Link
          to={user ? "/dashboard" : "/auth"}
          className="vault-btn-primary text-sm"
        >
          {user ? "Dashboard" : "Get Started"}
          <ArrowRight className="w-4 h-4" />
        </Link>
      </nav>

      {/* Hero */}
      <section className="relative z-10 max-w-7xl mx-auto px-6 md:px-12 pt-20 md:pt-32 pb-24">
        {/* Glow orb */}
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-[0.07] pointer-events-none"
          style={{
            background:
              "radial-gradient(circle, rgba(34,169,151,1) 0%, transparent 70%)",
          }}
        />

        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-vault-950/60 border border-vault-800/40 text-vault-400 text-xs font-mono mb-8 animate-fade-in">
            <span className="w-1.5 h-1.5 rounded-full bg-vault-400 animate-pulse" />
            WebAuthn · Passwordless · Device-Bound
          </div>

          <h1 className="font-display text-5xl md:text-7xl text-zinc-50 leading-[1.05] mb-6 animate-slide-up">
            Authentication
            <br />
            <span className="text-vault-400">without the weak link</span>
          </h1>

          <p
            className="text-lg md:text-xl text-zinc-400 leading-relaxed max-w-xl mb-10 animate-slide-up"
            style={{ animationDelay: "100ms" }}
          >
            Replace passwords and long-lived tokens with device-bound
            cryptographic proof. Your private key never leaves the
            authenticator. The server stores only what it needs to verify.
          </p>

          <div
            className="flex flex-wrap gap-4 animate-slide-up"
            style={{ animationDelay: "200ms" }}
          >
            <Link to="/auth" className="vault-btn-primary text-base px-8 py-4">
              <Fingerprint className="w-5 h-5" />
              Register a Passkey
            </Link>
            <a
              href="#how-it-works"
              className="vault-btn-ghost text-base px-8 py-4"
            >
              How it works
            </a>
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="glow-line max-w-4xl mx-auto" />

      {/* Features */}
      <section id="how-it-works" className="relative z-10 max-w-7xl mx-auto px-6 md:px-12 py-24">
        <h2 className="font-display text-3xl md:text-4xl text-zinc-100 mb-4">
          Why this architecture
        </h2>
        <p className="text-zinc-500 max-w-xl mb-16">
          A bearer token proves possession of a token. WebAuthn proves
          possession of a trusted device, verified by a fresh cryptographic
          ceremony every time.
        </p>

        <div className="grid md:grid-cols-2 gap-6">
          {features.map((f, i) => (
            <div
              key={f.title}
              className="vault-card p-8 group hover:border-vault-800/50 transition-colors duration-300 animate-slide-up"
              style={{ animationDelay: `${i * 80}ms` }}
            >
              <div className="w-10 h-10 rounded-xl bg-vault-950/80 border border-vault-800/30 flex items-center justify-center mb-5 group-hover:bg-vault-900/60 transition-colors">
                <f.icon className="w-5 h-5 text-vault-400" />
              </div>
              <h3 className="font-body font-semibold text-zinc-100 text-lg mb-2">
                {f.title}
              </h3>
              <p className="text-zinc-500 text-sm leading-relaxed">
                {f.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Ceremony flow */}
      <section className="relative z-10 max-w-7xl mx-auto px-6 md:px-12 pb-24">
        <div className="vault-card p-8 md:p-12">
          <h3 className="font-display text-2xl text-zinc-100 mb-6">
            The ceremony, step by step
          </h3>
          <div className="grid md:grid-cols-4 gap-8">
            {[
              {
                step: "01",
                label: "Challenge",
                desc: "Server generates a unique, time-limited challenge and stores it in the database.",
              },
              {
                step: "02",
                label: "Sign",
                desc: "Your authenticator signs the challenge with a device-bound private key after biometric check.",
              },
              {
                step: "03",
                label: "Verify",
                desc: "Server validates the signature against the stored public key, checking origin and counter.",
              },
              {
                step: "04",
                label: "Session",
                desc: "A short-lived HTTP-only session cookie is issued. No bearer tokens in localStorage.",
              },
            ].map((s) => (
              <div key={s.step}>
                <span className="font-mono text-vault-500 text-sm">
                  {s.step}
                </span>
                <h4 className="font-body font-semibold text-zinc-200 mt-1 mb-2">
                  {s.label}
                </h4>
                <p className="text-zinc-500 text-sm leading-relaxed">
                  {s.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-surface-200 py-8">
        <div className="max-w-7xl mx-auto px-6 md:px-12 flex items-center justify-between">
          <span className="text-zinc-600 text-sm font-mono">
            Passkey Vault Demo
          </span>
          <span className="text-zinc-600 text-sm">
            Built with WebAuthn + SimpleWebAuthn + Express + React
          </span>
        </div>
      </footer>
    </div>
  );
}
