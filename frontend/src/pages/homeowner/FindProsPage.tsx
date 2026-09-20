import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Shell } from "../../components/Shell";
import { browsePros, type TradespersonProfile } from "../../api/jobs";
import { heatLevelClass } from "../../lib/availability";
import { addFavorite } from "../../api/extras";
import { Spinner } from "../../components/ui/Spinner";
import { EmptyState } from "../../components/ui/EmptyState";
import { StarRating } from "../../components/ui/StarRating";
import { Badge } from "../../components/ui/Badge";
import { categoryGroups, initials, money } from "../../lib/format";
import { SITE_TYPES, type SiteType } from "../../lib/paths";
import { useToast } from "../../components/Toast";
import { Heart, Search, Bookmark, MapPin } from "lucide-react";
import { ResponseSlaBadge } from "../../components/ui/ResponseSlaBadge";
import clsx from "clsx";

const SAVED_KEY = "fixlocal:savedProSearch";


type Facets = {
  q: string;
  city: string;
  neighborhood: string;
  category: string;
  ratingMin: string;
  rateMax: string;
  sort: string;
  slaTier: string;
  maxResponseHours: string;
  availableThisWeek: string;
  minHeat: string;
  siteType: "" | SiteType;
};

const empty: Facets = {
  q: "",
  city: "",
  neighborhood: "",
  category: "",
  ratingMin: "",
  rateMax: "",
  sort: "rating",
  slaTier: "",
  maxResponseHours: "",
  availableThisWeek: "",
  minHeat: "",
  siteType: "",
};

/** Demo default — Bengaluru CBD — used when ranking by distance for homeowners. */
const DEMO_NEAR = { lat: 12.9716, lng: 77.5946 };

