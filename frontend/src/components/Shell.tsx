import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { dashboardPath } from "../api/client";
import { NotificationBell } from "./NotificationBell";
import { EmailVerifyBanner } from "./EmailVerifyBanner";
import { LogOut, Wrench } from "lucide-react";
import clsx from "clsx";
import { initials, roleLabel } from "../lib/format";

const clientLinks = [
  { to: "/client", label: "My jobs", end: true },
  { to: "/client/jobs/new", label: "Post a job" },
  { to: "/client/pros", label: "Find professionals" },
  { to: "/client/favorites", label: "Shortlist" },
  { to: "/settings", label: "Settings" },
];

const proLinks = [
  { to: "/professional", label: "Browse jobs", end: true },
  { to: "/professional/my-jobs", label: "My jobs" },
  { to: "/professional/analytics", label: "Analytics" },
  { to: "/professional/profile", label: "Portfolio" },
  { to: "/professional/favorites", label: "Saved" },
  { to: "/settings", label: "Settings" },
];

const adminLinks = [
  { to: "/admin", label: "Overview", end: true },
  { to: "/admin/users", label: "Users" },
  { to: "/admin/tradespeople", label: "Verify" },
  { to: "/admin/disputes", label: "Disputes" },
  { to: "/admin/reports", label: "Reports" },
  { to: "/admin/jobs", label: "Jobs" },
  { to: "/admin/audit", label: "Audit" },
  { to: "/admin/match", label: "Match" },
];

export function Shell({
  title,
  subtitle,
  actions,
  children,
}: {
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const links =
    user?.role === "ADMIN"
      ? adminLinks
      : user?.role === "HOMEOWNER"
        ? clientLinks
        : proLinks;

  async function onLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-20 md:pb-0">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link
            to={user ? dashboardPath(user.role) : "/"}
            className="flex items-center gap-2 text-slate-900 no-underline min-h-[44px]"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-700 text-white shadow-sm">
              <Wrench className="h-4 w-4" />
            </span>
            <span className="font-display text-xl font-semibold tracking-tight">FixLocal</span>
          </Link>

          {user && (
            <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
              {links.map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  end={"end" in l ? l.end : false}
                  className={({ isActive }) =>
                    clsx(
                      "rounded-lg px-3 py-2 text-sm font-medium no-underline transition",
                      isActive
                        ? "bg-brand-50 text-brand-800"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    )
                  }
                >
                  {l.label}
                </NavLink>
              ))}
            </nav>
          )}

          <div className="flex items-center gap-1.5 sm:gap-2">
            {user && <NotificationBell />}
            {user && (
              <>
                <div className="hidden sm:flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 text-[11px] font-bold text-brand-800">
                    {initials(user.name, user.email)}
                  </div>
                  <div className="leading-tight">
                    <p className="text-xs font-semibold text-slate-800 max-w-[10rem] truncate">
                      {user.name || user.email}
                    </p>
                    <p className="text-[10px] uppercase tracking-wide text-slate-400">{roleLabel(user.role)}</p>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-ghost btn-sm touch-target"
                  onClick={onLogout}
                  aria-label="Log out"
                >
                  <LogOut className="h-4 w-4" />
                  <span className="hidden sm:inline">Log out</span>
                </button>
              </>
            )}
          </div>
        </div>
      </header>
      <EmailVerifyBanner />

      <main className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-8">
        {(title || actions) && (
          <div className="mb-5 sm:mb-6 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              {title && (
                <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900">
                  {title}
                </h1>
              )}
              {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
            </div>
            {actions && <div className="flex flex-wrap gap-2 w-full sm:w-auto">{actions}</div>}
          </div>
        )}
        {children}
      </main>

      {user && (
        <nav
          className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur-md md:hidden safe-bottom"
          aria-label="Mobile primary"
        >
          <div className="mx-auto flex max-w-6xl overflow-x-auto px-1 py-1">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={"end" in l ? l.end : false}
                className={({ isActive }) =>
                  clsx(
                    "flex min-w-[4.5rem] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-2 text-[11px] font-semibold no-underline touch-target",
                    isActive ? "bg-brand-50 text-brand-800" : "text-slate-500"
                  )
                }
              >
                {l.label}
              </NavLink>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}
