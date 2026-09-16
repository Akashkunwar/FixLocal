import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Shell } from "../../components/Shell";
import { listJobs, getProfile, type Job } from "../../api/jobs";
import { Badge } from "../../components/ui/Badge";
import { Spinner } from "../../components/ui/Spinner";
import { EmptyState } from "../../components/ui/EmptyState";
import { categoryEmoji, categoryGroups, categoryLabel, fmtDate, money } from "../../lib/format";
import { SITE_TYPES, siteTypeLabel, type SiteType } from "../../lib/paths";
import { useToast } from "../../components/Toast";
import { Bookmark, MapPin, Search } from "lucide-react";
import clsx from "clsx";
import { OnboardingChecklist } from "../../components/OnboardingChecklist";
import { proPath } from "../../lib/paths";

const SAVED_KEY = "fixlocal:savedJobSearch";

type Facets = {
  q: string;
  category: string;
  city: string;
  neighborhood: string;
  budgetMin: string;
  budgetMax: string;
  sort: string;
  siteType: "" | SiteType;
};

const defaults: Facets = {
  q: "",
  category: "",
  city: "",
  neighborhood: "",
  budgetMin: "",
  budgetMax: "",
  sort: "newest",
  siteType: "",
};

type Near = { lat: number; lng: number } | null;

