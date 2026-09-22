import { Link, Navigate } from "react-router-dom";
import { ArrowRight, BadgeCheck, Briefcase, MessageSquare, Shield, Star, Wrench } from "lucide-react";
import { CATEGORIES, categoryGroups } from "../lib/format";
import { useAuth } from "../auth/AuthContext";
import { dashboardPath } from "../api/client";
import { clientPath } from "../lib/paths";
import {
  LEAD_GROUPS,
  categoriesForLeadGroup,
  leadGroupHubPath,
} from "../lib/leadGroups";

const STEPS = [
  { n: "1", t: "Post any work", d: "Office, cleaning, repairs, tech, moving — photos, budget, and location in under 2 minutes." },
  { n: "2", t: "Compare bids", d: "See portfolio, ratings, ETA, and price from verified professionals side by side." },
  { n: "3", t: "Hire with confidence", d: "Simulated payment, status timeline, chat, and admin disputes." },
];

export function LandingPage() {
  const { user, loading } = useAuth();
  if (!loading && user) return <Navigate to={dashboardPath(user.role)} replace />;

  const leadCats = LEAD_GROUPS.map((g) => {
    const cats = categoriesForLeadGroup(g);
    return cats[0] ? { group: g, emoji: cats[0].emoji, value: cats[0].value } : null;
  }).filter(Boolean) as { group: string; emoji: string; value: string }[];

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-700 text-white">
            <Wrench className="h-4 w-4" />
          </span>
          <span className="font-display text-xl font-semibold">FixLocal</span>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/login" className="btn-ghost btn-sm no-underline">Log in</Link>
          <Link to="/register" className="btn-primary btn-sm no-underline">Get started</Link>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-brand-100 via-slate-50 to-slate-50" />
        <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-24">
          <div>
            <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-brand-800 ring-1 ring-brand-200 shadow-sm">
              <BadgeCheck className="h-3.5 w-3.5" /> Admin-verified local professionals
            </p>
            <h1 className="font-display text-4xl font-semibold leading-tight tracking-tight text-slate-900 sm:text-5xl">
              Post work.<br />
              <span className="text-brand-700">Get bids</span> from local pros.
            </h1>
            <p className="mt-4 max-w-lg text-lg text-slate-600">
              FixLocal is a general work marketplace — blue-collar, technical, office, and home services.
              Clients post jobs; professionals bid; everyone tracks progress in one place.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/register?role=client" className="btn-primary no-underline">
                Post as a client <ArrowRight className="h-4 w-4" />
              </Link>
              <Link to="/register?role=professional" className="btn-secondary no-underline">
                Join as a professional
              </Link>
            </div>
            <div className="mt-10 flex flex-wrap gap-6 text-sm text-slate-600">
              <span className="flex items-center gap-2"><Shield className="h-4 w-4 text-brand-600" /> Verified professionals</span>
              <span className="flex items-center gap-2"><Star className="h-4 w-4 text-amber-500" /> Ratings & reviews</span>
              <span className="flex items-center gap-2"><MessageSquare className="h-4 w-4 text-brand-600" /> In-job messaging</span>
              <span className="flex items-center gap-2"><Briefcase className="h-4 w-4 text-brand-600" /> Office to on-site</span>
            </div>
          </div>
          <div className="card relative p-6 shadow-lift">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">How it works</p>
            <ol className="mt-4 space-y-4">
              {STEPS.map((s) => (
                <li key={s.n} className="flex gap-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-700 text-sm font-bold text-white">{s.n}</span>
                  <div>
                    <p className="font-semibold text-slate-900">{s.t}</p>
                    <p className="text-sm text-slate-500">{s.d}</p>
                  </div>
                </li>
              ))}
            </ol>
            {/* Demo accounts are only advertised in demo builds (M-9), never on a real deployment. */}
            {import.meta.env.VITE_DEMO_MODE === "true" && (
              <div className="mt-6 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-100">
                <p className="text-xs text-slate-500">Demo logins · Password123!</p>
                <p className="mt-1 text-sm font-medium text-slate-800">Client home@ · Professional pro@ · Admin admin@fixlocal.local</p>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <h2 className="font-display text-2xl font-semibold text-slate-900">Work categories</h2>
        <p className="mt-1 text-sm text-slate-500">
          Tap a group hub for specialties, posting tips, and find-pros / browse-jobs shortcuts.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {leadCats.map((c) => (
            <div key={c.group} className="card flex flex-col gap-3 p-4 transition hover:shadow-lift">
              <Link to={leadGroupHubPath(c.group)} className="flex items-center gap-3 no-underline text-inherit">
                <span className="text-2xl">{c.emoji}</span>
                <div>
                  <p className="font-semibold text-slate-900">{c.group}</p>
                  <p className="text-xs text-slate-500">Open hub · specialties & next steps</p>
                </div>
              </Link>
              <div className="flex flex-wrap gap-2">
                <Link
                  to={leadGroupHubPath(c.group)}
                  className="btn-primary btn-sm no-underline text-xs"
                >
                  View hub
                </Link>
                <Link
                  to={clientPath(`pros?category=${encodeURIComponent(c.value)}`)}
                  className="btn-secondary btn-sm no-underline text-xs"
                >
                  Find pros
                </Link>
                <Link
                  to={`/professional?category=${encodeURIComponent(c.value)}`}
                  className="btn-ghost btn-sm no-underline text-xs"
                >
                  Browse jobs
                </Link>
              </div>
            </div>
          ))}
        </div>
        <details className="mt-6 card p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-800">
            All postable categories ({CATEGORIES.length})
          </summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {categoryGroups().map(([group, cats]) => (
              <div key={group}>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{group}</p>
                <ul className="mt-1 space-y-0.5 text-sm text-slate-700">
                  {cats.map((c) => (
                    <li key={c.value}>
                      <Link
                        to={clientPath(`pros?category=${encodeURIComponent(c.value)}`)}
                        className="text-slate-700 no-underline hover:text-brand-800 hover:underline"
                      >
                        {c.emoji} {c.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      </section>

      <footer className="border-t border-slate-200 bg-white py-8 text-center text-sm text-slate-500">
        FixLocal · App Dev Lab project · Simulated payments only
      </footer>
    </div>
  );
}
