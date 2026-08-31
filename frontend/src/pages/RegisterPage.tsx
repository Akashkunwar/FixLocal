import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ApiError, dashboardPath } from "../api/client";
import { useAuth } from "../auth/AuthContext";

export function RegisterPage() {
  const { user, loading, register } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"HOMEOWNER" | "TRADESPERSON">("HOMEOWNER");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user) {
    return <Navigate to={dashboardPath(user.role)} replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const u = await register(email.trim(), password, role);
      navigate(dashboardPath(u.role), { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Registration failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="card" onSubmit={onSubmit}>
        <h1>Create account</h1>
        <p className="muted">Homeowner or tradesperson only</p>
        {error && <div className="alert">{error}</div>}
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
        </label>
        <label>
          Role
          <select
            value={role}
            onChange={(e) =>
              setRole(e.target.value as "HOMEOWNER" | "TRADESPERSON")
            }
          >
            <option value="HOMEOWNER">Homeowner</option>
            <option value="TRADESPERSON">Tradesperson</option>
          </select>
        </label>
        <button className="btn primary" type="submit" disabled={submitting}>
          {submitting ? "Creating…" : "Register"}
        </button>
        <p className="muted">
          Already registered? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
