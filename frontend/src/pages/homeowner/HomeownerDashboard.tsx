import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Shell } from "../../components/Shell";
import { listJobs, getHomeownerInviteAnalytics, getHomeownerShortlistInviteAnalytics, getHomeownerCounterAnalytics, type Job, type InviteAnalytics, type ShortlistInviteAnalytics, type CounterAnalytics } from "../../api/jobs";
import { Badge } from "../../components/ui/Badge";
import { Spinner } from "../../components/ui/Spinner";
import { EmptyState } from "../../components/ui/EmptyState";
import { categoryEmoji, categoryGroups, categoryLabel, fmtDate, money } from "../../lib/format";
import { Plus, Search } from "lucide-react";
import { OnboardingChecklist } from "../../components/OnboardingChecklist";
import { useAuth } from "../../auth/AuthContext";
import { clientPath } from "../../lib/paths";
import { saveRepeatDraft } from "../../lib/repeatJob";
import {
  mergeNamedJobTemplates,
  namedTemplateFromJob,
  upsertNamedJobTemplate,
} from "../../lib/namedJobTemplates";
import { useToast } from "../../components/Toast";

export function HomeownerDashboard() {
  const { user, updateProfile } = useAuth();
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteStats, setInviteStats] = useState<InviteAnalytics | null>(null);
  const [shortlistFunnel, setShortlistFunnel] = useState<ShortlistInviteAnalytics | null>(null);
  const [counterStats, setCounterStats] = useState<CounterAnalytics | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [area, setArea] = useState("");
  const [budgetMin, setBudgetMin] = useState("");
  const [budgetMax, setBudgetMax] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await listJobs({
        q: q || undefined,
        status: status || undefined,
        category: category || undefined,
        area: area || undefined,
        budgetMin: budgetMin || undefined,
        budgetMax: budgetMax || undefined,
      });
      setJobs(r.jobs);
    } catch (e) {
      setError((e as Error).message || "Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once when the page opens
  }, []);

  useEffect(() => {
    getHomeownerInviteAnalytics()
      .then(setInviteStats)
      .catch(() => setInviteStats(null));
    getHomeownerShortlistInviteAnalytics()
      .then(setShortlistFunnel)
      .catch(() => setShortlistFunnel(null));
    getHomeownerCounterAnalytics()
      .then(setCounterStats)
      .catch(() => setCounterStats(null));
  }, []);

  return (
    <Shell
      title="My jobs"
      subtitle="Track posts, compare bids, and manage repairs"
      actions={
        <Link to="/client/jobs/new" className="btn-primary no-underline">
          <Plus className="h-4 w-4" /> Post a job
        </Link>
      }
    >
      <OnboardingChecklist
        variant="client"
        title="Client getting started"
        subtitle="A short checklist — dismiss anytime"
        items={[
          {
            id: "name",
            label: "Add your name in Settings",
            done: Boolean(user?.name && String(user.name).trim()),
            to: "/settings",
          },
          {
            id: "post",
            label: "Post your first job",
            done: jobs.length > 0,
            to: clientPath("jobs/new"),
          },
          {
            id: "find",
            label: "Browse professionals",
            done: false,
            to: clientPath("pros"),
          },
          {
            id: "shortlist",
            label: "Save a pro to your shortlist",
            done: false,
            to: clientPath("favorites"),
          },
        ].map((item) =>
          item.id === "find"
            ? { ...item, done: localStorage.getItem("fixlocal:onboarding:client:visitedPros") === "1" }
            : item.id === "shortlist"
              ? { ...item, done: localStorage.getItem("fixlocal:onboarding:client:savedPro") === "1" }
              : item
        )}
      />
      {inviteStats && inviteStats.sent > 0 && (
        <div className="mb-5 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: "Invites sent", value: inviteStats.sent },
            { label: "Declined", value: inviteStats.declined, sub: `${inviteStats.declineRate}%` },
            { label: "Opened", value: inviteStats.opened, sub: `${inviteStats.openRate}%` },
            { label: "Bid after invite", value: inviteStats.bidAfterInvite, sub: `${inviteStats.bidRate}%` },
          ].map((c) => (
            <div key={c.label} className="card px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">{c.label}</p>
              <p className="text-xl font-bold text-slate-900">{c.value}</p>
              {"sub" in c && c.sub ? <p className="text-[11px] text-slate-500">{c.sub}</p> : null}
            </div>
          ))}
        </div>
      )}
      {shortlistFunnel && shortlistFunnel.ranked > 0 && (
        <div className="mb-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Shortlist funnel (rank → invite → bid)
          </p>
          <div className="grid grid-cols-3 gap-2">
            {shortlistFunnel.funnel.map((s) => (
              <div key={s.stage} className="card px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-slate-400">{s.label}</p>
                <p className="text-xl font-bold text-slate-900">{s.count}</p>
                <p className="text-[11px] text-slate-500">
                  {s.stage === "ranked" ? "saved pros" : `${s.rate}%`}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {counterStats && counterStats.sent > 0 && (
        <div className="mb-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Counter-offer analytics · time-to-address SLA
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: "Counters sent", value: counterStats.sent },
              { label: "Addressed", value: counterStats.addressed, sub: `${counterStats.addressRate}%` },
              { label: "Declined", value: counterStats.declined, sub: `${counterStats.declineRate}%` },
              {
                label: "Avg time to address",
                value:
                  counterStats.avgTimeToAddressHours != null
                    ? `${counterStats.avgTimeToAddressHours}h`
                    : "—",
                sub:
                  counterStats.medianTimeToAddressHours != null
                    ? `med ${counterStats.medianTimeToAddressHours}h`
                    : undefined,
              },
            ].map((c) => (
              <div key={c.label} className="card px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-slate-400">{c.label}</p>
                <p className="text-xl font-bold text-slate-900">{c.value}</p>
                {"sub" in c && c.sub ? <p className="text-[11px] text-slate-500">{c.sub}</p> : null}
              </div>
            ))}
          </div>
          {(counterStats.afterAddressedAccepted > 0 || counterStats.afterAddressedRejected > 0) && (
            <p className="mt-2 text-[11px] text-slate-500">
              After address → accepted {counterStats.afterAddressedAccepted} · rejected{" "}
              {counterStats.afterAddressedRejected} · still open {counterStats.afterAddressedOpen}
            </p>
          )}
        </div>
      )}
      <div className="mb-5 flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-9"
            placeholder="Search jobs…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()}
          />
        </div>
        <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {["open", "awarded", "in_progress", "pending_confirmation", "completed", "cancelled", "disputed"].map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
          ))}
        </select>
        <select className="input w-auto" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {categoryGroups().map(([group, cats]) => (
            <optgroup key={group} label={group}>
              {cats.map((c) => (
                <option key={c.value} value={c.value}>{c.emoji} {c.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <input className="input w-auto min-w-[110px]" placeholder="Area" value={area} onChange={(e) => setArea(e.target.value)} />
        <input className="input w-28" type="number" min={0} placeholder="Min ₹" value={budgetMin} onChange={(e) => setBudgetMin(e.target.value)} />
        <input className="input w-28" type="number" min={0} placeholder="Max ₹" value={budgetMax} onChange={(e) => setBudgetMax(e.target.value)} />
        <button type="button" className="btn-secondary" onClick={load}>Filter</button>
      </div>

      {loading ? (
        <Spinner />
      ) : error ? (
        <div className="rounded-xl bg-rose-50 p-4 text-rose-700">{error}</div>
      ) : jobs.length === 0 ? (
        <EmptyState
          title="No jobs yet"
          description="Playbook: pick a category group → post with photos and budget → invite suggested pros → compare bids → hire. Verified professionals will start bidding."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Link to="/client/jobs/new" className="btn-primary no-underline">
                Post a job
              </Link>
              <Link to="/client/pros" className="btn-secondary no-underline">
                Find professionals
              </Link>
              <Link to="/categories/home-repair-and-maintenance" className="btn-ghost no-underline">
                Browse hubs
              </Link>
            </div>
          }
        />
      ) : (
        <ul className="grid gap-3">
          {jobs.map((job) => (
            <li key={job.id} className="card overflow-hidden transition hover:shadow-lift">
              <Link
                to={`/client/jobs/${job.id}`}
                className="flex flex-wrap items-center justify-between gap-4 p-5 no-underline text-inherit"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <span className="text-2xl">{categoryEmoji(job.category)}</span>
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 truncate">{job.title}</p>
                    <p className="mt-0.5 text-sm text-slate-500">
                      {categoryLabel(job.category)}
                      {job.area ? ` · ${job.area}` : ""} · {fmtDate(job.createdAt)}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      Budget {money(job.budgetMin)} – {money(job.budgetMax)}
                    </p>
                  </div>
                </div>
                <Badge status={job.status} />
              </Link>
              {job.status === "completed" && (
                <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-2">
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => {
                      saveRepeatDraft(job);
                      success("Prefilling post-job wizard from this job");
                      navigate(clientPath("jobs/new"));
                    }}
                  >
                    Repeat this job
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={async () => {
                      const suggested =
                        (job.title || "Job").replace(/\s*\(repeat\)\s*$/i, "").trim() ||
                        "My job template";
                      const name =
                        window.prompt("Name this job template", suggested)?.trim() ||
                        suggested;
                      const entry = namedTemplateFromJob(job, name);
                      try {
                        await updateProfile({
                          namedJobTemplates: upsertNamedJobTemplate(
                            mergeNamedJobTemplates(user?.namedJobTemplates),
                            entry
                          ),
                        });
                        success(`Saved “${entry.name}” to your job templates`);
                      } catch (e) {
                        toastError((e as Error).message || "Couldn't save the template");
                      }
                    }}
                  >
                    Save as template
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}
