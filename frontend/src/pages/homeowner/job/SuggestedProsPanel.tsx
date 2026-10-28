import { RatingStar } from "../../../components/ui/RatingStar";
import { Link } from "react-router-dom";
import { type Job } from "../../../api/jobs";
import { ResponseSlaBadge } from "../../../components/ui/ResponseSlaBadge";
import { Countdown } from "../../../components/Countdown";
import { InviteHistoryList } from "./InviteHistoryList";
import { Send, Users, Info, BarChart3 } from "lucide-react";
import { upsertTextTemplate } from "../../../lib/textTemplates";
import type { JobDetailState } from "./useJobDetail";
import { t, tf, plural } from "../../../lib/i18n";

import { errorText } from "../../../lib/apiErrors";
import { fmtTime } from "../../../lib/format";
export function SuggestedProsPanel({
  s,
  job,
}: {
  s: JobDetailState;
  job: Job;
}) {
  const {
    bulkConfirmOpen,
    bulkMessage,
    bulkMode,
    confirmBulkInvite,
    confirmInvite,
    cooldownByPro,
    error,
    inviteAnalytics,
    inviteBusy,
    inviteHistory,
    inviteMessage,
    inviteQuota,
    inviteTemplates,
    invitedIds,
    invitingProId,
    nowTick,
    onInvitePro,
    selectedInviteIds,
    setBulkConfirmOpen,
    setBulkMessage,
    setBulkMode,
    setInviteMessage,
    setInviteRank,
    setInviteSmartScore,
    setInviteSource,
    setInvitingProId,
    setScorePro,
    setSelectedInviteIds,
    setTplLabel,
    success,
    suggestedPros,
    toggleSelectPro,
    tplLabel,
    updateProfile,
  } = s;
  return (
    <>
      {job.status === "open" &&
        (suggestedPros.length > 0 || inviteHistory.length > 0) && (
          <section className="card p-4 sm:p-6 space-y-4">
            {suggestedPros.length > 0 && (
              <>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-semibold">{t("Suggested pros")}</h2>
                    <p className="text-xs text-slate-500 mb-1">
                      {t("Ranked by skills ∩ category, rating, response time, and distance (max 100). Invite sends an in-app notification.")}
                      {inviteQuota && (
                        <>
                          {" "}
                          · {inviteQuota.used}/{inviteQuota.limit} {t("invites used")}
                        </>
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={
                      bulkMode ? "btn-primary btn-sm" : "btn-secondary btn-sm"
                    }
                    onClick={() => {
                      setBulkMode((v) => !v);
                      setBulkConfirmOpen(false);
                      setSelectedInviteIds([]);
                    }}
                  >
                    <Users className="h-3.5 w-3.5" />
                    {bulkMode ? t("Cancel multi") : t("Invite multiple")}
                  </button>
                </div>
                <ul className="space-y-3">
                  {suggestedPros.map((p) => {
                    const already = invitedIds.includes(p.userId);
                    const cool = cooldownByPro.get(p.userId);
                    const coolMs = cool?.cooldownUntil
                      ? Math.max(
                          0,
                          new Date(cool.cooldownUntil).getTime() - nowTick,
                        )
                      : 0;
                    const inCool = coolMs > 0;
                    const selected = selectedInviteIds.includes(p.userId);
                    const disabledInvite = already || inCool;
                    return (
                      <li
                        key={p.userId}
                        className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200"
                      >
                        <div className="min-w-0 flex-1 flex gap-2">
                          {bulkMode && (
                            <input
                              type="checkbox"
                              className="mt-1"
                              checked={selected}
                              disabled={disabledInvite}
                              onChange={() => toggleSelectPro(p.userId)}
                              aria-label={tf("Select {pro}", { pro: p.name || "pro" })}
                            />
                          )}
                          <div className="min-w-0">
                            <Link
                              to={`/pros/${p.userId}`}
                              className="font-semibold text-slate-900 no-underline hover:text-brand-700"
                            >
                              {p.name || t("Verified pro")}
                            </Link>
                            <p className="mt-0.5 text-xs text-slate-500">
                              {[p.city, p.skills].filter(Boolean).join(" · ") ||
                                "—"}
                            </p>
                            <p className="mt-1 text-[11px] text-slate-500">
                              <RatingStar className="mr-0.5" />
                              {p.averageRating.toFixed(1)} ({p.reviewCount})
                              {p.breakdown.distanceKm != null && (
                                <> · ~{p.breakdown.distanceKm} {t("km")}</>
                              )}
                              {p.breakdown.avgResponseHours != null && (
                                <>
                                  {" "}
                                  · ~{p.breakdown.avgResponseHours}{t("h response")}
                                </>
                              )}
                              {p.responseSla && (
                                <span className="ml-2 inline-flex align-middle">
                                  <ResponseSlaBadge
                                    sla={p.responseSla}
                                    compact
                                  />
                                </span>
                              )}
                            </p>
                            {inCool && (
                              <p className="mt-1 text-[11px] font-medium text-amber-800">
                                {t("Cooldown · retry in")}{" "}
                                <Countdown until={cool!.cooldownUntil!} />
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="text-right rounded-lg px-1.5 py-0.5 hover:bg-white/80 focus:outline-hidden focus:ring-2 focus:ring-brand-300"
                            onClick={() => setScorePro(p)}
                            title={t("Explain match score (sk/rt/rs/ds)")}
                          >
                            <p className="text-2xl font-bold text-brand-800">
                              {(p.rankedScore ?? p.score).toFixed(0)}
                            </p>
                            <p className="text-[10px] uppercase tracking-wide text-slate-500 flex items-center justify-end gap-0.5">
                              {t("match")}{" "}<Info className="h-3 w-3" />
                            </p>
                            {(p.heatBoost != null && p.heatBoost > 0) ||
                            p.availabilityHeat?.clean ? (
                              <p className="text-[10px] text-emerald-700">
                                {p.heatBoost ? tf("+{heatBoost} heat", { heatBoost: p.heatBoost }) : t("heat")}
                                {p.availabilityHeat?.clean
                                  ? ` · ${p.availabilityHeat.score}`
                                  : ""}
                              </p>
                            ) : (
                              <p className="text-[10px] text-slate-500" title={t("No weekly schedule published")}>
                                {t("schedule unknown")}
                              </p>
                            )}
                          </button>
                          {!bulkMode && (
                            <button
                              type="button"
                              className="btn-secondary btn-sm touch-target"
                              disabled={disabledInvite}
                              onClick={() => onInvitePro(p)}
                              title={
                                already
                                  ? t("Already invited")
                                  : inCool
                                    ? tf("Cooldown until {time}", { time: fmtTime(cool!.cooldownUntil!) })
                                    : t("Invite to bid")
                              }
                            >
                              <Send className="h-3.5 w-3.5" />
                              {already
                                ? t("Invited")
                                : inCool
                                  ? t("Cooldown")
                                  : t("Invite")}
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>

                {bulkMode && (
                  <div className="rounded-xl bg-brand-50 p-3 ring-1 ring-brand-100 space-y-3">
                    <p className="text-sm font-medium text-brand-950">
                      {plural(selectedInviteIds.length, "{n} pro selected", "{n} pros selected")}
                      {inviteQuota
                        ? tf(" · {remaining} invites left on this job", { remaining: inviteQuota.remaining })
                        : ""}
                    </p>
                    {!bulkConfirmOpen ? (
                      <button
                        type="button"
                        className="btn-primary btn-sm"
                        disabled={selectedInviteIds.length === 0 || inviteBusy}
                        onClick={() => setBulkConfirmOpen(true)}
                      >
                        {t("Continue…")}
                      </button>
                    ) : (
                      <>
                        <div>
                          <p className="label">
                            {t("Optional shared message")}
                          </p>
                          <div className="mb-2 flex flex-wrap gap-1.5">
                            {inviteTemplates.slice(0, 6).map((tpl) => (
                              <button
                                key={`b-${tpl.id}`}
                                type="button"
                                className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-brand-800 ring-1 ring-brand-200 hover:bg-brand-50"
                                onClick={() => setBulkMessage(tpl.body)}
                              >
                                {t(tpl.label)}
                              </button>
                            ))}
                          </div>
                          <textarea
                            aria-label={t("Optional shared message")}
                            className="input min-h-[72px]"
                            maxLength={500}
                            placeholder={t("Optional note for all selected pros")}
                            value={bulkMessage}
                            onChange={(e) => setBulkMessage(e.target.value)}
                          />
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="btn-primary btn-sm"
                            disabled={
                              inviteBusy || selectedInviteIds.length === 0
                            }
                            onClick={confirmBulkInvite}
                          >
                            {inviteBusy
                              ? t("Sending…")
                              : plural(selectedInviteIds.length, "Send {n} invite", "Send {n} invites")}
                          </button>
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            disabled={inviteBusy}
                            onClick={() => setBulkConfirmOpen(false)}
                          >
                            {t("Back")}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {invitingProId && !bulkMode && (
                  <div className="rounded-xl bg-brand-50 p-3 ring-1 ring-brand-100 space-y-3">
                    <p className="text-sm font-medium text-brand-950">
                      {t("Invite")}{" "}
                      {suggestedPros.find((x) => x.userId === invitingProId)
                        ?.name || t("pro")}{" "}
                      {t("to bid?")}
                    </p>
                    <div>
                      <p className="label">{t("Optional message")}</p>
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        {inviteTemplates.slice(0, 8).map((tpl) => (
                          <button
                            key={tpl.id}
                            type="button"
                            className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-brand-800 ring-1 ring-brand-200 hover:bg-brand-50"
                            onClick={() => setInviteMessage(tpl.body)}
                            title={tpl.body}
                          >
                            {t(tpl.label)}
                          </button>
                        ))}
                      </div>
                      <textarea
                        aria-label={t("Optional message")}
                        className="input min-h-[72px]"
                        maxLength={500}
                        placeholder={t("e.g. Flexible on timing, need someone this week")}
                        value={inviteMessage}
                        onChange={(e) => setInviteMessage(e.target.value)}
                      />
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <input
                          aria-label={t("Template label")}
                          className="input py-1.5! text-xs max-w-[140px]"
                          placeholder={t("Template label")}
                          value={tplLabel}
                          onChange={(e) => setTplLabel(e.target.value)}
                        />
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          disabled={!inviteMessage.trim()}
                          onClick={async () => {
                            if (!inviteMessage.trim()) return;
                            try {
                              await updateProfile({
                                inviteTemplates: upsertTextTemplate(
                                  inviteTemplates,
                                  {
                                    label: tplLabel.trim() || "Saved",
                                    body: inviteMessage,
                                  },
                                  "tpl",
                                ),
                              });
                              setTplLabel("");
                              success(t("Invite template saved"));
                            } catch (e) {
                              error(
                                errorText(e, "Couldn't save template"),
                              );
                            }
                          }}
                        >
                          {t("Save template")}
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn-primary btn-sm touch-target"
                        disabled={inviteBusy}
                        onClick={confirmInvite}
                      >
                        {inviteBusy ? t("Sending…") : t("Send invite")}
                      </button>
                      <button
                        type="button"
                        className="btn-ghost btn-sm touch-target"
                        disabled={inviteBusy}
                        onClick={() => {
                          setInvitingProId(null);
                          setInviteSource("suggested");
                          setInviteRank(null);
                          setInviteSmartScore(null);
                          setInviteMessage("");
                        }}
                      >
                        {t("Cancel")}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {inviteAnalytics && inviteAnalytics.sent > 0 && (
              <div
                className={
                  suggestedPros.length > 0
                    ? "border-t border-slate-100 pt-4"
                    : ""
                }
              >
                <div className="flex items-center gap-2 mb-2">
                  <BarChart3 className="h-4 w-4 text-brand-700" />
                  <h3 className="text-sm font-semibold text-slate-900">
                    {t("Invite analytics")}
                  </h3>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { label: "Sent", value: inviteAnalytics.sent },
                    {
                      label: "Declined",
                      value: inviteAnalytics.declined,
                      sub: `${inviteAnalytics.declineRate}%`,
                    },
                    {
                      label: "Opened",
                      value: inviteAnalytics.opened,
                      sub: `${inviteAnalytics.openRate}%`,
                    },
                    {
                      label: "Bid after",
                      value: inviteAnalytics.bidAfterInvite,
                      sub: `${inviteAnalytics.bidRate}%`,
                    },
                  ].map((c) => (
                    <div
                      key={c.label}
                      className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200"
                    >
                      <p className="text-[10px] uppercase tracking-wide text-slate-500">
                        {t(c.label)}
                      </p>
                      <p className="text-xl font-bold text-slate-900">
                        {c.value}
                      </p>
                      {"sub" in c && c.sub ? (
                        <p className="text-[11px] text-slate-500">{c.sub}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-slate-500">
                  {t("Opened ≈ notification read or deep-link visit · Click-ish tracked when pros open the invite job link")}
                </p>
              </div>
            )}

            {inviteHistory.length > 0 && (
              <div
                className={
                  suggestedPros.length > 0 ||
                  (inviteAnalytics && inviteAnalytics.sent > 0)
                    ? "border-t border-slate-100 pt-4"
                    : ""
                }
              >
                <InviteHistoryList
                  invites={inviteHistory}
                  quota={inviteQuota}
                  now={nowTick}
                />
              </div>
            )}
          </section>
        )}
    </>
  );
}
