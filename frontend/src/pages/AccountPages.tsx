import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { forgotPassword, resetPassword, verifyEmail } from "../api/client";
import { useAuth } from "../auth/AuthContext";

import { t } from "../lib/i18n";
import { errorText } from "../lib/apiErrors";
import { AuthTopBar } from "../components/AuthTopBar";
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 p-6">
      <div className="w-full max-w-md">
        <AuthTopBar />
      </div>
      <div className="card w-full max-w-md space-y-4 p-8">
        <h1 className="font-display text-2xl font-semibold text-slate-900">{title}</h1>
        {children}
      </div>
    </main>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      setSent((await forgotPassword(email.trim())).message);
    } catch (ex) {
      setErr(errorText(ex));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t("Reset your password")}>
      {sent ? (
        <p className="text-sm text-slate-600" role="status">
          {sent}
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm text-slate-500">{t("Enter your account email and we'll send you a reset link.")}</p>
          {err && (
            <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
              {err}
            </p>
          )}
          <div>
            <label className="label" htmlFor="forgot-email">
              
              {t("Email")}
            </label>
            <input
              id="forgot-email"
              className="input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? t("Sending…") : t("Send reset link")}
          </button>
        </form>
      )}
      <p className="text-center text-sm">
        <Link to="/login">{t("Back to sign in")}</Link>
      </p>
    </Card>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setErr(t("The two passwords don't match"));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await resetPassword(token, password);
      navigate("/login?reset=1", { replace: true });
    } catch (ex) {
      setErr(errorText(ex));
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <Card title={t("Reset link missing")}>
        <p className="text-sm text-slate-600">{t("Open the link from your email, or request a new one.")}</p>
        <Link to="/forgot-password">{t("Request a new link")}</Link>
      </Card>
    );
  }
  return (
    <Card title={t("Choose a new password")}>
      <form onSubmit={submit} className="space-y-4">
        {err && (
          <div className="space-y-1 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
            <p>{err}</p>
            {/* An expired or mistyped link is the usual cause: never leave the user stuck here. */}
            <Link to="/forgot-password" className="font-semibold text-rose-800 underline">
              {t("Request a new link")}
            </Link>
          </div>
        )}
        <div>
          <label className="label" htmlFor="new-password">
            
            {t("New password")}
          </label>
          <input
            id="new-password"
            className="input"
            type="password"
            autoComplete="new-password"
            minLength={10}
            maxLength={128}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="mt-1 text-xs text-slate-500">{t("At least 10 characters. You'll be signed out on other devices.")}</p>
        </div>
        <div>
          <label className="label" htmlFor="confirm-password">
            
            {t("Confirm password")}
          </label>
          <input
            id="confirm-password"
            className="input"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? t("Saving…") : t("Save new password")}
        </button>
      </form>
    </Card>
  );
}

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const { user, refreshUser } = useAuth();
  const token = params.get("token") || "";
  const [state, setState] = useState<"working" | "done" | "failed">(token ? "working" : "failed");
  const [message, setMessage] = useState(token ? t("Verifying your email…") : t("This link is missing its token."));
  const started = useRef(false);
  const refreshed = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    verifyEmail(token)
      .then(async () => {
        setState("done");
        setMessage(t("Your email is verified."));
      })
      .catch((e) => {
        setState("failed");
        setMessage(errorText(e, "This link isn't valid. Ask for a new one."));
      });
  }, [token]);

  // The session may finish restoring after verification succeeds: refresh once a user is there,
  // so the "confirm your email" banner disappears without a reload.
  useEffect(() => {
    if (state !== "done" || !user || refreshed.current) return;
    refreshed.current = true;
    refreshUser().catch(() => undefined);
  }, [state, user, refreshUser]);

  return (
    <Card title={state === "done" ? t("Email verified") : state === "failed" ? t("Couldn't verify") : t("Verifying")}>
      <p className="text-sm text-slate-600" role="status">
        {message}
      </p>
      <Link className="btn-primary w-full" to={user ? "/" : "/login"}>
        {user ? t("Continue") : t("Sign in")}
      </Link>
    </Card>
  );
}
