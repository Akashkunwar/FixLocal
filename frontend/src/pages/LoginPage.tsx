import { useI18n } from "../lib/i18n";
import { FormEvent, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { dashboardPath, resendConfirmation } from "../api/client";
import { Wrench } from "lucide-react";
import { safeNext } from "../lib/paths";
import { useToast } from "../components/Toast";

import { errorText } from "../lib/apiErrors";
export function LoginPage() {
  const { user, login, loading } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const { success, error } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const demoMode = import.meta.env.VITE_DEMO_MODE === "true";
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  const pendingNext =
    safeNext(params.get("next")) ||
    safeNext((location.state as { from?: string } | null)?.from);

  if (!loading && user) {
    return <Navigate to={pendingNext || dashboardPath(user.role)} replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const u = await login(email.trim(), password);
      success(t("Welcome back!"));
      navigate(pendingNext || dashboardPath(u.role), { replace: true });
    } catch (ex) {
      const msg = errorText(ex, "Login failed");
      setErr(msg);
      error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between bg-brand-800 p-10 text-white">
        <div className="flex items-center gap-2">
          <Wrench className="h-5 w-5" />
          <span className="font-display text-xl font-semibold">{t("FixLocal")}</span>
        </div>
        <div>
          <h2 className="font-display text-3xl font-semibold leading-snug">
            {t("Your neighborhood's trusted work marketplace.")}
          </h2>
          <p className="mt-3 text-brand-100">{t("Verified professionals. Transparent bids. Clear timelines.")}</p>
        </div>
        <p className="text-sm text-brand-200">{t("Local services, handled with care.")}</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={onSubmit} className="card w-full max-w-md p-8 space-y-4">
          <div>
            <h1 className="font-display text-2xl font-semibold text-slate-900">{t("Welcome back")}</h1>
            <p className="mt-1 text-sm text-slate-500">{t("Log in to manage jobs, bids, and messages.")}</p>
          </div>
          {params.get("reset") === "1" && !err && (
            <div className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200" role="status">
              {t("Password updated. Sign in with your new password.")}
            </div>
          )}
          {err && (
            <div className="space-y-1 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200" role="alert">
              <p>{err}</p>
              <p className="text-rose-800">
                
                {t("Just signed up? Confirm your email first.")}{" "}
                {resent ? (
                  <span>{t("If that address needs confirming, a new link is on its way.")}</span>
                ) : (
                  <button
                    type="button"
                    className="font-semibold underline"
                    disabled={!email.trim()}
                    onClick={() =>
                      resendConfirmation(email.trim())
                        .then(() => setResent(true))
                        .catch((e) => error(errorText(e)))
                    }
                  >
                    
                    {t("Resend the confirmation link")}
                  </button>
                )}
              </p>
            </div>
          )}
          <div>
            <label className="label" htmlFor="email">{t("Email")}</label>
            <input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="password">{t("Password")}</label>
            <input id="password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? t("Signing in…") : t("Sign in")}
          </button>
          <p className="text-center text-sm text-slate-500">
            <Link to="/forgot-password">{t("Forgot your password?")}</Link>
          </p>
          <p className="text-center text-sm text-slate-500">
            {t("New here?")} <Link to="/register">{t("Create an account")}</Link>
          </p>
          {demoMode && (
            <div className="space-y-2 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
              <p className="text-xs font-semibold text-slate-500">{t("Demo accounts (local only)")}</p>
              <div className="flex flex-wrap gap-2">
                {[
                  ["Client", "home@fixlocal.local"],
                  ["Professional", "pro@fixlocal.local"],
                  ["Admin", "admin@fixlocal.local"],
                ].map(([label, em]) => (
                  <button
                    key={em}
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => {
                      setEmail(em);
                      setPassword("Password123!");
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