export function FindProsPage() {
  const [params] = useSearchParams();
  const { success, error } = useToast();
  const [pros, setPros] = useState<TradespersonProfile[]>([]);
  const [facets, setFacets] = useState<Facets>(empty);
  const [loading, setLoading] = useState(true);
  const [savedLabel, setSavedLabel] = useState<string | null>(null);

  async function load(f: Facets = facets) {
    setLoading(true);
    try {
      const useNear = f.sort === "distance" || true; // always attach coords for km labels when available
      const r = await browsePros({
        q: f.q || undefined,
        city: f.city || undefined,
        neighborhood: f.neighborhood || undefined,
        category: f.category || undefined,
        ratingMin: f.ratingMin || undefined,
        rateMax: f.rateMax || undefined,
        sort:
          f.sort === "distance" ? "distance" : f.sort === "heat" ? "heat" : undefined,
        nearLat: useNear ? String(DEMO_NEAR.lat) : undefined,
        nearLng: useNear ? String(DEMO_NEAR.lng) : undefined,
        slaTier: f.slaTier || undefined,
        maxResponseHours: f.maxResponseHours || undefined,
        availableThisWeek: f.availableThisWeek || undefined,
        minHeat: f.minHeat || undefined,
        siteType: f.siteType || undefined,
      });
      setPros(r.pros);
    } catch (e) {
      error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // Re-run when the URL filters change (e.g. following a category link while already on this page).
  const urlCategory = (params.get("category") || "").trim();
  const urlSite = (params.get("siteType") || "").trim();
  useEffect(() => {
    try {
      localStorage.setItem("fixlocal:onboarding:client:visitedPros", "1");
    } catch {
      /* ignore */
    }
    const siteFromUrl: "" | SiteType =
      urlSite === "residential" || urlSite === "office" ? urlSite : "";
    try {
      const raw = localStorage.getItem(SAVED_KEY);
      if (raw && !urlCategory && !siteFromUrl) {
        // Older saved searches may lack newer fields, or use "area" for neighborhood.
        const parsed = JSON.parse(raw) as Partial<Facets> & { label?: string; area?: string };
        const next: Facets = {
          q: parsed.q || "",
          city: parsed.city || "",
          neighborhood: parsed.neighborhood || parsed.area || "",
          category: parsed.category || "",
          ratingMin: parsed.ratingMin || "",
          rateMax: parsed.rateMax || "",
          sort: parsed.sort || "rating",
          slaTier: parsed.slaTier || "",
          maxResponseHours: parsed.maxResponseHours || "",
          availableThisWeek: parsed.availableThisWeek || "",
          minHeat: parsed.minHeat || "",
          siteType:
            parsed.siteType === "residential" || parsed.siteType === "office"
              ? parsed.siteType
              : "",
        };
        setFacets(next);
        setSavedLabel(parsed.label || "Saved search");
        load(next);
        return;
      }
    } catch {
      /* ignore */
    }
    const next = { ...empty, category: urlCategory, siteType: siteFromUrl };
    setFacets(next);
    load(next);
    // `load` is recreated every render; it reads the facets passed in, not stale state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlCategory, urlSite]);

  function saveSearch() {
    const label = [facets.category, facets.city, facets.neighborhood, facets.ratingMin && `${facets.ratingMin}+★`]
      .filter(Boolean)
      .join(" · ") || "My pro search";
    localStorage.setItem(SAVED_KEY, JSON.stringify({ ...facets, label }));
    setSavedLabel(label);
    success("Search saved on this device");
  }

  function clearSaved() {
    localStorage.removeItem(SAVED_KEY);
    setSavedLabel(null);
    setFacets(empty);
    load(empty);
    success("Cleared saved search");
  }

  async function save(userId: string) {
    try {
      await addFavorite("pro", userId);
      try {
        localStorage.setItem("fixlocal:onboarding:client:savedPro", "1");
      } catch {
        /* ignore */
      }
      success("Pro saved");
    } catch (e) {
      error((e as Error).message);
    }
  }

  return (
    <Shell title="Find professionals" subtitle="Browse verified professionals by skill, city, and rating">
      <div className="mb-5 space-y-3">
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-9"
              placeholder="Search skills, city, name…"
              aria-label="Search professionals"
              value={facets.q}
              onChange={(e) => setFacets({ ...facets, q: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && load()}
            />
          </div>
          <input
            className="input w-auto min-w-[120px]"
            placeholder="City"
            aria-label="City"
            value={facets.city}
            onChange={(e) => setFacets({ ...facets, city: e.target.value })}
          />
          <input
            className="input w-auto min-w-[130px]"
            placeholder="Neighborhood"
            aria-label="Neighborhood"
            value={facets.neighborhood}
            onChange={(e) => setFacets({ ...facets, neighborhood: e.target.value })}
          />
          <select
            className="input w-auto"
            aria-label="Category"
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
          <select
            className="input w-auto"
            aria-label="Minimum rating"
            value={facets.ratingMin}
            onChange={(e) => setFacets({ ...facets, ratingMin: e.target.value })}
          >
            <option value="">Any rating</option>
            <option value="3">3+ stars</option>
            <option value="4">4+ stars</option>
            <option value="4.5">4.5+ stars</option>
          </select>
          <input
            className="input w-36"
            type="number"
            min={0}
            placeholder="Max ₹/hr"
            aria-label="Maximum hourly rate"
            value={facets.rateMax}
            onChange={(e) => setFacets({ ...facets, rateMax: e.target.value })}
          />
          <select
            className="input w-auto"
            aria-label="Sort by"
            value={facets.sort}
            onChange={(e) => setFacets({ ...facets, sort: e.target.value })}
          >
            <option value="rating">Best rated</option>
            <option value="distance">Nearest (km)</option>
            <option value="heat">Highest availability heat</option>
          </select>
          <select
            className="input w-auto"
            value={facets.slaTier}
            onChange={(e) => setFacets({ ...facets, slaTier: e.target.value })}
            title="Response SLA tier"
            aria-label="Reply speed"
          >
            <option value="">Any reply SLA</option>
            <option value="fast_or_better">Fast or better (≤6h)</option>
            <option value="same_day_or_better">Same-day or better</option>
            <option value="lightning">Lightning only</option>
            <option value="fast">Fast</option>
            <option value="same_day">Same-day</option>
            <option value="steady">Steady</option>
          </select>
          <input
            className="input w-40"
            type="number"
            min={1}
            placeholder="Max reply hrs"
            value={facets.maxResponseHours}
            onChange={(e) => setFacets({ ...facets, maxResponseHours: e.target.value })}
            title="Max average response hours"
            aria-label="Maximum average reply hours"
          />
          <label
            className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-2 text-sm text-slate-700 ring-1 ring-slate-200"
            title="Pros with weekly availability on at least one unblocked day in the next 7 days"
          >
            <input
              type="checkbox"
              checked={facets.availableThisWeek === "1"}
              onChange={(e) =>
                setFacets({
                  ...facets,
                  availableThisWeek: e.target.checked ? "1" : "",
                })
              }
            />
            Available this week
          </label>
          <select
            className="input w-auto"
            value={facets.minHeat}
            onChange={(e) => setFacets({ ...facets, minHeat: e.target.value })}
            title="Minimum availability heat score (free hours vs 40h week)"
            aria-label="Minimum availability heat"
          >
            <option value="">Any availability heat</option>
            <option value="25">Heat 25+</option>
            <option value="40">Heat 40+</option>
            <option value="50">Heat 50+</option>
            <option value="60">Heat 60+</option>
            <option value="75">Heat 75+</option>
          </select>
          <button type="button" className="btn-primary" onClick={() => load()}>
            Search
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
          {savedLabel && (
            <>
              <span className="text-slate-500">Saved: {savedLabel}</span>
              <button type="button" className="btn-ghost btn-sm" onClick={clearSaved}>
                Clear
              </button>
            </>
          )}
        </div>
      </div>
      {loading ? (
        <Spinner />
      ) : pros.length === 0 ? (
        <EmptyState
          title="No pros found"
          description="Playbook: ease heat/SLA filters → try a lead-group hub specialty → save searches → invite from shortlist once you find a match."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Link to="/categories/home-repair-and-maintenance" className="btn-secondary no-underline">
                Open a category hub
              </Link>
              <Link to="/client/jobs/new" className="btn-ghost no-underline">
                Post a job instead
              </Link>
            </div>
          }
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {pros.map((p) => (
            <li key={p.userId} className="card p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-800">
                  {initials(p.name, p.email)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <Link
                        to={`/pros/${p.userId}`}
                        className="font-semibold text-slate-900 no-underline hover:text-brand-700"
                      >
                        {p.name || p.email}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <StarRating value={Math.round(Number(p.averageRating))} readonly size={14} />
                        <span className="text-xs text-slate-500">({p.reviewCount})</span>
                        <Badge status={p.verificationStatus} />
                        {p.responseSla && <ResponseSlaBadge sla={p.responseSla} compact />}
                        {p.availableThisWeek && (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-800 ring-1 ring-emerald-200">
                            Available this week
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      onClick={() => save(p.userId)}
                      aria-label="Save pro"
                    >
                      <Heart className="h-4 w-4" />
                    </button>
                  </div>
                  <p className="mt-2 text-sm text-slate-600 line-clamp-2">{p.bio || p.skills}</p>
                  <p className="mt-2 text-xs text-slate-500">
                    {p.city || "—"}
                    {p.serviceAreas ? ` · ${String(p.serviceAreas).split(",")[0].trim()}` : ""}
                    {p.hourlyRateMin != null && ` · ${money(p.hourlyRateMin)}–${money(p.hourlyRateMax)}/hr`}
                    {p.yearsExperience != null && ` · ${p.yearsExperience} yrs`}
                    {p.distanceKm != null && (
                      <span className="ml-1 inline-flex items-center gap-0.5 text-slate-600">
                        · <MapPin className="inline h-3 w-3" /> ~{p.distanceKm} km
                      </span>
                    )}
                  </p>
                  {!p.availabilityHeat?.clean && (
                    <p className="mt-3 text-[11px] text-slate-500">
                      Weekly schedule not published — availability unknown.
                    </p>
                  )}
                  {p.availabilityHeat?.clean && (
                    <div className="mt-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                          Next 7 days
                        </p>
                        <p className="text-[10px] text-slate-500">
                          {p.availabilityHeat.totalHours}h · heat {p.availabilityHeat.score}
                        </p>
                      </div>
                      <div
                        className="mt-1 flex gap-0.5"
                        title="Availability heat (darker = more free hours)"
                        aria-label="Availability heat for next 7 days"
                      >
                        {p.availabilityHeat.days.map((d) => (
                          <div
                            key={d.date}
                            className={`flex h-7 w-7 flex-col items-center justify-center rounded text-[9px] font-semibold ${heatLevelClass(
                              d.level,
                              d.blocked
                            )}`}
                            title={
                              d.blocked
                                ? `${d.date} blocked`
                                : `${d.date}: ${d.hours}h`
                            }
                          >
                            <span>{d.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {p.bestInviteHint && (
                    <p className="mt-2 rounded-lg bg-sky-50 px-2 py-1.5 text-[11px] text-sky-900 ring-1 ring-sky-100">
                      {p.bestInviteHint.reason}
                    </p>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}
