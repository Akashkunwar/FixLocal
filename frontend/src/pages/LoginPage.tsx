import { FormEvent, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { dashboardPath } from "../api/client";
import { ApiError } from "../api/client";
import { Wrench } from "lucide-react";
import { useToast } from "../components/Toast";

function safeNext(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}

export function LoginPage() {
  const { user, login, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const { success, error } = useToast();
  const [email, setEmail] = useState("home@fixlocal.local");
  const [password, setPassword] = useState("Password123!");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
      success("Welcome back!");
      navigate(pendingNext || dashboardPath(u.role), { replace: true });
    } catch (ex: any) {
      const msg = ex instanceof ApiError ? ex.message : "Login failed";
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
          <span className="font-display text-xl font-semibold">FixLocal</span>
        </div>
        <div>
          <h2 className="font-display text-3xl font-semibold leading-snug">
            Your neighborhood&apos;s trusted work marketplace.
          </h2>
          <p className="mt-3 text-brand-100">Verified professionals. Transparent bids. Clear timelines.</p>
        </div>
        <p className="text-sm text-brand-200">Demo · Password123!</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={onSubmit} className="card w-full max-w-md p-8 space-y-4">
          <div>
            <h1 className="font-display text-2xl font-semibold text-slate-900">Welcome back</h1>
            <p className="mt-1 text-sm text-slate-500">Log in to manage jobs, bids, and messages.</p>
          </div>
          {err && <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200" role="alert">{err}</div>}
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input id="password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <p className="text-center text-sm text-slate-500">
            New here? <Link to="/register">Create an account</Link>
          </p>
          <div className="flex flex-wrap gap-2 pt-2">
            {[
              ["Client", "home@fixlocal.local"],
              ["Professional", "pro@fixlocal.local"],
              ["Admin", "admin@fixlocal.local"],
            ].map(([label, em]) => (
              <button
                key={em}
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => { setEmail(em); setPassword("Password123!"); }}
              >
                {label}
              </button>
            ))}
          </div>
        </form>
      </div>
    </div>
  );
}
