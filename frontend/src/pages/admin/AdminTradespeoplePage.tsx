import { useEffect, useState } from "react";
import { Shell } from "../../components/Shell";
import {
  listTradespeople,
  verifyTradesperson,
  type AdminTradesperson,
} from "../../api/admin";
import { Badge } from "../../components/ui/Badge";
import { mediaUrl } from "../../api/jobs";
import { Spinner } from "../../components/ui/Spinner";
import { useToast } from "../../components/Toast";

import { t, tf } from "../../lib/i18n";
import { errorText } from "../../lib/apiErrors";
import { statusLabel } from "../../lib/status";
export function AdminTradespeoplePage() {
  const { success, error } = useToast();
  const [list, setList] = useState<AdminTradesperson[]>([]);
  const [status, setStatus] = useState("pending");
  const [loading, setLoading] = useState(true);

  async function load(st = status) {
    setLoading(true);
    try {
      const r = await listTradespeople(st || undefined);
      setList(r.tradespeople);
    } catch (e) {
      error(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once; later loads use the filter button
  }, []);

  async function setVerify(userId: string, next: "verified" | "rejected" | "suspended" | "pending") {
    try {
      await verifyTradesperson(userId, next);
      success(tf("Marked {status}", { status: statusLabel(next) }));
      load();
    } catch (e) {
      error(errorText(e));
    }
  }

  return (
    <Shell title={t("Verify professionals")} subtitle={t("Approve, reject, or suspend pro accounts")}>
      <div className="mb-4 flex gap-2">
        <select className="input w-auto" aria-label={t("Filter by verification status")} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t("All")}</option>
          <option value="pending">{t("Pending")}</option>
          <option value="verified">{t("Verified")}</option>
          <option value="rejected">{t("Rejected")}</option>
          <option value="suspended">{t("Suspended")}</option>
        </select>
        <button type="button" className="btn-secondary" onClick={() => load()}>{t("Filter")}</button>
      </div>
      {loading ? (
        <Spinner />
      ) : (
        <ul className="grid gap-3">
          {list.map((p) => (
            <li key={p.id} className="card flex flex-wrap items-center justify-between gap-3 p-5">
              <div className="min-w-0">
                <p className="font-semibold">{p.name || p.email || p.userId}</p>
                <p className="text-sm text-slate-500">
                  {p.email}
                  {p.phone ? ` · ${p.phone}` : ""}
                  {p.emailVerified === false ? t(" · email not verified") : ""}
                </p>
                <p className="text-sm text-slate-500">
                  {p.skills || t("No skills listed")}
                  {p.yearsExperience != null ? tf(" · {yearsExperience} yrs", { yearsExperience: p.yearsExperience }) : ""}
                </p>
                <p className="text-sm text-slate-500">{p.serviceAreas}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge status={p.verificationStatus} />
                  {p.licenseDocUrl ? (
                    <a className="text-sm text-brand-700 underline" href={mediaUrl(p.licenseDocUrl)} target="_blank" rel="noreferrer">
                      
                      {t("View licence / ID document")}
                    </a>
                  ) : (
                    <span className="text-xs text-amber-700">{t("No licence or ID uploaded yet")}</span>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-primary btn-sm" onClick={() => setVerify(p.userId, "verified")}>{t("Verify")}</button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => setVerify(p.userId, "rejected")}>{t("Reject")}</button>
                <button type="button" className="btn-danger btn-sm" onClick={() => setVerify(p.userId, "suspended")}>{t("Suspend")}</button>
              </div>
            </li>
          ))}
          {list.length === 0 && <p className="text-sm text-slate-500">{t("No professionals in this filter.")}</p>}
        </ul>
      )}
    </Shell>
  );
}
