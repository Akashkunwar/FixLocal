import { Link } from "react-router-dom";
import { type Job } from "../../../api/jobs";
import { ResponseSlaBadge } from "../../../components/ui/ResponseSlaBadge";
import { ShortlistFunnelPanel } from "./ShortlistFunnelPanel";
import { Users } from "lucide-react";
import type { JobDetailState } from "./useJobDetail";
import { t } from "../../../lib/i18n";

export function ShortlistInvitePanel({
  s,
  job,
}: {
  s: JobDetailState;
  job: Job;
}) {
  const {
    bids,
    confirmShortlistBulkInvite,
    inviteBusy,
    inviteHistory,
    invitedIds,
    onInvitePro,
    setShortlistBulkMsg,
    setShortlistBulkOpen,
    setShortlistSelected,
    shortlistBulkMsg,
    shortlistBulkOpen,
    shortlistFunnel,
    shortlistMinHeat,
    shortlistPros,
    shortlistSelected,
  } = s;
  return (
    <>
      {job.status === "open" && shortlistPros.length > 0 && (
        <section className="card p-6 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold">{t("Invite from shortlist")}</h2>
              <p className="text-xs text-slate-500">
                {t("Smart-ranked for this job (match score + tag boost) · notes & tags from Favorites")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={
                  shortlistBulkOpen
                    ? "btn-primary btn-sm"
                    : "btn-secondary btn-sm"
                }
                onClick={() => {
                  setShortlistBulkOpen((v) => !v);
                  if (shortlistBulkOpen) setShortlistSelected([]);
                }}
              >
                <Users className="h-3.5 w-3.5" />
                {shortlistBulkOpen ? t("Cancel multi") : t("Invite multiple")}
              </button>
              <Link
                to="/client/favorites"
                className="text-xs text-brand-700 no-underline hover:underline"
              >
                {t("Manage shortlist")}
              </Link>
            </div>
          </div>
          <ul className="space-y-2">
            {shortlistPros.map((pro, rankIdx) => {
              const already =
                invitedIds.includes(pro.userId) ||
                inviteHistory.some(
                  (i) =>
                    i.tradespersonId === pro.userId && i.status === "pending",
                );
              const hasBid = bids.some((b) => b.tradespersonId === pro.userId);
              const selected = shortlistSelected.includes(pro.userId);
              const disabledInvite = already || hasBid;
              return (
                <li
                  key={pro.userId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200"
                >
                  <div className="flex min-w-0 items-start gap-2">
                    {shortlistBulkOpen && (
                      <input
                        type="checkbox"
                        className="mt-1"
                        disabled={disabledInvite}
                        checked={selected}
                        onChange={() =>
                          setShortlistSelected((prev) =>
                            selected
                              ? prev.filter((x) => x !== pro.userId)
                              : [...prev, pro.userId],
                          )
                        }
                      />
                    )}
                    <div className="min-w-0">
                      <Link
                        to={`/pros/${pro.userId}`}
                        className="font-medium text-slate-900 no-underline hover:text-brand-700"
                      >
                        {pro.name || t("Pro")}
                      </Link>
                      <p className="text-xs text-slate-500 truncate max-w-md">
                        {pro.skills || "—"}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1 items-center">
                        {pro.smartScore != null && (
                          <span
                            className="rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-800 ring-1 ring-brand-200"
                            title={
                              pro.tagBoost
                                ? `Match ${pro.score} + tag boost ${pro.tagBoost}`
                                : `Match score ${pro.score}`
                            }
                          >
                            {t("Match")}{" "}{pro.smartScore}
                          </span>
                        )}
                        {!!pro.tagBoost && (
                          <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-900 ring-1 ring-amber-200">
                            +{pro.tagBoost} {t("tags")}
                          </span>
                        )}
                        {pro.responseSla && (
                          <ResponseSlaBadge sla={pro.responseSla} compact />
                        )}
                        {pro.availabilityHeat?.clean && (
                          <span
                            className={
                              pro.inviteBlockedByHeat
                                ? "rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-800 ring-1 ring-rose-200"
                                : "rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800 ring-1 ring-emerald-200"
                            }
                            title={
                              pro.inviteBlockedByHeat
                                ? pro.inviteHeatReason ||
                                  `Needs heat ≥${pro.shortlistInviteMinHeat ?? shortlistMinHeat}`
                                : `Availability heat ${pro.availabilityHeat.score}`
                            }
                          >
                            {t("Heat")}{" "}{pro.availabilityHeat.score}
                            {pro.inviteBlockedByHeat ? t(" · blocked") : ""}
                          </span>
                        )}
                        {pro.availabilityHeat && !pro.availabilityHeat.clean && (
                          <span
                            className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 ring-1 ring-slate-200"
                            title={t("This professional hasn't published a weekly schedule, so their availability is unknown.")}
                          >
                            {t("Schedule unknown")}
                          </span>
                        )}
                        {(pro.tags || []).map((tag) => (
                          <span
                            key={tag}
                            className={
                              (pro.tagHits || []).includes(tag)
                                ? "rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-950 ring-1 ring-amber-300"
                                : "rounded-full bg-white px-1.5 py-0.5 text-[10px] text-slate-600 ring-1 ring-slate-200"
                            }
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                      {pro.notes && (
                        <p className="mt-0.5 text-[11px] italic text-slate-500 truncate max-w-md">
                          “{pro.notes}”
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {hasBid ? (
                      <span className="text-[10px] uppercase tracking-wide text-violet-800 bg-violet-50 px-1.5 py-0.5 rounded-full">
                        {t("bid received")}
                      </span>
                    ) : already ? (
                      <span className="text-[10px] uppercase tracking-wide text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded-full">
                        {t("invited")}
                      </span>
                    ) : pro.inviteBlockedByHeat ? (
                      <span
                        className="max-w-36 text-right text-[10px] text-rose-700"
                        title={pro.inviteHeatReason || undefined}
                      >
                        {t("Heat below")}{" "}
                        {pro.shortlistInviteMinHeat ?? shortlistMinHeat} {t("— invite blocked")}
                      </span>
                    ) : !shortlistBulkOpen ? (
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        disabled={inviteBusy}
                        onClick={() =>
                          onInvitePro(
                            {
                              userId: pro.userId,
                              name: pro.name || null,
                              city: null,
                              skills: pro.skills || null,
                              averageRating: Number(pro.averageRating || 0),
                              reviewCount: Number(pro.reviewCount || 0),
                              score: Number(pro.score || 0),
                              breakdown: {
                                skills: 0,
                                rating: 0,
                                response: 0,
                                distance: 0,
                                total: 0,
                                skillHits: [],
                                distanceKm: null,
                                avgResponseHours: null,
                              },
                            },
                            {
                              source: "shortlist",
                              shortlistRank: rankIdx + 1,
                              smartScore: pro.smartScore,
                            },
                          )
                        }
                      >
                        {t("Invite")}
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          {shortlistBulkOpen && (
            <div className="rounded-xl border border-dashed border-brand-200 bg-brand-50/40 p-3 space-y-2">
              <p className="text-sm text-slate-700">
                {shortlistSelected.length} {t("selected")}
              </p>
              <textarea
                className="input min-h-[60px]"
                placeholder={t("Optional shared message")}
                value={shortlistBulkMsg}
                onChange={(e) => setShortlistBulkMsg(e.target.value)}
              />
              <button
                type="button"
                className="btn-primary btn-sm"
                disabled={inviteBusy || shortlistSelected.length === 0}
                onClick={confirmShortlistBulkInvite}
              >
                {inviteBusy
                  ? t("Sending…")
                  : `Invite ${shortlistSelected.length || ""} from shortlist`}
              </button>
            </div>
          )}
        </section>
      )}

      {shortlistFunnel && shortlistFunnel.ranked > 0 && (
        <ShortlistFunnelPanel funnel={shortlistFunnel} />
      )}
    </>
  );
}
