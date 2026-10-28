import { tf, useI18n } from "../lib/i18n";
import { FormEvent, useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { dashboardPath, resendConfirmation } from "../api/client";
import { useToast } from "../components/Toast";
import { Gift } from "lucide-react";
import { safeNext } from "../lib/paths";
import clsx from "clsx";

import { errorText } from "../lib/apiErrors";
import { AuthTopBar } from "../components/AuthTopBar";
const ROLE_CARDS = [
  {
    role: "HOMEOWNER" as const,
    title: "Client",
    tagline: "I post work",
    detail: "Describe the job, compare bids from verified professionals, and hire.",
  },
  {
    role: "TRADESPERSON" as const,
    title: "Professional",
    tagline: "I bid on work",
    detail: "Build a portfolio, get admin-verified, then bid on open jobs near you.",
  },
];

const REF_KEY = "fixlocal:ref";

function readReferral(fromUrl: string | null): string {
  const clean = (v: string | null) => (v || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
  try {
    if (clean(fromUrl)) sessionStorage.setItem(REF_KEY, clean(fromUrl));
    return sessionStorage.getItem(REF_KEY) || "";
  } catch {
    return clean(fromUrl);
  }
}

export function RegisterPage() {
  const { user, register, loading } = useAuth();
  const [params] = useSearchParams();
  const { t, lang } = useI18n();
  // Invite links (?ref=CODE) survive a detour to /login and back within the tab.
  const [referral] = useState(() => readReferral(params.get("ref")));
  const { error } = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"HOMEOWNER" | "TRADESPERSON">("HOMEOWNER");
  const [agreed, setAgreed] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const r = (params.get("role") || params.get("as") || "").toLowerCase();
    if (r === "client" || r === "homeowner" || r === "HOMEOWNER".toLowerCase()) {
      setRole("HOMEOWNER");
    } else if (r === "professional" || r === "pro" || r === "tradesperson") {
      setRole("TRADESPERSON");
    }
  }, [params]);

  if (!loading && user) return <Navigate to={dashboardPath(user.role)} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 10) {
      setErr(t("Password must be at least 10 characters"));
      return;
    }
    if (!agreed) {
      setErr(t("Please accept the Terms of Service and Privacy Policy to continue"));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await register(email.trim(), password, role, {
        name: name.trim() || undefined,
        phone: phone.trim() || undefined,
        referralCode: referral || undefined,
        language: lang,
      });
      setPassword("");
      setSentTo(email.trim());
      try {
        sessionStorage.removeItem(REF_KEY);
      } catch {
        /* storage blocked: nothing to clear */
      }
    } catch (ex) {
      const msg = errorText(ex, "Registration failed");
      setErr(msg);
      error(msg);
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) {
    const next = safeNext(params.get("next"));
    const loginTo = `/login${next ? `?next=${encodeURIComponent(next)}` : ""}`;
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <section className="card w-full max-w-lg p-8 space-y-4" aria-labelledby="check-inbox">
          <AuthTopBar />
          <h1 id="check-inbox" className="font-display text-2xl font-semibold">{t("Check your inbox")}</h1>
          <p className="text-sm text-slate-600" role="status">
            
            {tf("We've sent a link to {email}. Open it to confirm your email, then log in. If you already have an account with this address, the email explains how to get back in.", { email: sentTo })}
          </p>
          <Link className="btn-primary w-full no-underline" to={loginTo}>
            
            {t("Go to log in")}
          </Link>
          <p className="text-center text-sm text-slate-500">
            {resent ? (
              t("Sent again. It can take a minute to arrive; check spam too.")
            ) : (
              <button
                type="button"
                className="font-semibold text-brand-700 underline"
                onClick={() =>
                  resendConfirmation(sentTo)
                    .then(() => setResent(true))
                    .catch((e) => error(errorText(e)))
                }
              >
                
                {t("Didn't get it? Send the link again")}
              </button>
            )}
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <form onSubmit={onSubmit} className="card w-full max-w-lg p-8 space-y-4">
        <AuthTopBar />
        <div>
          <h1 className="font-display text-2xl font-semibold">{t("Create your account")}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {t("Clients post work. Professionals bid after admin verification.")}
          </p>
          {referral && (
            <p className="mt-3 rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-900" role="status">
              <Gift className="mr-1 inline h-4 w-4" aria-hidden /> {t("A friend invited you to FixLocal. Welcome!")}
            </p>
          )}
        </div>
        {err && (
          <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200" role="alert">
            {err}
          </div>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          {ROLE_CARDS.map((c) => (
            <button
              key={c.role}
              type="button"
              className={clsx(
                "rounded-xl border p-3 text-left transition",
                role === c.role
                  ? "border-brand-400 bg-brand-50 shadow-xs ring-1 ring-brand-200"
                  : "border-slate-200 bg-white hover:border-slate-300"
              )}
              onClick={() => setRole(c.role)}
            >
              <p className="text-sm font-semibold text-slate-900">{t(c.title)}</p>
              <p className="mt-0.5 text-xs font-medium text-brand-800">{t(c.tagline)}</p>
              <p className="mt-1.5 text-[11px] leading-snug text-slate-500">{c.detail}</p>
            </button>
          ))}
        </div>

        <div>
          <label className="label" htmlFor="name">{t("Full name")}</label>
          <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Your name")} />
        </div>
        <div>
          <label className="label" htmlFor="email">{t("Email")}</label>
          <input id="email" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="phone">{t("Phone (optional)")}</label>
          <input id="phone" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="password">{t("Password")}</label>
          <input id="password" className="input" type="password" required minLength={10} maxLength={128} aria-describedby="password-hint" value={password} onChange={(e) => setPassword(e.target.value)} />
          <p id="password-hint" className="mt-1 text-xs text-slate-500">{t("At least 10 characters. Avoid common passwords.")}</p>
        </div>
        <label className="flex items-start gap-2 text-sm text-slate-600" htmlFor="accept-terms">
          <input
            id="accept-terms"
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
          />
          <span>
            
            {t("I am 18 or older and agree to the")}{" "}
            <Link to="/terms" target="_blank" rel="noopener">{t("Terms of Service")}</Link> {" "}{t("and")}{" "}
            <Link to="/privacy" target="_blank" rel="noopener">{t("Privacy Policy")}</Link>.
          </span>
        </label>
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? t("Creating…") : t("Create account")}
        </button>
        <p className="text-center text-sm text-slate-500">
          
          {t("Already have an account?")}{" "}<Link to="/login">{t("Log in")}</Link>
        </p>
      </form>
    </main>
  );
}
