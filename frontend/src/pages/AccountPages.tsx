import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { forgotPassword, resetPassword, verifyEmail } from "../api/client";
import { useAuth } from "../auth/AuthContext";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="card w-full max-w-md space-y-4 p-8">
        <h1 className="font-display text-2xl font-semibold text-slate-900">{title}</h1>
        {children}
      </div>
    </div>
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
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Reset your password">
      {sent ? (
        <p className="text-sm text-slate-600" role="status">
          {sent}
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm text-slate-500">Enter your account email and we'll send you a reset link.</p>
          {err && (
            <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
              {err}
            </p>
          )}
          <div>
            <label className="label" htmlFor="forgot-email">
              Email
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
            {busy ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}
      <p className="text-center text-sm">
        <Link to="/login">Back to sign in</Link>
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
      setErr("The two passwords don't match");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await resetPassword(token, password);
      navigate("/login?reset=1", { replace: true });
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <Card title="Reset link missing">
        <p className="text-sm text-slate-600">Open the link from your email, or request a new one.</p>
        <Link to="/forgot-password">Request a new link</Link>
      </Card>
    );
  }
  return (
    <Card title="Choose a new password">
      <form onSubmit={submit} className="space-y-4">
        {err && (
          <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
            {err}
          </p>
        )}
        <div>
          <label className="label" htmlFor="new-password">
            New password
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
          <p className="mt-1 text-xs text-slate-500">At least 10 characters. You'll be signed out on other devices.</p>
        </div>
        <div>
          <label className="label" htmlFor="confirm-password">
            Confirm password
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
          {busy ? "Saving…" : "Save new password"}
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
  const [message, setMessage] = useState(token ? "Verifying your email…" : "This link is missing its token.");
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    verifyEmail(token)
      .then(async () => {
        setState("done");
        setMessage("Your email is verified.");
        if (user) await refreshUser().catch(() => undefined);
      })
      .catch((e) => {
        setState("failed");
        setMessage((e as Error).message);
      });
  }, [token, user, refreshUser]);

  return (
    <Card title={state === "done" ? "Email verified" : state === "failed" ? "Couldn't verify" : "Verifying"}>
      <p className="text-sm text-slate-600" role="status">
        {message}
      </p>
      <Link className="btn-primary w-full" to={user ? "/" : "/login"}>
        {user ? "Continue" : "Sign in"}
      </Link>
    </Card>
  );
}
