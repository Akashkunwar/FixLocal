import clsx from "clsx";
import { X } from "lucide-react";

export type MatchBreakdown = {
  skills: number;
  rating: number;
  response: number;
  distance: number;
  total: number;
  skillHits: string[];
  distanceKm: number | null;
  avgResponseHours: number | null;
  weights?: { skills: number; rating: number; response: number; distance: number };
};

const DEFAULT_MAX = { skills: 35, rating: 25, response: 20, distance: 20 };

function partsFor(max: typeof DEFAULT_MAX) {
  return [
    {
      key: "skills" as const,
      code: "sk",
      label: "Skills ∩ category",
      max: max.skills,
      hint: (b: MatchBreakdown) =>
        b.skillHits?.length
          ? `Hits: ${b.skillHits.join(", ")}`
          : "No strong skill overlap with this category",
    },
    {
      key: "rating" as const,
      code: "rt",
      label: "Rating",
      max: max.rating,
      hint: () => "From average rating + review confidence",
    },
    {
      key: "response" as const,
      code: "rs",
      label: "Response time",
      max: max.response,
      hint: (b: MatchBreakdown) =>
        b.avgResponseHours != null
          ? `~${b.avgResponseHours}h avg job→bid`
          : "Unknown history → mid score",
    },
    {
      key: "distance" as const,
      code: "ds",
      label: "Distance",
      max: max.distance,
      hint: (b: MatchBreakdown) =>
        b.distanceKm != null
          ? `~${b.distanceKm} km away`
          : "City / service-area soft match (no coords)",
    },
  ];
}

function Bar({ value, max }: { value: number; max: number }) {
  const pct = Math.max(0, Math.min(100, max > 0 ? (value / max) * 100 : 0));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div
        className="h-full rounded-full bg-brand-600 transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

type Props = {
  open: boolean;
  onClose: () => void;
  name?: string | null;
  score: number;
  breakdown: MatchBreakdown;
};

/** Side drawer explaining sk/rt/rs/ds match score parts. */
export function MatchScorePanel({ open, onClose, name, score, breakdown }: Props) {
  if (!open) return null;
  const max = {
    skills: breakdown.weights?.skills ?? DEFAULT_MAX.skills,
    rating: breakdown.weights?.rating ?? DEFAULT_MAX.rating,
    response: breakdown.weights?.response ?? DEFAULT_MAX.response,
    distance: breakdown.weights?.distance ?? DEFAULT_MAX.distance,
  };
  const PARTS = partsFor(max);
  const maxTotal = max.skills + max.rating + max.response + max.distance;
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40"
        aria-label="Close match score"
        onClick={onClose}
      />
      <aside className="relative z-10 flex h-full w-full max-w-md flex-col bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-5">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Match explainability</p>
            <h2 className="text-lg font-semibold text-slate-900">
              {name || "Verified pro"} · {score.toFixed(0)}/{maxTotal.toFixed(0)}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              sk skills · rt rating · rs response · ds distance (max {maxTotal.toFixed(0)})
            </p>
          </div>
          <button
            type="button"
            className="btn-ghost btn-sm touch-target"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5 space-y-4">
          {PARTS.map((p) => {
            const v = Number(breakdown[p.key] || 0);
            return (
              <div key={p.key} className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      <span className="mr-1.5 rounded-sm bg-brand-100 px-1.5 py-0.5 font-mono text-[10px] uppercase text-brand-800">
                        {p.code}
                      </span>
                      {p.label}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500">{p.hint(breakdown)}</p>
                  </div>
                  <p className="shrink-0 font-mono text-sm font-semibold text-brand-800">
                    {v.toFixed(0)}
                    <span className="text-slate-400">/{p.max}</span>
                  </p>
                </div>
                <Bar value={v} max={p.max} />
              </div>
            );
          })}
          <div
            className={clsx(
              "rounded-xl p-3 ring-1",
              score >= 70
                ? "bg-emerald-50 ring-emerald-100"
                : score >= 40
                  ? "bg-amber-50 ring-amber-100"
                  : "bg-slate-50 ring-slate-200"
            )}
          >
            <p className="text-sm font-medium text-slate-900">
              Total {breakdown.total.toFixed(1)} = sk{breakdown.skills.toFixed(0)} + rt
              {breakdown.rating.toFixed(0)} + rs{breakdown.response.toFixed(0)} + ds
              {breakdown.distance.toFixed(0)}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              Higher scores usually mean closer skill fit, better reviews, faster replies, and nearer
              location. Weights are admin-tunable.
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}