export function BrowseJobsPage() {
  const [params] = useSearchParams();
  const { success } = useToast();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [facets, setFacets] = useState<Facets>(defaults);
  const [savedLabel, setSavedLabel] = useState<string | null>(null);
  const [near, setNear] = useState<Near>(null);
  const [portfolioReady, setPortfolioReady] = useState(false);
  const [availabilitySet, setAvailabilitySet] = useState(false);

  async function load(f: Facets = facets, origin: Near = near) {
    setLoading(true);
    try {
      const r = await listJobs({
        q: f.q || undefined,
        category: f.category || undefined,
        city: f.city || undefined,
        neighborhood: f.neighborhood || undefined,
        budgetMin: f.budgetMin || undefined,
        budgetMax: f.budgetMax || undefined,
        sort: f.sort,
        siteType: f.siteType || undefined,
        nearLat: origin?.lat != null ? String(origin.lat) : undefined,
        nearLng: origin?.lng != null ? String(origin.lng) : undefined,
      });
      setJobs(r.jobs);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let origin: Near = null;
      try {
        const pr = await getProfile();
        if (
          pr.profile.lat != null &&
          pr.profile.lng != null &&
          Number.isFinite(Number(pr.profile.lat)) &&
          Number.isFinite(Number(pr.profile.lng))
        ) {
          origin = { lat: Number(pr.profile.lat), lng: Number(pr.profile.lng) };
          if (!cancelled) setNear(origin);
        }
        if (!cancelled) {
          const p = pr.profile;
          setPortfolioReady(
            Boolean(
              ((p.bio && String(p.bio).trim()) ||
                (p.skills && String(p.skills).trim())) &&
                (p.hourlyRateMin != null || p.serviceAreas)
            )
          );
          const week = p.weeklyAvailability;
          setAvailabilitySet(
            Boolean(
              week &&
                Object.values(week).some(
                  (d: any) => d && d.enabled
                )
            )
          );
        }
      } catch {
        /* ignore */
      }
      const urlCategory = (params.get("category") || "").trim();
      const urlSite = (params.get("siteType") || "").trim();
      const siteFromUrl: "" | SiteType =
        urlSite === "residential" || urlSite === "office" ? urlSite : "";
      try {
        const raw = localStorage.getItem(SAVED_KEY);
        if (raw && !urlCategory && !siteFromUrl) {
          const parsed = JSON.parse(raw) as Facets & { label?: string };
          const next: Facets = {
            ...defaults,
            ...parsed,
            city: (parsed as any).city || "",
            neighborhood: (parsed as any).neighborhood || (parsed as any).area || "",
            siteType:
              parsed.siteType === "residential" || parsed.siteType === "office"
                ? parsed.siteType
                : "",
          };
          if (!cancelled) {
            setFacets(next);
            setSavedLabel(parsed.label || "Saved search");
          }
          await load(next, origin);
          return;
        }
      } catch {
        /* ignore */
      }
      if (urlCategory || siteFromUrl) {
        const next = {
          ...defaults,
          category: urlCategory,
          siteType: siteFromUrl,
        };
        if (!cancelled) setFacets(next);
        await load(next, origin);
        return;
      }
      await load(defaults, origin);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function saveSearch() {
    const label =
      [facets.category, facets.city, facets.neighborhood, facets.budgetMin && `≥${facets.budgetMin}`]
        .filter(Boolean)
        .join(" · ") || "My job search";
    localStorage.setItem(SAVED_KEY, JSON.stringify({ ...facets, label }));
    setSavedLabel(label);
    success("Search saved on this device");
  }

  return (
    <Shell title="Open jobs" subtitle="Bid on verified-eligible repair requests near you">
      <OnboardingChecklist
        variant="pro"
        title="Professional getting started"
        subtitle="A short checklist — dismiss anytime"
        items={[
          {
            id: "portfolio",
            label: "Complete your portfolio (bio, skills, rates)",
            done: portfolioReady,
            to: proPath("profile"),
          },
          {
            id: "availability",
            label: "Set weekly availability",
            done: availabilitySet,
            to: proPath("profile"),
          },
          {
            id: "browse",
            label: "Browse open jobs",
            done: true,
          },
          {
            id: "bid",
            label: "Place your first bid",
            done: localStorage.getItem("fixlocal:onboarding:pro:bid") === "1",
            to: proPath(),
          },
        ]}
      />
      <div className="mb-5 space-y-3">
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-9"
              placeholder="Search…"
              value={facets.q}
              onChange={(e) => setFacets({ ...facets, q: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && load()}
            />
          </div>
          <select
            className="input w-auto"
            value={facets.category}
            onChange={(e) => setFacets({ ...facets, category: e.target.value })}
          >
            <option value="">All categories</option>
            {categoryGroups().map(([group, cats]) => (
              <optgroup key={group} label={group}>
                {cats.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.emoji} {c.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <input
            className="input w-auto min-w-[110px]"
            placeholder="City"
            value={facets.city}
            onChange={(e) => setFacets({ ...facets, city: e.target.value })}
          />
          <input
            className="input w-auto min-w-[120px]"
            placeholder="Neighborhood"
            value={facets.neighborhood}
            onChange={(e) => setFacets({ ...facets, neighborhood: e.target.value })}
          />
          <input
            className="input w-28"
            type="number"
            min={0}
            placeholder="Min ₹"
            value={facets.budgetMin}
            onChange={(e) => setFacets({ ...facets, budgetMin: e.target.value })}
          />
          <input
            className="input w-28"
            type="number"
            min={0}
            placeholder="Max ₹"
            value={facets.budgetMax}
            onChange={(e) => setFacets({ ...facets, budgetMax: e.target.value })}
          />
          <select
            className="input w-auto"
            value={facets.sort}
            onChange={(e) => setFacets({ ...facets, sort: e.target.value })}
          >
            <option value="newest">Newest</option>
            <option value="distance">Nearest (km)</option>
            <option value="budget_desc">Budget high</option>
            <option value="budget_asc">Budget low</option>
          </select>
          <button type="button" className="btn-secondary" onClick={() => load()}>
            Apply
          </button>
        </div>
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label="Site type filter"
        >
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400" id="site-type-label">
            Site
          </span>
          <button
            type="button"
            className={clsx(
              "rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition",
              !facets.siteType
                ? "bg-brand-700 text-white ring-brand-700"
                : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"
            )}
            aria-pressed={!facets.siteType}
            onClick={() => {
              const next = { ...facets, siteType: "" as const };
              setFacets(next);
              load(next);
            }}
          >
            Any
          </button>
          {SITE_TYPES.map((s) => (
            <button
              key={s.value}
              type="button"
              className={clsx(
                "rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition",
                facets.siteType === s.value
                  ? "bg-brand-700 text-white ring-brand-700"
                  : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"
              )}
              title={s.hint}
              aria-pressed={facets.siteType === s.value}
              onClick={() => {
                const next = { ...facets, siteType: s.value };
                setFacets(next);
                load(next);
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button type="button" className="btn-secondary btn-sm" onClick={saveSearch}>
            <Bookmark className="h-3.5 w-3.5" /> Save search
          </button>
          {savedLabel && <span className="text-slate-500">Saved: {savedLabel}</span>}
        </div>
      </div>
      {loading ? (
        <Spinner />
      ) : jobs.length === 0 ? (
        <EmptyState
          title="No open jobs"
          description="Playbook: clear filters → widen category/site → complete portfolio + availability → place a competitive bid with a visit window. Clients post throughout the day."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Link to="/professional/profile" className="btn-secondary no-underline">
                Update portfolio
              </Link>
              <Link to="/categories/cleaning" className="btn-ghost no-underline">
                Category hubs
              </Link>
            </div>
          }
        />
      ) : (
        <ul className="grid gap-3">
          {jobs.map((job) => (
            <li key={job.id}>
              <Link
                to={`/professional/jobs/${job.id}`}
                className="card flex flex-wrap items-center justify-between gap-4 p-5 no-underline text-inherit hover:shadow-lift transition"
              >
                <div className="flex gap-3 min-w-0">
                  <span className="text-2xl">{categoryEmoji(job.category)}</span>
                  <div>
                    <p className="font-semibold text-slate-900">{job.title}</p>
                    <p className="text-sm text-slate-500">
                      {categoryLabel(job.category)}
                      {siteTypeLabel(job.siteType) ? ` · ${siteTypeLabel(job.siteType)}` : ""}
                      {job.city ? ` · ${job.city}` : ""}
                      {job.area ? ` · ${job.area}` : ""} · {fmtDate(job.createdAt)}
                    </p>
                    <p className="mt-1 text-sm text-slate-700">
                      Budget {money(job.budgetMin)} – {money(job.budgetMax)}
                    </p>
                  </div>
                </div>
                <Badge status={job.status} />
                  {job.distanceKm != null && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                      <MapPin className="h-3 w-3" /> ~{job.distanceKm} km
                    </span>
                  )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}
