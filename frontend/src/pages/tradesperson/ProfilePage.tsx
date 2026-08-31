import { useEffect, useState, type FormEvent } from "react";
import { ApiError } from "../../api/client";
import {
  getProfile,
  updateProfile,
  type TradespersonProfile,
} from "../../api/jobs";
import { Shell } from "../../components/Shell";
import { ProNav } from "../../components/ProNav";

export function ProfilePage() {
  const [profile, setProfile] = useState<TradespersonProfile | null>(null);
  const [skills, setSkills] = useState("");
  const [serviceAreas, setServiceAreas] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getProfile()
      .then((res) => {
        setProfile(res.profile);
        setSkills(res.profile.skills || "");
        setServiceAreas(res.profile.serviceAreas || "");
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "Failed to load profile");
      })
      .finally(() => setLoading(false));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      const res = await updateProfile({ skills, serviceAreas });
      setProfile({ ...profile!, ...res.profile });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title="My profile">
      <ProNav />
      {loading && <p className="muted">Loading…</p>}
      {error && <div className="alert">{error}</div>}
      {saved && <p className="ok">Profile saved.</p>}
      {profile && (
        <>
          <p className="muted">
            {profile.email} · verification:{" "}
            <strong>{profile.verificationStatus}</strong>
          </p>
          {!["verified"].includes(profile.verificationStatus) && (
            <div className="alert">
              You cannot place bids until an admin sets your status to verified.
            </div>
          )}
          <form className="form-grid" onSubmit={onSubmit}>
            <label>
              Skills
              <textarea
                rows={3}
                value={skills}
                onChange={(e) => setSkills(e.target.value)}
                placeholder="plumbing, leak repair…"
              />
            </label>
            <label>
              Service areas
              <textarea
                rows={2}
                value={serviceAreas}
                onChange={(e) => setServiceAreas(e.target.value)}
                placeholder="Indiranagar, Koramangala…"
              />
            </label>
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save profile"}
            </button>
          </form>
        </>
      )}
    </Shell>
  );
}
