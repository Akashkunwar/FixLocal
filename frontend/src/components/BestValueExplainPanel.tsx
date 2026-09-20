import { X } from "lucide-react";

export type BestValueExplainRow = {
  bidId: string;
  name: string;
  matchScore: number;
  hold: number;
  matchNorm: number;
  priceNorm: number;
  valueScore: number;
  matchPct: number;
  pricePct: number;
  slaHeatPct?: number;
  slaHeatNorm?: number;
  slaHeatRaw?: number;
  isBest: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
  row: BestValueExplainRow | null;
};

function Bar({ value, max = 1, color = "bg-sky-600" }: { value: number; max?: number; color?: string }) {
  const pct = Math.max(0, Math.min(100, max > 0 ? (value / max) * 100 : 0));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Side drawer explaining why a bid scored as best value (match vs price blend). */
export function BestValueExplainPanel({ open, onClose, row }: Props) {
  if (!open || !row) return null;
  const matchW = row.matchPct / 100;
  const priceW = row.pricePct / 100;
  const slaHeatPct = Number(row.slaHeatPct ?? 0);
  const slaW = slaHeatPct / 100;
  const matchPart = Math.round(matchW * row.matchNorm * 1000) / 10;
  const pricePart = Math.round(priceW * row.priceNorm * 1000) / 10;
  const slaPart =
    slaHeatPct > 0 && row.slaHeatNorm != null
      ? Math.round(slaW * row.slaHeatNorm * 1000) / 10
      : null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40"
        aria-label="Close best value explain"
        onClick={onClose}
      />
      <aside className="relative z-10 flex h-full w-full max-w-md flex-col bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-5">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Why best value</p>
            <h2 className="text-lg font-semibold text-slate-900">
              {row.name}
              {row.isBest ? " · Best value" : ""}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Blend: match {row.matchPct}% · lower escrow hold {row.pricePct}%
              {slaHeatPct > 0 ? ` · SLA/heat ${slaHeatPct}%` : ""}
            </p>
          </div>
          <button type="button" className="btn-ghost btn-sm touch-target" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
          <div className="rounded-xl bg-sky-50 p-3 ring-1 ring-sky-100">
            <p className="text-sm font-semibold text-slate-900">
              Value score <span className="font-mono text-sky-900">{row.valueScore}</span>
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              {row.matchPct}% × matchNorm ({row.matchNorm.toFixed(2)}) + {row.pricePct}% × priceNorm (
              {row.priceNorm.toFixed(2)})
              {slaHeatPct > 0 && row.slaHeatNorm != null
                ? ` + ${slaHeatPct}% × slaHeatNorm (${row.slaHeatNorm.toFixed(2)})`
                : ""}{" "}
              → {row.valueScore}
            </p>
          </div>

          <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  <span className="mr-1.5 rounded bg-brand-100 px-1.5 py-0.5 font-mono text-[10px] uppercase text-brand-800">
                    mt
                  </span>
                  Match / ranked score
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  Raw match {row.matchScore.toFixed(0)} · normalized {row.matchNorm.toFixed(2)} among competing bids
                </p>
              </div>
              <p className="shrink-0 font-mono text-sm font-semibold text-brand-800">{matchPart}</p>
            </div>
            <Bar value={row.matchNorm} color="bg-brand-600" />
          </div>

          <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  <span className="mr-1.5 rounded bg-emerald-100 px-1.5 py-0.5 font-mono text-[10px] uppercase text-emerald-800">
                    px
                  </span>
                  Lower escrow hold
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  Hold ₹{Math.round(row.hold)} · priceNorm {row.priceNorm.toFixed(2)} (lower hold → higher)
                </p>
              </div>
              <p className="shrink-0 font-mono text-sm font-semibold text-emerald-800">{pricePart}</p>
            </div>
            <Bar value={row.priceNorm} color="bg-emerald-600" />
          </div>

          {slaHeatPct > 0 && row.slaHeatNorm != null && (
            <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    <span className="mr-1.5 rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] uppercase text-amber-900">
                      sh
                    </span>
                    SLA + availability heat
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    Raw {Number(row.slaHeatRaw ?? 0).toFixed(0)} · normalized {row.slaHeatNorm.toFixed(2)}{" "}
                    (faster reply + higher heat → higher)
                  </p>
                </div>
                <p className="shrink-0 font-mono text-sm font-semibold text-amber-900">{slaPart}</p>
              </div>
              <Bar value={row.slaHeatNorm} color="bg-amber-500" />
            </div>
          )}

          <p className="text-[11px] text-slate-500">
            Weights are admin-tunable on Match quality (audited). Scores are relative to other clean competing
            bids on this job (simulated escrow only).
          </p>
        </div>
      </aside>
    </div>
  );
}
