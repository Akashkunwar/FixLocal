import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Briefcase, Search, Wrench } from "lucide-react";
import {
  categoriesForLeadGroup,
  leadGroupBlurb,
  leadGroupFromSlug,
  LEAD_GROUPS,
  leadGroupHubPath,
} from "../lib/leadGroups";
import { clientPath, proPath } from "../lib/paths";
import { useAuth } from "../auth/AuthContext";

export function LeadGroupHubPage() {
  const { groupSlug } = useParams<{ groupSlug: string }>();
  const group = leadGroupFromSlug(groupSlug || "");
  const { user } = useAuth();

  if (!group) {
    return <Navigate to="/" replace />;
  }

  const cats = categoriesForLeadGroup(group);
  const lead = cats[0];
  const postHref = user?.role === "HOMEOWNER"
    ? clientPath("jobs/new")
    : "/register?role=client";
  const findHref = user?.role === "HOMEOWNER"
    ? clientPath(`pros?category=${encodeURIComponent(lead?.value || "")}`)
    : `/login?next=${encodeURIComponent(clientPath(`pros?category=${encodeURIComponent(lead?.value || "")}`))}`;
  const browseHref = user?.role === "TRADESPERSON"
    ? `${proPath()}?category=${encodeURIComponent(lead?.value || "")}`
    : `/login?next=${encodeURIComponent(`${proPath()}?category=${encodeURIComponent(lead?.value || "")}`)}`;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Link to="/" className="flex items-center gap-2 no-underline text-inherit">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-700 text-white">
            <Wrench className="h-4 w-4" />
          </span>
          <span className="font-display text-xl font-semibold">FixLocal</span>
        </Link>
        <div className="flex items-center gap-2">
          <Link to="/" className="btn-ghost btn-sm no-underline inline-flex items-center gap-1">
            <ArrowLeft className="h-3.5 w-3.5" /> Home
          </Link>
          {!user && (
            <>
              <Link to="/login" className="btn-ghost btn-sm no-underline">Log in</Link>
              <Link to="/register" className="btn-primary btn-sm no-underline">Get started</Link>
            </>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
          Category group
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold text-slate-900 sm:text-4xl">
          {lead?.emoji ? `${lead.emoji} ` : ""}
          {group}
        </h1>
        <p className="mt-3 max-w-2xl text-slate-600">{leadGroupBlurb(group)}</p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link to={postHref} className="btn-primary no-underline">
            Post a job <ArrowRight className="h-4 w-4" />
          </Link>
          <Link to={findHref} className="btn-secondary no-underline inline-flex items-center gap-1.5">
            <Search className="h-4 w-4" /> Find professionals
          </Link>
          <Link to={browseHref} className="btn-ghost no-underline inline-flex items-center gap-1.5">
            <Briefcase className="h-4 w-4" /> Browse open jobs
          </Link>
        </div>

        <section className="mt-12">
          <h2 className="font-semibold text-lg text-slate-900">Specialties in this group</h2>
          <p className="mt-1 text-sm text-slate-500">
            Tap a specialty to find matching professionals{user ? "" : " (sign in as a client)"}.
          </p>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cats.map((c) => (
              <li key={c.value} className="card p-4 transition hover:shadow-lift">
                <p className="font-semibold text-slate-900">
                  <span className="mr-1.5">{c.emoji}</span>
                  {c.label}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link
                    to={
                      user?.role === "HOMEOWNER"
                        ? clientPath(`pros?category=${encodeURIComponent(c.value)}`)
                        : `/login?next=${encodeURIComponent(clientPath(`pros?category=${encodeURIComponent(c.value)}`))}`
                    }
                    className="btn-secondary btn-sm no-underline text-xs"
                  >
                    Find pros
                  </Link>
                  <Link
                    to={
                      user?.role === "HOMEOWNER"
                        ? clientPath("jobs/new")
                        : "/register?role=client"
                    }
                    className="btn-ghost btn-sm no-underline text-xs"
                  >
                    Post this work
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-12">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Other category groups
          </h2>
          <div className="mt-3 flex flex-wrap gap-2" role="navigation" aria-label="Other lead groups">
            {LEAD_GROUPS.filter((g) => g !== group).map((g) => {
              const emoji = categoriesForLeadGroup(g)[0]?.emoji || "🛠️";
              return (
                <Link
                  key={g}
                  to={leadGroupHubPath(g)}
                  className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 no-underline hover:bg-slate-50"
                >
                  {emoji} {g}
                </Link>
              );
            })}
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white py-8 text-center text-sm text-slate-500">
        FixLocal · App Dev Lab project · Simulated payments only
      </footer>
    </div>
  );
}
