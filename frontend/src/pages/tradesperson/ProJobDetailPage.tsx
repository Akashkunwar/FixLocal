import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import {
  getJob,
  getProfile,
  listBids,
  placeBid,
  withdrawBid,
  type Bid,
  type Job,
  type TradespersonProfile,
} from "../../api/jobs";
import { Shell } from "../../components/Shell";
import { ProNav } from "../../components/ProNav";

export function ProJobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [job, setJob] = useState<Job | null>(null);
  const [bids, setBids] = useState<Bid[]>([]);
  const [profile, setProfile] = useState<TradespersonProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const [etaDays, setEtaDays] = useState("2");

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [j, b, p] = await Promise.all([getJob(id), listBids(id), getProfile()]);
      setJob(j.job);
      setBids(b.bids);
      setProfile(p.profile);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load job");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const myBid = bids.find(
    (b) => b.tradespersonId === user?.id && b.status === "active"
  );
  const verified = profile?.verificationStatus === "verified";
  const canBid = job?.status === "open" && verified && !myBid;

  async function onBid(e: FormEvent) {
    e.preventDefault();
    setActionError(null);
    setBusy(true);
    try {
      await placeBid(id!, {
        amount: Number(amount),
        message: message.trim() || undefined,
        etaDays: etaDays ? Number(etaDays) : undefined,
      });
      setAmount("");
      setMessage("");
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Bid failed");
    } finally {
      setBusy(false);
    }
  }

  async function onWithdraw() {
    if (!myBid) return;
    setActionError(null);
    setBusy(true);
    try {
      await withdrawBid(myBid.id);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Withdraw failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <Shell title="Job">
        <ProNav />
        <p className="muted">Loading…</p>
      </Shell>
    );
  }

  if (error || !job) {
    return (
      <Shell title="Job">
        <ProNav />
        <div className="alert">{error || "Not found"}</div>
        <Link to="/tradesperson">← Browse</Link>
      </Shell>
    );
  }

  return (
    <Shell title={job.title}>
      <ProNav />
      <p>
        <Link to="/tradesperson">← Browse jobs</Link>
      </p>
      {actionError && <div className="alert">{actionError}</div>}

      <section className="panel">
        <span className={`badge status-${job.status}`}>{job.status}</span>
        <p>{job.description}</p>
        <p className="muted">
          {job.category} · {job.area || "—"} · budget {job.budgetMin ?? "—"}–
          {job.budgetMax ?? "—"} · max bids {job.maxBids}
        </p>
      </section>

      <section className="panel">
        <h2>Your bid</h2>
        {!verified && (
          <div className="alert">
            You cannot bid until an admin verifies your profile (status:{" "}
            {profile?.verificationStatus}).
          </div>
        )}
        {myBid && (
          <div className="row-between">
            <div>
              <strong>₹{myBid.amount}</strong>
              <div className="muted">{myBid.message || "No message"}</div>
            </div>
            {job.status === "open" && (
              <button className="btn ghost" disabled={busy} onClick={onWithdraw}>
                Withdraw bid
              </button>
            )}
          </div>
        )}
        {canBid && (
          <form className="form-grid" onSubmit={onBid}>
            <label>
              Amount (₹)
              <input
                type="number"
                min="1"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label>
              Message
              <input value={message} onChange={(e) => setMessage(e.target.value)} />
            </label>
            <label>
              ETA (days)
              <input
                type="number"
                min="1"
                value={etaDays}
                onChange={(e) => setEtaDays(e.target.value)}
              />
            </label>
            <button className="btn primary" type="submit" disabled={busy}>
              Place bid
            </button>
          </form>
        )}
        {verified && job.status === "open" && !myBid && !canBid && (
          <p className="muted">Bidding unavailable.</p>
        )}
      </section>

      <section className="panel">
        <h2>Other bids</h2>
        <ul className="list">
          {bids
            .filter((b) => b.tradespersonId !== user?.id)
            .map((b) => (
              <li key={b.id} className="list-item static">
                <div>
                  <strong>
                    {b.amount === null || b.amount === undefined
                      ? "Amount hidden"
                      : `₹${b.amount}`}
                  </strong>
                  <div className="muted">{b.status}</div>
                </div>
              </li>
            ))}
        </ul>
        {bids.filter((b) => b.tradespersonId !== user?.id).length === 0 && (
          <p className="muted">No other bids yet.</p>
        )}
      </section>
    </Shell>
  );
}
