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
    } catch (e: any) {
      error(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function setVerify(userId: string, next: "verified" | "rejected" | "suspended" | "pending") {
    try {
      await verifyTradesperson(userId, next);
      success(`Marked ${next}`);
      load();
    } catch (e: any) {
      error(e.message);
    }
  }

  return (
    <Shell title="Verify professionals" subtitle="Approve, reject, or suspend pro accounts">
      <div className="mb-4 flex gap-2">
        <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          <option value="pending">Pending</option>
          <option value="verified">Verified</option>
          <option value="rejected">Rejected</option>
          <option value="suspended">Suspended</option>
        </select>
        <button type="button" className="btn-secondary" onClick={() => load()}>Filter</button>
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
                  {p.emailVerified === false ? " · email not verified" : ""}
                </p>
                <p className="text-sm text-slate-500">
                  {p.skills || "No skills listed"}
                  {p.yearsExperience != null ? ` · ${p.yearsExperience} yrs` : ""}
                </p>
                <p className="text-sm text-slate-400">{p.serviceAreas}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge status={p.verificationStatus} />
                  {p.licenseDocUrl ? (
                    <a className="text-sm text-brand-700 underline" href={mediaUrl(p.licenseDocUrl)} target="_blank" rel="noreferrer">
                      View licence / ID document
                    </a>
                  ) : (
                    <span className="text-xs text-amber-700">No licence or ID uploaded yet</span>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-primary btn-sm" onClick={() => setVerify(p.userId, "verified")}>Verify</button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => setVerify(p.userId, "rejected")}>Reject</button>
                <button type="button" className="btn-danger btn-sm" onClick={() => setVerify(p.userId, "suspended")}>Suspend</button>
              </div>
            </li>
          ))}
          {list.length === 0 && <p className="text-sm text-slate-500">No professionals in this filter.</p>}
        </ul>
      )}
    </Shell>
  );
}
