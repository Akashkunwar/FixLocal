import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { dashboardPath } from "../api/client";

export function Shell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function onLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="shell">
      <header className="topbar">
        <Link to={user ? dashboardPath(user.role) : "/"} className="brand">
          FixLocal
        </Link>
        <div className="topbar-right">
          {user && (
            <>
              <span className="muted">
                {user.email} · {user.role}
              </span>
              <button type="button" className="btn ghost" onClick={onLogout}>
                Log out
              </button>
            </>
          )}
        </div>
      </header>
      <main className="page">
        <h1>{title}</h1>
        {children}
      </main>
    </div>
  );
}
