import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError } from "../../api/client";
import {
  acceptBid,
  cancelJob,
  completeJob,
  createDispute,
  getJob,
  listBids,
  mediaUrl,
  type Bid,
  type Job,
} from "../../api/jobs";
import { Shell } from "../../components/Shell";

export function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<Job | null>(null);
  const [bids, setBids] = useState<Bid[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [j, b] = await Promise.all([getJob(id), listBids(id)]);
      setJob(j.job);
      setBids(b.bids);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load job");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(action: () => Promise<void>) {
    setActionError(null);
    setBusy(true);
    try {
      await action();
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function onAccept(bidId: string) {
    await run(async () => {
      await acceptBid(bidId);
    });
  }

  async function onComplete() {
    await run(async () => {
      await completeJob(id!);
    });
  }

  async function onCancel() {
    await run(async () => {
      await cancelJob(id!);
    });
  }

  async function onDispute(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      await createDispute(id!, disputeReason.trim());
      setDisputeReason("");
    });
  }

  if (loading) {
    return (
      <Shell title="Job">
        <p className="muted">Loading…</p>
      </Shell>
    );
  }

  if (error || !job) {
    return (
      <Shell title="Job">
        <div className="alert">{error || "Not found"}</div>
        <Link to="/homeowner">← Back</Link>
      </Shell>
    );
  }

  const canAccept = job.status === "open";
  const canComplete =
    job.status === "awarded" || job.status === "in_progress";
  const canCancel = job.status === "open";
  const canDispute = ["awarded", "in_progress", "completed", "disputed"].includes(
    job.status
  );
  const activeBids = bids.filter((b) => b.status === "active");

  return (
    <Shell title={job.title}>
      <p>
        <Link to="/homeowner">← My jobs</Link>
      </p>
      {actionError && <div className="alert">{actionError}</div>}

      <section className="panel">
        <div className="row-between">
          <span className={`badge status-${job.status}`}>{job.status}</span>
          <span className="muted">{job.category}</span>
        </div>
        <p>{job.description}</p>
        <p className="muted">
          Area: {job.area || "—"} · Budget: {job.budgetMin ?? "—"}–
          {job.budgetMax ?? "—"} · Max bids: {job.maxBids}
          {job.paymentStatus
            ? ` · Payment: ${job.paymentStatus}`
            : ""}
        </p>
        {job.photoUrls?.length > 0 && (
          <div className="thumbs">
            {job.photoUrls.map((url) => (
              <a key={url} href={mediaUrl(url)} target="_blank" rel="noreferrer">
                <img src={mediaUrl(url)} alt="Job attachment" />
              </a>
            ))}
          </div>
        )}
        <div className="btn-row">
          {canCancel && (
            <button className="btn ghost" disabled={busy} onClick={onCancel}>
              Cancel job
            </button>
          )}
          {canComplete && (
            <button className="btn primary" disabled={busy} onClick={onComplete}>
              Mark completed
            </button>
          )}
        </div>
      </section>

      <section className="panel">
        <h2>Bids</h2>
        {bids.length === 0 && <p className="muted">No bids yet.</p>}
        <ul className="list">
          {bids.map((bid) => (
            <li key={bid.id} className="list-item static">
              <div>
                <strong>₹{bid.amount ?? "—"}</strong>
                <div className="muted">
                  {bid.message || "No message"} · ETA {bid.etaDays ?? "—"} days ·{" "}
                  {bid.status}
                </div>
              </div>
              {canAccept && bid.status === "active" && (
                <button
                  className="btn primary"
                  disabled={busy}
                  onClick={() => onAccept(bid.id)}
                >
                  Accept
                </button>
              )}
            </li>
          ))}
        </ul>
        {canAccept && activeBids.length === 0 && (
          <p className="muted">Waiting for tradespeople to bid.</p>
        )}
      </section>

      {canDispute && job.status !== "disputed" && (
        <section className="panel">
          <h2>Open dispute</h2>
          <form className="form-grid" onSubmit={onDispute}>
            <label>
              Reason
              <textarea
                value={disputeReason}
                onChange={(e) => setDisputeReason(e.target.value)}
                rows={3}
                required
              />
            </label>
            <button className="btn ghost" type="submit" disabled={busy || !disputeReason.trim()}>
              Submit dispute
            </button>
          </form>
        </section>
      )}
      {job.status === "disputed" && (
        <p className="muted">A dispute is open on this job.</p>
      )}
    </Shell>
  );
}
