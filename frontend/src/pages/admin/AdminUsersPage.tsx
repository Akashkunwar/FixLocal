import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Shell } from "../../components/Shell";
import { listUsers, setUserSuspended, type AdminUser } from "../../api/admin";
import { Badge } from "../../components/ui/Badge";
import { Spinner } from "../../components/ui/Spinner";
import { EmptyState } from "../../components/ui/EmptyState";
import { useToast } from "../../components/Toast";
import { fmtDate } from "../../lib/format";

export function AdminUsersPage() {
  const { success, error } = useToast();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState("");
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(() => params.get("q") || "");
  const [suspendedOnly, setSuspendedOnly] = useState(false);

  async function load() {
    setLoading(true);
    // Keep the search in the URL so it survives reloads and can be linked (e.g. from Reports).
    setParams(q.trim() ? { q: q.trim() } : {}, { replace: true });
    try {
      const r = await listUsers({
        role: role || undefined,
        q: q || undefined,
        suspended: suspendedOnly || undefined,
      });
      setUsers(r.users);
    } catch (e) {
      error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once; later loads use the Filter button
  }, []);

  async function toggleSuspend(u: AdminUser) {
    const next = !u.isSuspended;
    const label = next ? "Suspend" : "Unsuspend";
    if (!confirm(`${label} ${u.email}?`)) return;
    try {
      await setUserSuspended(u.id, next);
      success(`${u.email} ${next ? "suspended" : "unsuspended"}`);
      load();
    } catch (e) {
      error((e as Error).message);
    }
  }

  return (
    <Shell title="Users" subtitle="Search, filter, and suspend clients or professionals">
      <div className="mb-4 flex flex-wrap gap-2">
        <input
          className="input min-w-[200px] flex-1"
          placeholder="Search name, email, phone…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
        />
        <select className="input w-auto" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">All roles</option>
          <option value="HOMEOWNER">Clients</option>
          <option value="TRADESPERSON">Professionals</option>
          <option value="ADMIN">Admins</option>
        </select>
        <label className="inline-flex items-center gap-2 text-sm text-slate-600 px-2">
          <input
            type="checkbox"
            checked={suspendedOnly}
            onChange={(e) => setSuspendedOnly(e.target.checked)}
          />
          Suspended only
        </label>
        <button type="button" className="btn-secondary" onClick={load}>Filter</button>
      </div>

      {loading ? (
        <Spinner />
      ) : users.length === 0 ? (
        <EmptyState title="No users found" description="Try a different search or filter." />
      ) : (
        <ul className="grid gap-3">
          {users.map((u) => (
            <li key={u.id} className="card flex flex-wrap items-center justify-between gap-3 p-5">
              <div className="min-w-0">
                <p className="font-semibold truncate">{u.name || u.email}</p>
                <p className="text-sm text-slate-500">{u.email}{u.phone ? ` · ${u.phone}` : ""}</p>
                <div className="mt-2 flex flex-wrap gap-2 items-center">
                  <Badge status={u.role.toLowerCase()} />
                  {u.verificationStatus && <Badge status={u.verificationStatus} />}
                  {u.isSuspended && <Badge status="suspended" />}
                  <span className="text-xs text-slate-400">Joined {fmtDate(u.createdAt)}</span>
                </div>
              </div>
              {u.role !== "ADMIN" && (
                <button
                  type="button"
                  className={u.isSuspended ? "btn-primary btn-sm" : "btn-danger btn-sm"}
                  onClick={() => toggleSuspend(u)}
                >
                  {u.isSuspended ? "Unsuspend" : "Suspend"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}
