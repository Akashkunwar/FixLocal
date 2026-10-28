import { useEffect, useState } from "react";
import { Shell } from "../../components/Shell";
import {
  listAuditLogs,
  createAdminNote,
  rollbackMatchWeights,
  rollbackBestValueBlend,
  type AuditLog,
} from "../../api/admin";
import { Badge } from "../../components/ui/Badge";
import { Spinner } from "../../components/ui/Spinner";
import { EmptyState } from "../../components/ui/EmptyState";
import { useToast } from "../../components/Toast";
import { fmtDateTime } from "../../lib/format";

import { t, tf } from "../../lib/i18n";
import { errorText } from "../../lib/apiErrors";
import { statusLabel } from "../../lib/status";
const ACTIONS = [
  "",
  "user_suspend",
  "user_unsuspend",
  "dispute_resolve",
  "force_cancel",
  "verify_tradesperson",
  "admin_note",
  "match_weights_update",
  "best_value_blend_update",
];


type WeightSnapshot = {
  skills?: number;
  rating?: number;
  response?: number;
  distance?: number;
  heatWeight?: number;
  matchPct?: number;
  pricePct?: number;
  slaHeatPct?: number;
};

/** The metadata stored with match-weight and best-value-blend audit rows. */
type AuditMeta = {
  rollback?: unknown;
  preset?: string;
  beforeHeatWeight?: number;
  before?: WeightSnapshot;
  after?: WeightSnapshot;
};

const auditMeta = (log: { meta?: unknown }) => (log.meta ?? {}) as AuditMeta;

export function AdminAuditPage() {
  const { error, success } = useToast();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState("");
  const [note, setNote] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [rollbackId, setRollbackId] = useState<string | null>(null);

  async function load(a = action) {
    setLoading(true);
    try {
      const r = await listAuditLogs({ action: a || undefined, limit: 80 });
      setLogs(r.logs);
    } catch (e) {
      error(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once when the page opens
  }, []);

  return (
    <Shell title={t("Audit log")} subtitle={t("Suspend, disputes, force-cancel, verification, match-weight + best-value blend changes (+ rollback), and notes")}>
      <div className="mb-4 flex flex-wrap gap-2">
        <select className="input w-auto" aria-label={t("Filter by action")} value={action} onChange={(e) => setAction(e.target.value)}>
          {ACTIONS.map((a) => (
            <option key={a || "all"} value={a}>
              {a ? statusLabel(a) : t("All actions")}
            </option>
          ))}
        </select>
        <button type="button" className="btn-secondary" onClick={() => load()}>
          
          {t("Filter")}
        </button>
      </div>

      <form
        className="mb-6 card p-4 space-y-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!note.trim()) return;
          setNoteBusy(true);
          try {
            await createAdminNote({ note: note.trim() });
            success(t("Audit note saved"));
            setNote("");
            await load(action);
          } catch (err) {
            error(errorText(err, "Failed to save note"));
          } finally {
            setNoteBusy(false);
          }
        }}
      >
        <label className="label" htmlFor="audit-note">{t("Optional admin note")}</label>
        <textarea id="audit-note"
          className="input"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("e.g. Checked the escrow source on this job with both parties…")}
        />
        <button type="submit" className="btn-secondary btn-sm" disabled={noteBusy || !note.trim()}>
          {noteBusy ? t("Saving…") : t("Add note")}
        </button>
      </form>

      {loading ? (
        <Spinner />
      ) : logs.length === 0 ? (
        <EmptyState
          title={t("No audit entries yet")}
          description={t("Suspend a user, resolve a dispute, or force-cancel a job to populate this log.")}
        />
      ) : (
        <ul className="grid gap-3">
          {logs.map((log) => (
            <li key={log.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge status={log.action} />
                    <span className="text-xs text-slate-500">{fmtDateTime(log.createdAt)}</span>
                  </div>
                  <p className="mt-2 text-sm font-medium text-slate-900">
                    {log.summary || statusLabel(log.action)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    
                    {t("By")}{" "}{log.actorEmail || log.actorUserId}
                    {log.targetType ? ` · ${log.targetType}` : ""}
                    {log.targetId ? ` ${log.targetId.slice(0, 8)}…` : ""}
                  </p>
                  {log.action === "match_weights_update" &&
                    Boolean(log.meta?.before) &&
                    !auditMeta(log)?.rollback && (
                    <p className="mt-1 text-[11px] text-slate-500">
                      
                      {t("before sk")}{auditMeta(log).before?.skills}{t("/rt")}{auditMeta(log).before?.rating}{t("/rs")}
                      {auditMeta(log).before?.response}{t("/ds")}{auditMeta(log).before?.distance}
                      {auditMeta(log).beforeHeatWeight != null ||
                      auditMeta(log).before?.heatWeight != null
                        ? tf(" · heat {heatWeight}", { heatWeight: auditMeta(log).beforeHeatWeight ?? auditMeta(log).before?.heatWeight })
                        : ""}
                      {auditMeta(log).preset ? tf(" · preset {preset}", { preset: auditMeta(log).preset }) : ""}
                    </p>
                  )}
                  {log.action === "best_value_blend_update" &&
                    Boolean(log.meta?.before) &&
                    !auditMeta(log)?.rollback && (
                    <p className="mt-1 text-[11px] text-slate-500">
                      
                      {t("before mt")}{auditMeta(log).before?.matchPct}{t("/px")}{auditMeta(log).before?.pricePct}
                      {auditMeta(log).before?.slaHeatPct != null
                        ? tf("/sh{slaHeatPct}", { slaHeatPct: auditMeta(log).before?.slaHeatPct })
                        : ""}
                      {" → "}
                      
                      {t("after mt")}{auditMeta(log).after?.matchPct}{t("/px")}{auditMeta(log).after?.pricePct}
                      {auditMeta(log).after?.slaHeatPct != null
                        ? tf("/sh{slaHeatPct}", { slaHeatPct: auditMeta(log).after?.slaHeatPct })
                        : ""}
                    </p>
                  )}
                </div>
                {log.action === "match_weights_update" &&
                  Boolean(log.meta?.before) &&
                  !auditMeta(log)?.rollback && (
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    disabled={rollbackId === log.id}
                    title={t("Restore the clean before snapshot from this audit row")}
                    onClick={async () => {
                      setRollbackId(log.id);
                      try {
                        const r = await rollbackMatchWeights(log.id);
                        success(r.message || "Match weights rolled back");
                        await load(action);
                      } catch (e) {
                        error(errorText(e, "Rollback failed"));
                      } finally {
                        setRollbackId(null);
                      }
                    }}
                  >
                    {rollbackId === log.id ? t("Rolling back…") : t("Rollback weights + heat")}
                  </button>
                )}
                {log.action === "best_value_blend_update" &&
                  Boolean(log.meta?.before) &&
                  !auditMeta(log)?.rollback && (
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    disabled={rollbackId === log.id}
                    title={t("Restore the clean before best-value blend from this audit row")}
                    onClick={async () => {
                      setRollbackId(log.id);
                      try {
                        const r = await rollbackBestValueBlend(log.id);
                        success(r.message || "Best-value blend rolled back");
                        await load(action);
                      } catch (e) {
                        error(errorText(e, "Blend rollback failed"));
                      } finally {
                        setRollbackId(null);
                      }
                    }}
                  >
                    {rollbackId === log.id ? t("Rolling back…") : t("Rollback blend")}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}
