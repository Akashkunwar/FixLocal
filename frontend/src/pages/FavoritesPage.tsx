import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Shell } from "../components/Shell";
import {
  listFavorites,
  removeFavorite,
  updateFavorite,
  type FavoriteItem,
} from "../api/extras";
import { Spinner } from "../components/ui/Spinner";
import { EmptyState } from "../components/ui/EmptyState";
import { Badge } from "../components/ui/Badge";
import { ResponseSlaBadge } from "../components/ui/ResponseSlaBadge";
import { useToast } from "../components/Toast";
import { useAuth } from "../auth/AuthContext";
import { listJobs } from "../api/jobs";

export function FavoritesPage() {
  const { user } = useAuth();
  const { success, error } = useToast();
  const [items, setItems] = useState<FavoriteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [openJobs, setOpenJobs] = useState<{ id: string; title: string }[]>([]);
  const [bulkJobId, setBulkJobId] = useState("");

  async function load() {
    setLoading(true);
    try {
      const r = await listFavorites();
      setItems(r.favorites);
    } catch (e) {
      error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once when the page opens
  }, []);

  useEffect(() => {
    if (user?.role !== "HOMEOWNER") return;
    listJobs({ status: "open", mine: "1" })
      .then((r) => {
        const jobs = (r.jobs || []).map((j) => ({ id: j.id, title: j.title }));
        setOpenJobs(jobs);
        if (jobs[0]) setBulkJobId(jobs[0].id);
      })
      .catch(() => setOpenJobs([]));
  }, [user?.role]);

  const proItems = useMemo(
    () => items.filter((f) => f.targetType === "pro"),
    [items]
  );

  async function remove(type: "job" | "pro", id: string) {
    try {
      await removeFavorite(type, id);
      success("Removed");
      load();
    } catch (e) {
      error((e as Error).message);
    }
  }

  function startEdit(f: FavoriteItem) {
    setEditingId(f.id);
    setNoteDraft(f.notes || "");
    setTagDraft((f.tags || []).join(", "));
  }

  async function saveEdit(f: FavoriteItem) {
    try {
      const tags = tagDraft
        .split(/[,#]/)
        .map((t) => t.trim())
        .filter(Boolean);
      await updateFavorite(f.targetType as "job" | "pro", f.targetId, {
        notes: noteDraft,
        tags,
      });
      success("Shortlist updated");
      setEditingId(null);
      load();
    } catch (e) {
      error((e as Error).message);
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  const jobLink = (id: string) =>
    user?.role === "HOMEOWNER" ? `/client/jobs/${id}` : `/professional/jobs/${id}`;

  return (
    <Shell
      title={user?.role === "HOMEOWNER" ? "Shortlist & saved" : "Saved"}
      subtitle={
        user?.role === "HOMEOWNER"
          ? "Notes & tags on saved pros · bulk-invite from an open job"
          : "Jobs and pros you bookmarked"
      }
    >
      {loading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState
          title="Nothing saved yet"
          description="Heart a job while browsing, or save a pro from Find pros / public profiles."
          action={
            user?.role === "HOMEOWNER" ? (
              <Link to="/client/pros" className="btn-primary btn-sm no-underline">
                Find pros
              </Link>
            ) : user?.role === "TRADESPERSON" ? (
              <Link to="/professional" className="btn-primary btn-sm no-underline">
                Browse jobs
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          {user?.role === "HOMEOWNER" && proItems.length > 0 && (
            <div className="mb-4 card p-4 space-y-3">
              <div className="flex flex-wrap items-end gap-2">
                <label className="block min-w-[200px] flex-1">
                  <span className="label">Bulk invite shortlist → open job</span>
                  <select
                    className="input"
                    value={bulkJobId}
                    onChange={(e) => setBulkJobId(e.target.value)}
                  >
                    {openJobs.length === 0 && <option value="">No open jobs</option>}
                    {openJobs.map((j) => (
                      <option key={j.id} value={j.id}>
                        {j.title}
                      </option>
                    ))}
                  </select>
                </label>
                <Link
                  to={
                    bulkJobId && selected.length
                      ? `/client/jobs/${bulkJobId}?shortlistInvite=${selected.join(",")}`
                      : bulkJobId
                        ? `/client/jobs/${bulkJobId}`
                        : "/client"
                  }
                  className={`btn-primary btn-sm no-underline ${
                    !bulkJobId || !selected.length ? "pointer-events-none opacity-50" : ""
                  }`}
                >
                  Invite selected ({selected.length})
                </Link>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() =>
                    setSelected(
                      selected.length === proItems.length
                        ? []
                        : proItems.map((p) => p.targetId)
                    )
                  }
                >
                  {selected.length === proItems.length ? "Clear" : "Select all pros"}
                </button>
              </div>
              <p className="text-xs text-slate-500">
                Tip: open any job → <span className="font-medium">Invite from shortlist</span>{" "}
                also supports multi-select.
              </p>
            </div>
          )}

          <ul className="grid gap-3">
            {items.map((f) => (
              <li key={f.id} className="card p-4 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    {user?.role === "HOMEOWNER" && f.targetType === "pro" && (
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={selected.includes(f.targetId)}
                        onChange={() => toggleSelect(f.targetId)}
                        aria-label="Select for bulk invite"
                      />
                    )}
                    {f.targetType === "job" && f.job?.unavailable ? (
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-500">{f.job.title}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          This job is no longer open to you.
                        </p>
                      </div>
                    ) : f.targetType === "job" && f.job ? (
                      <Link to={jobLink(f.targetId)} className="min-w-0 no-underline text-inherit">
                        <p className="font-semibold text-slate-900">{f.job.title}</p>
                        <div className="mt-1">
                          <Badge status={f.job.status} />
                        </div>
                      </Link>
                    ) : f.targetType === "pro" && f.pro ? (
                      <div className="min-w-0">
                        <Link
                          to={`/pros/${f.targetId}`}
                          className="font-semibold text-slate-900 no-underline hover:text-brand-700"
                        >
                          {f.pro.name || "Professional"}
                        </Link>
                        <p className="text-sm text-slate-500">{f.pro.skills}</p>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {f.pro.responseSla ? (
                            <ResponseSlaBadge sla={f.pro.responseSla} compact />
                          ) : null}
                          {(f.tags || []).map((t) => (
                            <span
                              key={t}
                              className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600"
                            >
                              #{t}
                            </span>
                          ))}
                        </div>
                        {f.notes && editingId !== f.id && (
                          <p className="mt-1 text-xs text-slate-600 italic">“{f.notes}”</p>
                        )}
                      </div>
                    ) : (
                      <span className="text-sm text-slate-500">
                        {f.targetType} · {f.targetId}
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {f.targetType === "pro" && user?.role === "HOMEOWNER" && (
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        onClick={() =>
                          editingId === f.id ? setEditingId(null) : startEdit(f)
                        }
                      >
                        {editingId === f.id ? "Cancel" : "Note/tags"}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      onClick={() => remove(f.targetType as "job" | "pro", f.targetId)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
                {editingId === f.id && (
                  <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200 space-y-2">
                    <label className="block">
                      <span className="label">Note</span>
                      <textarea
                        className="input min-h-[60px]"
                        value={noteDraft}
                        onChange={(e) => setNoteDraft(e.target.value)}
                        placeholder="e.g. Great for kitchen leaks"
                        maxLength={500}
                      />
                    </label>
                    <label className="block">
                      <span className="label">Tags (comma-separated)</span>
                      <input
                        className="input"
                        value={tagDraft}
                        onChange={(e) => setTagDraft(e.target.value)}
                        placeholder="kitchen, fast, evening"
                      />
                    </label>
                    <button
                      type="button"
                      className="btn-primary btn-sm"
                      onClick={() => saveEdit(f)}
                    >
                      Save
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Shell>
  );
}
