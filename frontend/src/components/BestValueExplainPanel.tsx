import { Dialog } from "./ui/Dialog";
import { t, tf } from "../lib/i18n";

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
    <Dialog
      open={open}
      onClose={onClose}
      variant="drawer"
      eyebrow={t("Why best value")}
      title={
        <>
          {row.name}
          {row.isBest ? t(" · Best value") : ""}
        </>
      }
      description={
        <span className="text-xs text-slate-500">
          {t("Blend: match")}{" "}{row.matchPct}{t("% · lower escrow hold")}{" "}{row.pricePct}%
          {slaHeatPct > 0 ? ` · ${t("SLA/heat")} ${slaHeatPct}%` : ""}
        </span>
      }
      closeLabel={t("Close best value explain")}
    >
        <div className="space-y-4">
          <div className="rounded-xl bg-sky-50 p-3 ring-1 ring-sky-100">
            <p className="text-sm font-semibold text-slate-900">
              {t("Value score")}{" "}<span className="font-mono text-sky-900">{row.valueScore}</span>
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              {row.matchPct}{t("% × matchNorm (")}{row.matchNorm.toFixed(2)}) + {row.pricePct}{t("% × priceNorm (")}
              {row.priceNorm.toFixed(2)})
              {slaHeatPct > 0 && row.slaHeatNorm != null
                ? tf(" + {slaHeatPct}% × slaHeatNorm ({slaHeatNorm})", { slaHeatPct, slaHeatNorm: row.slaHeatNorm.toFixed(2) })
                : ""}{" "}
              → {row.valueScore}
            </p>
          </div>

          <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  <span className="mr-1.5 rounded-sm bg-brand-100 px-1.5 py-0.5 font-mono text-[10px] uppercase text-brand-800">
                    {t("mt")}
                  </span>
                  {t("Match / ranked score")}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {t("Raw match")}{" "}{row.matchScore.toFixed(0)} {t("· normalized")}{" "}{row.matchNorm.toFixed(2)} {t("among competing bids")}
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
                  <span className="mr-1.5 rounded-sm bg-emerald-100 px-1.5 py-0.5 font-mono text-[10px] uppercase text-emerald-800">
                    {t("px")}
                  </span>
                  {t("Lower escrow hold")}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {t("Hold ₹")}{Math.round(row.hold)} {t("· priceNorm")}{" "}{row.priceNorm.toFixed(2)} {t("(lower hold → higher)")}
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
                    <span className="mr-1.5 rounded-sm bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] uppercase text-amber-900">
                      {t("sh")}
                    </span>
                    {t("SLA + availability heat")}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {t("Raw")}{" "}{Number(row.slaHeatRaw ?? 0).toFixed(0)} {t("· normalized")}{" "}{row.slaHeatNorm.toFixed(2)}{" "}
                    {t("(faster reply + higher heat → higher)")}
                  </p>
                </div>
                <p className="shrink-0 font-mono text-sm font-semibold text-amber-900">{slaPart}</p>
              </div>
              <Bar value={row.slaHeatNorm} color="bg-amber-500" />
            </div>
          )}

          <p className="text-[11px] text-slate-500">
            {t("Weights are admin-tunable on Match quality (audited). Scores are relative to other clean competing bids on this job (simulated escrow only).")}
          </p>
        </div>
    </Dialog>
  );
}
