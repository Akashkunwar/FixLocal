import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Shell } from "../components/Shell";
import {
  getPublicProfile,
  inviteSuggestedPro,
  listJobs,
  mediaUrl,
  type Job,
  type TradespersonProfile,
} from "../api/jobs";
import { addFavorite } from "../api/extras";
import { Spinner } from "../components/ui/Spinner";
import { Badge } from "../components/ui/Badge";
import { ResponseSlaBadge } from "../components/ui/ResponseSlaBadge";
import { StarRating } from "../components/ui/StarRating";
import { initials, money } from "../lib/format";
import {
  softRatePackages,
  formatCustomPackage,
  normalizeCustomRatePackages,
} from "../lib/ratePackages";
import { normalizeCaseStudies } from "../lib/caseStudies";
import { useToast } from "../components/Toast";
import { useAuth } from "../auth/AuthContext";
import { Heart, Send } from "lucide-react";
import {
  DAY_KEYS,
  DAY_LABELS,
  normalizeWeeklyAvailability,
} from "../lib/availability";

export function ProPublicPage() {
  const { userId } = useParams<{ userId: string }>();
  const { user } = useAuth();
  const { success, error } = useToast();
  const [profile, setProfile] = useState<TradespersonProfile | null>(null);
  const [reviews, setReviews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [openJobs, setOpenJobs] = useState<Job[]>([]);
  const [inviteJobId, setInviteJobId] = useState("");
  const [inviteMessage, setInviteMessage] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [showInvite, setShowInvite] = useState(false);

  const canInvite =
    user?.role === "HOMEOWNER" &&
    !!profile &&
    profile.verificationStatus === "verified" &&
    profile.userId !== user.id;

  useEffect(() => {
    if (!userId) return;
    getPublicProfile(userId)
      .then((r) => {
        setProfile(r.profile);
        setReviews(r.reviews);
      })
      .catch((e) => error(e.message))
      .finally(() => setLoading(false));
  }, [userId]);

  useEffect(() => {
    if (!canInvite) return;
    listJobs({ status: "open" })
      .then((r) => {
        const jobs = (r.jobs || []).filter((j) => j.status === "open");
        setOpenJobs(jobs);
        if (jobs[0]) setInviteJobId(jobs[0].id);
      })
      .catch(() => setOpenJobs([]));
  }, [canInvite, userId]);

  async function onInvite() {
    if (!profile || !inviteJobId) return;
    setInviteBusy(true);
    try {
      const r = await inviteSuggestedPro(inviteJobId, {
        tradespersonId: profile.userId,
        message: inviteMessage.trim() || undefined,
      });
      success(r.message || "Invite sent");
      setShowInvite(false);
      setInviteMessage("");
    } catch (e: any) {
      error(e.message || "Invite failed");
    } finally {
      setInviteBusy(false);
    }
  }

  if (loading || !profile) {
    return <Shell title="Pro profile"><Spinner /></Shell>;
  }

  return (
    <Shell
      title={profile.name || profile.email || "Professional"}
      subtitle={profile.city || "Local pro"}
      actions={
        <div className="flex flex-wrap gap-2">
          {canInvite && (
            <button
              type="button"
              className="btn-primary btn-sm"
              onClick={() => setShowInvite((v) => !v)}
            >
              <Send className="h-4 w-4" /> Invite to job
            </button>
          )}
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() =>
              addFavorite("pro", profile.userId)
                .then(() => success("Saved"))
                .catch((e) => error(e.message))
            }
          >
            <Heart className="h-4 w-4" /> Save
          </button>
        </div>
      }
    >
      {showInvite && canInvite && (
        <section className="mb-6 card p-4 space-y-3 ring-1 ring-brand-100">
          <h2 className="font-semibold text-sm">Invite {profile.name || "this pro"} to bid</h2>
          {openJobs.length === 0 ? (
            <p className="text-sm text-slate-500">
              No open jobs yet.{" "}
              <Link className="text-brand-700 underline" to="/client/jobs/new">
                Post a job
              </Link>{" "}
              first, then invite from here.
            </p>
          ) : (
            <>
              <div>
                <label className="label">Open job</label>
                <select
                  className="input"
                  value={inviteJobId}
                  onChange={(e) => setInviteJobId(e.target.value)}
                >
                  {openJobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.title}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Optional message</label>
                <input
                  className="input"
                  value={inviteMessage}
                  onChange={(e) => setInviteMessage(e.target.value)}
                  placeholder="Flexible this week — photos attached on the job"
                  maxLength={500}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-primary btn-sm"
                  disabled={inviteBusy || !inviteJobId}
                  onClick={onInvite}
                >
                  {inviteBusy ? "Sending…" : "Send invite"}
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  disabled={inviteBusy}
                  onClick={() => setShowInvite(false)}
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <section className="card p-6">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-100 text-lg font-bold text-brand-800">
                {initials(profile.name, profile.email)}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <StarRating value={Math.round(Number(profile.averageRating))} readonly />
                  <span className="text-sm text-slate-500">({profile.reviewCount})</span>
                  <Badge status={profile.verificationStatus} />
                  {profile.responseSla && <ResponseSlaBadge sla={profile.responseSla} />}
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  {profile.yearsExperience != null && `${profile.yearsExperience} years · `}
                  {profile.hourlyRateMin != null &&
                    `${money(profile.hourlyRateMin)}–${money(profile.hourlyRateMax)}/hr`}
                </p>
              </div>
            </div>
            <p className="mt-4 text-slate-700 whitespace-pre-wrap">{profile.bio || "No bio yet."}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {(profile.skills || "")
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
                .map((s) => (
                  <span key={s} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                    {s}
                  </span>
                ))}
            </div>
            {profile.serviceAreas && (
              <p className="mt-3 text-sm text-slate-500">Serves: {profile.serviceAreas}</p>
            )}
            {normalizeCustomRatePackages(profile.customRatePackages).length > 0 && (
              <div className="mt-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Custom rate packages
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  Set by this professional — still ask for a firm quote on your job.
                </p>
                <ul className="mt-3 grid gap-2 sm:grid-cols-3">
                  {normalizeCustomRatePackages(profile.customRatePackages).map((p) => (
                    <li
                      key={p.id}
                      className="rounded-xl bg-brand-50/60 px-3 py-2.5 ring-1 ring-brand-100"
                    >
                      <p className="text-sm font-semibold text-slate-900">{p.label}</p>
                      {p.hint && <p className="text-[11px] text-slate-500">{p.hint}</p>}
                      <p className="mt-1 text-sm font-medium text-brand-800">
                        {formatCustomPackage(p)}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {softRatePackages(profile.hourlyRateMin, profile.hourlyRateMax).length > 0 && (
              <div className="mt-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Soft rate packages
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  Rough ranges from hourly rates — ask for a firm quote on your job.
                </p>
                <ul className="mt-3 grid gap-2 sm:grid-cols-3">
                  {softRatePackages(profile.hourlyRateMin, profile.hourlyRateMax).map((p) => (
                    <li
                      key={p.id}
                      className="rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200"
                    >
                      <p className="text-sm font-semibold text-slate-900">{p.label}</p>
                      <p className="text-[11px] text-slate-500">{p.hint}</p>
                      <p className="mt-1 text-sm font-medium text-brand-800">{p.display}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>


          {profile.weeklyAvailability && (
            <section className="card p-4 sm:p-6">
              <h2 className="font-semibold text-lg mb-3">Weekly availability</h2>
              <ul className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {DAY_KEYS.map((day) => {

                  const slot = normalizeWeeklyAvailability(profile.weeklyAvailability)[day];
                  const windows = slot.slots?.length
                    ? slot.slots
                    : [{ start: slot.start, end: slot.end }];
                  return (
                    <li
                      key={day}
                      className={`rounded-xl px-3 py-2.5 text-sm ring-1 ${
                        slot.enabled
                          ? "bg-emerald-50 text-emerald-950 ring-emerald-100"
                          : "bg-slate-50 text-slate-400 ring-slate-100"
                      }`}
                    >
                      <p className="font-semibold">{DAY_LABELS[day]}</p>
                      <p className="text-xs mt-0.5">
                        {slot.enabled
                          ? windows.map((w) => `${w.start}–${w.end}`).join(" · ")
                          : "Off"}
                      </p>
                    </li>
                  );
                })}
              </ul>
              {(profile.blockedDates?.length ?? 0) > 0 && (
                <p className="mt-3 text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
                  Blocked dates: {profile.blockedDates!.join(", ")}
                </p>
              )}
            </section>
          )}


          {normalizeCaseStudies(profile.caseStudies).length > 0 && (
            <section className="card p-4 sm:p-6">
              <h2 className="font-semibold text-lg mb-1">Past work</h2>
              <p className="text-xs text-slate-500 mb-4">
                Case studies from this professional — before/after and notes.
              </p>
              <ul className="space-y-4">
                {normalizeCaseStudies(profile.caseStudies).map((cs) => (
                  <li
                    key={cs.id}
                    className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200 space-y-2"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{cs.title}</p>
                      {cs.category && (
                        <p className="text-[11px] font-medium text-brand-800">{cs.category}</p>
                      )}
                      {cs.notes && (
                        <p className="mt-1 text-sm text-slate-600 whitespace-pre-wrap">{cs.notes}</p>
                      )}
                    </div>
                    {(cs.beforeUrl || cs.afterUrl) && (
                      <div className="grid grid-cols-2 gap-2">
                        <figure className="overflow-hidden rounded-lg bg-slate-100 aspect-[4/3]">
                          {cs.beforeUrl ? (
                            <a href={mediaUrl(cs.beforeUrl)} target="_blank" rel="noreferrer">
                              <img
                                src={mediaUrl(cs.beforeUrl)}
                                alt={`${cs.title} before`}
                                className="h-full w-full object-cover hover:opacity-95"
                              />
                            </a>
                          ) : (
                            <figcaption className="flex h-full items-center justify-center text-[11px] text-slate-400">
                              Before
                            </figcaption>
                          )}
                          {cs.beforeUrl && (
                            <figcaption className="sr-only">Before</figcaption>
                          )}
                        </figure>
                        <figure className="overflow-hidden rounded-lg bg-slate-100 aspect-[4/3]">
                          {cs.afterUrl ? (
                            <a href={mediaUrl(cs.afterUrl)} target="_blank" rel="noreferrer">
                              <img
                                src={mediaUrl(cs.afterUrl)}
                                alt={`${cs.title} after`}
                                className="h-full w-full object-cover hover:opacity-95"
                              />
                            </a>
                          ) : (
                            <figcaption className="flex h-full items-center justify-center text-[11px] text-slate-400">
                              After
                            </figcaption>
                          )}
                          {cs.afterUrl && (
                            <figcaption className="sr-only">After</figcaption>
                          )}
                        </figure>
                      </div>
                    )}
                    {(cs.beforeUrl || cs.afterUrl) && (
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        Before · After
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(profile.galleryUrls?.length ?? 0) > 0 && (
            <section className="card p-6">
              <h2 className="font-semibold text-lg mb-4">Work gallery</h2>
              <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {profile.galleryUrls!.map((url) => (
                  <li key={url} className="aspect-[4/3] overflow-hidden rounded-xl bg-slate-100">
                    <a href={mediaUrl(url)} target="_blank" rel="noreferrer">
                      <img src={mediaUrl(url)} alt="Past work" className="h-full w-full object-cover hover:opacity-95" />
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card p-6">
            <h2 className="font-semibold text-lg mb-4">Reviews</h2>
            {reviews.length === 0 ? (
              <p className="text-sm text-slate-500">No reviews yet.</p>
            ) : (
              <ul className="space-y-4">
                {reviews.map((r) => (
                  <li key={r.id} className="border-b border-slate-100 pb-4 last:border-0">
                    <div className="flex items-center gap-2">
                      <StarRating value={r.rating} readonly size={14} />
                      <span className="text-sm font-medium">{r.reviewerName}</span>
                    </div>
                    {r.comment && <p className="mt-1 text-sm text-slate-600">{r.comment}</p>}
                    {r.jobTitle && <p className="mt-1 text-xs text-slate-400">Job: {r.jobTitle}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </Shell>
  );
}
