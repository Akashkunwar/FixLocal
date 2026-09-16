import { useEffect, useState } from "react";
import { Shell } from "../../components/Shell";
import {
  listTradespeople,
  verifyTradesperson,
  type AdminTradesperson,
} from "../../api/admin";
import { Badge } from "../../components/ui/Badge";
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
              <div>
                <p className="font-semibold">{p.email || p.userId}</p>
                <p className="text-sm text-slate-500">{p.skills || "No skills listed"}</p>
                <p className="text-sm text-slate-400">{p.serviceAreas}</p>
                <div className="mt-2"><Badge status={p.verificationStatus} /></div>
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
