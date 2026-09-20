import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Shell } from "../../components/Shell";
import {
  getMatchQuality,
  getMatchWeights,
  updateMatchWeights,
  previewBestValueBlend,
  type MatchQualityRow,
  type MatchQualitySummary,
  type MatchTopPro,
  type MatchWeights,
  type MatchWeightPreset,
  type BestValueBlend,
  type BestValueBlendPreset,
  type BestValueBlendPreviewJob,
} from "../../api/admin";
import { Spinner } from "../../components/ui/Spinner";
import { EmptyState } from "../../components/ui/EmptyState";
import { fmtDate } from "../../lib/format";
import { useToast } from "../../components/Toast";
import clsx from "clsx";

const BAND: Record<string, string> = {
  none: "bg-rose-50 text-rose-800 ring-rose-200",
  thin: "bg-amber-50 text-amber-900 ring-amber-200",
  ok: "bg-sky-50 text-sky-900 ring-sky-200",
  strong: "bg-emerald-50 text-emerald-900 ring-emerald-200",
};

function ScoreBar({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score));
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-brand-600"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="font-mono text-xs font-semibold text-slate-700">
        {score.toFixed(0)}
      </span>
    </div>
  );
}

function TopProsList({ pros }: { pros: MatchTopPro[] }) {
  if (!pros?.length) return <span className="text-xs text-slate-400">—</span>;
  return (
    <ul className="space-y-1.5">
      {pros.slice(0, 3).map((p) => (
        <li key={p.userId} className="text-xs text-slate-600">
          <Link
            to={`/pros/${p.userId}`}
            className="font-medium text-slate-800 no-underline hover:text-brand-700"
          >
            {p.name || "Pro"}
          </Link>
          <span className="ml-1 font-mono text-brand-800">
            {(p.rankedScore ?? p.score).toFixed(0)}
          </span>
          {p.heatBoost != null && p.heatBoost > 0 ? (
            <span className="ml-1 rounded bg-amber-50 px-1 py-0.5 text-[10px] font-semibold text-amber-900 ring-1 ring-amber-200">
              +{p.heatBoost} heat
            </span>
          ) : null}
          <span className="ml-1 text-[10px] text-slate-400">
            sk{p.breakdown.skills.toFixed(0)}·rt{p.breakdown.rating.toFixed(0)}·rs
            {p.breakdown.response.toFixed(0)}·ds{p.breakdown.distance.toFixed(0)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function AdminMatchPage() {
  const { success, error } = useToast();
  const [summary, setSummary] = useState<MatchQualitySummary | null>(null);
  const [jobs, setJobs] = useState<MatchQualityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [weights, setWeights] = useState<MatchWeights>({
    skills: 35,
    rating: 25,
    response: 20,
    distance: 20,
  });
  const [defaults, setDefaults] = useState<MatchWeights | null>(null);
  const [presets, setPresets] = useState<MatchWeightPreset[]>([]);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [heatWeight, setHeatWeight] = useState(10);
  const [shortlistMinHeat, setShortlistMinHeat] = useState(25);
  const [defaultShortlistMinHeat, setDefaultShortlistMinHeat] = useState(25);
  const [defaultHeatWeight, setDefaultHeatWeight] = useState(10);
  const [bestValueBlend, setBestValueBlend] = useState<BestValueBlend>({
    matchPct: 55,
    pricePct: 45,
    slaHeatPct: 0,
  });
  const [defaultBestValueBlend, setDefaultBestValueBlend] = useState<BestValueBlend>({
    matchPct: 55,
    pricePct: 45,
    slaHeatPct: 0,
  });
  const [blendPresets, setBlendPresets] = useState<BestValueBlendPreset[]>([]);
  const [activeBlendPreset, setActiveBlendPreset] = useState<string | null>(null);
  const [blendPreviewJobs, setBlendPreviewJobs] = useState<BestValueBlendPreviewJob[]>([]);
  const [blendPreviewMsg, setBlendPreviewMsg] = useState<string>("");
  const [blendPreviewBusy, setBlendPreviewBusy] = useState(false);
  const [savingWeights, setSavingWeights] = useState(false);

  async function loadAll() {
    setLoading(true);
    try {
      const [mq, mw] = await Promise.all([getMatchQuality(), getMatchWeights()]);
      setSummary(mq.summary);
      setJobs(mq.jobs);
      setWeights(mw.weights);
      setDefaults(mw.defaults);
      setPresets(mw.presets || []);
      setActivePreset(mw.preset || null);
      if (mw.heatWeight != null) setHeatWeight(Number(mw.heatWeight));
      if (mw.defaultHeatWeight != null) setDefaultHeatWeight(Number(mw.defaultHeatWeight));
      if (mw.shortlistInviteMinHeat != null) setShortlistMinHeat(Number(mw.shortlistInviteMinHeat));
      if (mw.defaultShortlistInviteMinHeat != null) setDefaultShortlistMinHeat(Number(mw.defaultShortlistInviteMinHeat));
      if (mw.bestValueBlend) {
        setBestValueBlend({
          matchPct: Number(mw.bestValueBlend.matchPct),
          pricePct: Number(mw.bestValueBlend.pricePct),
          slaHeatPct: Number(mw.bestValueBlend.slaHeatPct ?? 0),
        });
      }
      if (mw.defaultBestValueBlend) {
        setDefaultBestValueBlend({
          matchPct: Number(mw.defaultBestValueBlend.matchPct),
          pricePct: Number(mw.defaultBestValueBlend.pricePct),
          slaHeatPct: Number(mw.defaultBestValueBlend.slaHeatPct ?? 0),
        });
      }
      if (mw.bestValueBlendPresets) setBlendPresets(mw.bestValueBlendPresets);
      setActiveBlendPreset(mw.bestValueBlendPreset || null);
      const blendForPreview = mw.bestValueBlend
        ? {
            matchPct: Number(mw.bestValueBlend.matchPct),
            pricePct: Number(mw.bestValueBlend.pricePct),
            slaHeatPct: Number(mw.bestValueBlend.slaHeatPct ?? 0),
          }
        : undefined;
      // Soft auto-preview against open jobs (non-blocking)
      void (async () => {
        try {
          const r = await previewBestValueBlend({
            ...(blendForPreview || {}),
            limit: 5,
          });
          setBlendPreviewJobs(r.jobs || []);
          setBlendPreviewMsg(r.message || "");
        } catch {
          /* ignore soft preview errors on load */
        }
      })();
    } catch (e) {
      error((e as Error).message || "Failed to load match data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once when the page opens
  }, []);

  async function runBlendPreview(blend?: BestValueBlend) {
    const b = blend || bestValueBlend;
    setBlendPreviewBusy(true);
    try {
      const r = await previewBestValueBlend({
        matchPct: Number(b.matchPct),
        pricePct: Number(b.pricePct),
        slaHeatPct: Number(b.slaHeatPct ?? 0),
        limit: 5,
      });
      setBlendPreviewJobs(r.jobs || []);
      setBlendPreviewMsg(r.message || "");
      if (r.bestValueBlendPreset !== undefined) {
        // draft detection only — don't override saved active unless same as saved
      }
    } catch (e) {
      setBlendPreviewJobs([]);
      setBlendPreviewMsg((e as Error).message || "Preview failed");
    } finally {
      setBlendPreviewBusy(false);
    }
  }

  async function saveWeights() {
    setSavingWeights(true);
    try {
      const r = await updateMatchWeights(weights, {
        heatWeight,
        shortlistInviteMinHeat: shortlistMinHeat,
        bestValueBlend,
      });
      if (r.shortlistInviteMinHeat != null) setShortlistMinHeat(Number(r.shortlistInviteMinHeat));
      setWeights(r.weights);
      setActivePreset(r.preset || null);
      if (r.presets) setPresets(r.presets);
      if (r.heatWeight != null) setHeatWeight(Number(r.heatWeight));
      if (r.bestValueBlend) setBestValueBlend(r.bestValueBlend);
      if (r.bestValueBlendPresets) setBlendPresets(r.bestValueBlendPresets);
      setActiveBlendPreset(r.bestValueBlendPreset || null);
      success(r.message || "Weights saved");
      const mq = await getMatchQuality();
      setSummary(mq.summary);
      setJobs(mq.jobs);
      await runBlendPreview(r.bestValueBlend || bestValueBlend);
    } catch (e) {
      error((e as Error).message || "Save failed");
    } finally {
      setSavingWeights(false);
    }
  }

  return (
    <Shell
      title="Match quality"
      subtitle="Scored verified pros vs open jobs — skills ∩ category · rating · response · distance · tunable heat · named best-value blend presets · live blend preview"
    >
      {loading || !summary ? (
        <Spinner />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="card p-4">
              <p className="text-xs uppercase tracking-wide text-slate-400">Open jobs</p>
              <p className="mt-1 text-2xl font-semibold">{summary.openJobs}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs uppercase tracking-wide text-slate-400">Verified pros</p>
              <p className="mt-1 text-2xl font-semibold">{summary.verifiedPros}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs uppercase tracking-wide text-slate-400">No nearby match</p>
              <p className="mt-1 text-2xl font-semibold text-rose-700">{summary.jobsWithNoNearby}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs uppercase tracking-wide text-slate-400">Avg best score</p>
              <p className="mt-1 text-2xl font-semibold text-brand-800">
                {summary.avgBestScore != null ? summary.avgBestScore.toFixed(0) : "—"}
              </p>
            </div>
            <div className="card p-4">
              <p className="text-xs uppercase tracking-wide text-slate-400">Radius</p>
              <p className="mt-1 text-2xl font-semibold">{summary.radiusKm} km</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="card p-4 text-center">
              <p className="text-xs text-slate-400">Thin (1–2)</p>
              <p className="text-xl font-semibold">{summary.jobsThin}</p>
            </div>
            <div className="card p-4 text-center">
              <p className="text-xs text-slate-400">OK (3–6)</p>
              <p className="text-xl font-semibold">{summary.jobsOk}</p>
            </div>
            <div className="card p-4 text-center">
              <p className="text-xs text-slate-400">Strong (7+)</p>
              <p className="text-xl font-semibold">{summary.jobsStrong}</p>
            </div>
          </div>

          <div className="card p-4 sm:p-5 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Match score weights</h2>
                <p className="text-xs text-slate-500">
                  Admin-tunable sk / rt / rs / ds (defaults 35 / 25 / 20 / 20). Persisted in app config.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {defaults && (
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    disabled={savingWeights}
                    onClick={() => setWeights({ ...defaults })}
                  >
                    Reset defaults
                  </button>
                )}
                <button
                  type="button"
                  className="btn-primary btn-sm"
                  disabled={savingWeights}
                  onClick={saveWeights}
                >
                  {savingWeights ? "Saving…" : "Save weights"}
                </button>
              </div>
            </div>
            {presets.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {presets.map((pr) => (
                  <button
                    key={pr.id}
                    type="button"
                    className={
                      activePreset === pr.id
                        ? "btn-primary btn-sm"
                        : "btn-secondary btn-sm"
                    }
                    disabled={savingWeights}
                    title={pr.description}
                    onClick={async () => {
                      setSavingWeights(true);
                      try {
                        const r = await updateMatchWeights({}, { preset: pr.id });
                        setWeights(r.weights);
                        setActivePreset(r.preset || pr.id);
                        if (r.presets) setPresets(r.presets);
                        if (r.heatWeight != null) setHeatWeight(Number(r.heatWeight));
                        success(r.message || `${pr.label} applied`);
                        const mq = await getMatchQuality();
                        setSummary(mq.summary);
                        setJobs(mq.jobs);
                      } catch (e) {
                        error((e as Error).message || "Preset failed");
                      } finally {
                        setSavingWeights(false);
                      }
                    }}
                  >
                    {pr.label}
                    {pr.heatWeight != null ? (
                      <span className="ml-1 opacity-80">· heat {pr.heatWeight}</span>
                    ) : null}
                  </button>
                ))}
                {activePreset && (
                  <span className="self-center text-xs text-slate-500">
                    Active: {activePreset}
                  </span>
                )}
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-4">
              {(
                [
                  ["skills", "Skills (sk)"],
                  ["rating", "Rating (rt)"],
                  ["response", "Response (rs)"],
                  ["distance", "Distance (ds)"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="block">
                  <span className="label">{label}</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    className="input"
                    value={weights[key]}
                    onChange={(e) =>
                      setWeights((w) => ({
                        ...w,
                        [key]: Number(e.target.value),
                      }))
                    }
                  />
                </label>
              ))}
            </div>
            <p className="text-xs text-slate-500">
              Current sum {weights.skills + weights.rating + weights.response + weights.distance}
              {" "}(typical max ≈ 100). Breakdown tags: sk / rt / rs / ds.
            </p>
            <div className="rounded-xl bg-amber-50/80 p-3 ring-1 ring-amber-100">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <label className="block min-w-[12rem] flex-1">
                  <span className="label">Availability heat weight (boost)</span>
                  <input
                    type="number"
                    min={0}
                    max={20}
                    step={1}
                    className="input"
                    value={heatWeight}
                    onChange={(e) => setHeatWeight(Number(e.target.value))}
                  />
                </label>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  disabled={savingWeights}
                  onClick={() => setHeatWeight(defaultHeatWeight)}
                >
                  Reset heat ({defaultHeatWeight})
                </button>
              </div>
              <p className="mt-2 text-[11px] text-amber-900/80">
                Clean weekly schedules get up to +{heatWeight} on suggested-pros / match-quality{" "}
                <span className="font-mono">rankedScore</span> (proportional to heat 0–100).
                Unclean schedules get 0. Presets include heat (balanced 10 · speed 15 · quality 8 · availability 20).
              </p>
              <div className="mt-3 flex flex-wrap items-end justify-between gap-3 border-t border-amber-100 pt-3">
                <label className="block min-w-[12rem] flex-1" htmlFor="shortlist-min-heat">
                  <span className="label">Shortlist invite availability gate (0–100)</span>
                  <input
                    id="shortlist-min-heat"
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    className="input"
                    value={shortlistMinHeat}
                    onChange={(e) => setShortlistMinHeat(Number(e.target.value))}
                  />
                </label>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  disabled={savingWeights}
                  onClick={() => setShortlistMinHeat(defaultShortlistMinHeat)}
                >
                  Reset gate ({defaultShortlistMinHeat})
                </button>
              </div>
              <p className="mt-2 text-[11px] text-amber-900/80">
                Clients can't invite a shortlisted pro whose published schedule has less availability heat than this.
                Pros without a schedule are never blocked. Saved with the weights; changes are audited and can be rolled back.
              </p>
            </div>

            <div className="rounded-xl bg-sky-50/80 p-3 ring-1 ring-sky-100">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Best-value blend</h3>
                  <p className="text-[11px] text-slate-500">
                    Client bid compare: match/ranked % · lower escrow hold % · optional SLA/heat %.
                    Renormalized to 100 on save. Changes are audited with rollback on Audit.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  disabled={savingWeights}
                  onClick={() => {
                    setBestValueBlend({
                      matchPct: Number(defaultBestValueBlend.matchPct),
                      pricePct: Number(defaultBestValueBlend.pricePct),
                      slaHeatPct: Number(defaultBestValueBlend.slaHeatPct ?? 0),
                    });
                    setActiveBlendPreset(null);
                  }}
                >
                  Reset blend ({defaultBestValueBlend.matchPct}/{defaultBestValueBlend.pricePct}
                  {(defaultBestValueBlend.slaHeatPct ?? 0) > 0
                    ? `/${defaultBestValueBlend.slaHeatPct}`
                    : ""}
                  )
                </button>
              </div>
              {blendPresets.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {blendPresets.map((pr) => (
                    <button
                      key={pr.id}
                      type="button"
                      className={
                        activeBlendPreset === pr.id ? "btn-primary btn-sm" : "btn-secondary btn-sm"
                      }
                      disabled={savingWeights}
                      title={pr.description}
                      onClick={async () => {
                        setSavingWeights(true);
                        try {
                          const r = await updateMatchWeights({}, { bestValueBlendPreset: pr.id });
                          if (r.bestValueBlend) {
                            setBestValueBlend({
                              matchPct: Number(r.bestValueBlend.matchPct),
                              pricePct: Number(r.bestValueBlend.pricePct),
                              slaHeatPct: Number(r.bestValueBlend.slaHeatPct ?? 0),
                            });
                          }
                          if (r.bestValueBlendPresets) setBlendPresets(r.bestValueBlendPresets);
                          setActiveBlendPreset(r.bestValueBlendPreset || pr.id);
                          success(r.message || `${pr.label} applied`);
                          await runBlendPreview(r.bestValueBlend);
                        } catch (e) {
                          error((e as Error).message || "Blend preset failed");
                        } finally {
                          setSavingWeights(false);
                        }
                      }}
                    >
                      {pr.label}
                      <span className="ml-1 opacity-80">
                        {pr.blend.matchPct}/{pr.blend.pricePct}
                        {(pr.blend.slaHeatPct ?? 0) > 0 ? `/${pr.blend.slaHeatPct}` : ""}
                      </span>
                    </button>
                  ))}
                  {activeBlendPreset && (
                    <span className="self-center text-xs text-slate-500">
                      Active blend: {activeBlendPreset}
                    </span>
                  )}
                </div>
              )}
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <label className="block">
                  <span className="label">Match %</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    className="input"
                    value={bestValueBlend.matchPct}
                    onChange={(e) => {
                      setActiveBlendPreset(null);
                      setBestValueBlend((b) => ({
                        ...b,
                        matchPct: Number(e.target.value),
                      }));
                    }}
                  />
                </label>
                <label className="block">
                  <span className="label">Price (lower hold) %</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    className="input"
                    value={bestValueBlend.pricePct}
                    onChange={(e) => {
                      setActiveBlendPreset(null);
                      setBestValueBlend((b) => ({
                        ...b,
                        pricePct: Number(e.target.value),
                      }));
                    }}
                  />
                </label>
                <label className="block">
                  <span className="label">SLA / heat % (optional)</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    className="input"
                    value={bestValueBlend.slaHeatPct ?? 0}
                    onChange={(e) => {
                      setActiveBlendPreset(null);
                      setBestValueBlend((b) => ({
                        ...b,
                        slaHeatPct: Number(e.target.value),
                      }));
                    }}
                  />
                </label>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className={
                    Number(bestValueBlend.slaHeatPct ?? 0) > 0
                      ? "btn-secondary btn-sm"
                      : "btn-ghost btn-sm"
                  }
                  disabled={savingWeights}
                  title="Toggle a soft 15% SLA/heat third weight (renormalizes on save)"
                  onClick={() =>
                    setBestValueBlend((b) => {
                      const on = Number(b.slaHeatPct ?? 0) > 0;
                      if (on) {
                        setActiveBlendPreset(null);
                        return { ...b, slaHeatPct: 0 };
                      }
                      // Soft default third weight = Balanced + SLA preset
                      setActiveBlendPreset("balanced_sla");
                      return { matchPct: 50, pricePct: 35, slaHeatPct: 15 };
                    })
                  }
                >
                  {Number(bestValueBlend.slaHeatPct ?? 0) > 0
                    ? "Disable SLA/heat weight"
                    : "Enable SLA/heat (~15%)"}
                </button>
                <p className="text-[11px] text-sky-900/80">
                  Current mix {bestValueBlend.matchPct}% match · {bestValueBlend.pricePct}% price
                  {Number(bestValueBlend.slaHeatPct ?? 0) > 0
                    ? ` · ${bestValueBlend.slaHeatPct}% SLA/heat`
                    : " · SLA/heat off"}{" "}
                  (sum{" "}
                  {Math.round(
                    (bestValueBlend.matchPct +
                      bestValueBlend.pricePct +
                      Number(bestValueBlend.slaHeatPct ?? 0)) *
                      10
                  ) / 10}
                  ). Draft sliders preview without saving.
                </p>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={blendPreviewBusy || savingWeights}
                  onClick={() => runBlendPreview()}
                >
                  {blendPreviewBusy ? "Previewing…" : "Live blend preview"}
                </button>
              </div>

              <div className="mt-3 rounded-lg bg-white/70 p-3 ring-1 ring-sky-100/80">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Live blend preview
                  </h4>
                  <span className="text-[11px] text-slate-500">
                    Sample of open jobs · top ranked bids (draft or saved mix)
                  </span>
                </div>
                {blendPreviewBusy && !blendPreviewJobs.length ? (
                  <p className="mt-2 text-xs text-slate-400">Loading sample…</p>
                ) : blendPreviewJobs.length === 0 ? (
                  <p className="mt-2 text-xs text-slate-400">
                    {blendPreviewMsg || "No open jobs with ≥2 active bids yet — post competing bids to preview."}
                  </p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {blendPreviewJobs.map((j) => (
                      <li
                        key={j.jobId}
                        className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-100"
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <p className="text-sm font-medium text-slate-900">
                            {j.title}
                            <span className="ml-2 text-[11px] font-normal text-slate-400">
                              {[j.category, j.city].filter(Boolean).join(" · ")} · {j.bidCount} bids
                            </span>
                          </p>
                        </div>
                        <ul className="mt-1.5 flex flex-wrap gap-2">
                          {j.topBids.map((b) => (
                            <li
                              key={b.bidId}
                              className={
                                b.isBest
                                  ? "rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-900 ring-1 ring-emerald-200"
                                  : "rounded-md bg-white px-2 py-1 text-[11px] text-slate-600 ring-1 ring-slate-200"
                              }
                            >
                              {b.name}
                              <span className="ml-1 font-mono">
                                {b.valueScore.toFixed(1)}
                              </span>
                              <span className="ml-1 text-slate-400">
                                mt{b.matchScore.toFixed(0)} · ₹{Math.round(b.hold)}
                              </span>
                              {b.isBest ? <span className="ml-1">best</span> : null}
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

          {jobs.length === 0 ? (
            <EmptyState title="No open jobs" description="Nothing to score right now." />
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Job</th>
                    <th className="px-4 py-3">Location</th>
                    <th className="px-4 py-3">Nearby</th>
                    <th className="px-4 py-3">Best score</th>
                    <th className="px-4 py-3">Top pros</th>
                    <th className="px-4 py-3">Band</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr key={j.jobId} className="border-t border-slate-100 align-top">
                      <td className="px-4 py-3">
                        <Link
                          to={`/admin/jobs`}
                          className="font-medium text-slate-900 no-underline hover:text-brand-700"
                        >
                          {j.title}
                        </Link>
                        <p className="text-xs text-slate-400">
                          {j.category} · {fmtDate(j.createdAt)}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {[j.area, j.city].filter(Boolean).join(", ") || "—"}
                        {j.lat != null && j.lng != null && (
                          <span className="block text-[11px] text-slate-400">
                            {Number(j.lat).toFixed(3)}, {Number(j.lng).toFixed(3)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-semibold">{j.nearbyVerifiedPros}</td>
                      <td className="px-4 py-3">
                        <ScoreBar score={j.bestMatchScore ?? 0} />
                      </td>
                      <td className="px-4 py-3">
                        <TopProsList pros={j.topPros || []} />
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={clsx(
                            "inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1",
                            BAND[j.matchBand] || BAND.ok
                          )}
                        >
                          {j.matchBand}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Shell>
  );
}
