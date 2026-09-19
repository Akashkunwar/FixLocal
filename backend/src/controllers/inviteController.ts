import type { Request, Response } from "express";
import { In } from "typeorm";
import { AppDataSource } from "../data-source";
import { Job, JobStatus } from "../entities/Job";
import { Bid } from "../entities/Bid";
import { User, UserRole } from "../entities/User";
import { JobInvite } from "../entities/JobInvite";
import { NotificationType } from "../entities/Notification";
import { Notification } from "../entities/Notification";
import { Favorite, FavoriteTargetType } from "../entities/Favorite";
import { TradespersonProfile, VerificationStatus } from "../entities/TradespersonProfile";
import { createNotification } from "../utils/notifications";
import {
  buildAvailabilityHeat,
  DEFAULT_SHORTLIST_INVITE_MIN_HEAT,
  shortlistInviteBlockedByHeat,
} from "../utils/availabilityHeat";
import { assertOwnerOrAdmin, loadJobContext, type JobContext } from "../policies/jobPolicy";
import { viewer } from "./jobController";
import { badRequest, conflict, forbidden, HttpError, notFound, tooMany } from "../http/errors";
import { rate, round1 } from "../domain/analytics";

export const INVITE_COOLDOWN_MS = 60 * 60 * 1000;
export const MAX_INVITES_PER_JOB = 20;

const inviteRepo = () => AppDataSource.getRepository(JobInvite);

const REASON_LABEL: Record<string, string> = {
  busy: "Busy / fully booked",
  schedule: "Schedule conflict",
  too_far: "Too far",
  rate: "Rate mismatch",
  specialty: "Not my specialty",
  other: "Other",
};

function cooldownInfo(inv: JobInvite, now = Date.now()) {
  if (inv.status !== "declined" || !inv.declinedAt) {
    return { inCooldown: false, remainingMs: 0, cooldownUntil: null as string | null };
  }
  const until = new Date(inv.declinedAt).getTime() + INVITE_COOLDOWN_MS;
  const remainingMs = Math.max(0, until - now);
  return {
    inCooldown: remainingMs > 0,
    remainingMs,
    cooldownUntil: remainingMs > 0 ? new Date(until).toISOString() : null,
  };
}

type InviteOptions = {
  tradespersonId: string;
  message?: string;
  source: string;
  shortlistRank?: number | null;
  smartScore?: number | null;
  /** Client-requested gate; only ever makes the default stricter. */
  minHeat?: number | null;
  actorId: string;
};

type InviteResult = { invite: JobInvite; notificationId: string | null; softSkippedCategory: boolean };

/** Shared by single and bulk invites. Throws HttpError with a specific code on refusal. */
async function invitePro(ctx: JobContext, opts: InviteOptions): Promise<InviteResult> {
  const job = ctx.job;
  const profile = await AppDataSource.getRepository(TradespersonProfile).findOne({
    where: { userId: opts.tradespersonId },
    relations: ["user"],
  });
  if (
    !profile ||
    profile.verificationStatus !== VerificationStatus.VERIFIED ||
    profile.user?.role !== UserRole.TRADESPERSON ||
    profile.user.isSuspended ||
    profile.user.deletedAt
  ) {
    throw notFound("Verified professional not found", "PRO_NOT_FOUND");
  }
  const softSkippedCategory = (profile.notInterestedCategories || [])
    .map((c) => String(c).toLowerCase())
    .includes(String(job.category).toLowerCase());

  // The availability gate applies when the pro is on the client's shortlist (decided server-side).
  const onShortlist = await AppDataSource.getRepository(Favorite).exists({
    where: { userId: job.homeownerId, targetType: FavoriteTargetType.PRO, targetId: opts.tradespersonId },
  });
  if (onShortlist) {
    const heat = buildAvailabilityHeat(profile.weeklyAvailability, profile.blockedDates, profile.user.timezone);
    const gate = shortlistInviteBlockedByHeat(heat, Math.max(DEFAULT_SHORTLIST_INVITE_MIN_HEAT, opts.minHeat ?? 0));
    if (gate.blocked) {
      throw badRequest(gate.reason || "Availability too low for a shortlist invite", "SHORTLIST_HEAT_TOO_LOW", {
        minHeat: gate.minHeat,
        availabilityHeat: heat,
      });
    }
  }

  const invite = await AppDataSource.transaction(async (m) => {
    await m.query(`SELECT "id" FROM "jobs" WHERE "id" = $1 FOR UPDATE`, [job.id]);
    const existing = await m.findOne(JobInvite, { where: { jobId: job.id, tradespersonId: opts.tradespersonId } });
    if (existing?.status === "pending") {
      throw conflict("This professional was already invited to this job", "ALREADY_INVITED", {
        inviteId: existing.id,
        invitedAt: existing.lastInvitedAt,
      });
    }
    if (existing) {
      const cool = cooldownInfo(existing);
      if (cool.inCooldown) {
        const mins = Math.ceil(cool.remainingMs / 60000);
        throw tooMany(`Professional declined recently — try again in ~${mins} min`, "INVITE_COOLDOWN", {
          retryAfterMinutes: mins,
          retryAfterMs: cool.remainingMs,
          cooldownUntil: cool.cooldownUntil,
          declinedAt: existing.declinedAt,
        });
      }
    }
    const usedRows: { used: string | null }[] = await m.query(
      `SELECT COALESCE(SUM("inviteCount"), 0) AS used FROM "job_invites" WHERE "jobId" = $1`,
      [job.id]
    );
    const used = Number(usedRows[0]?.used || 0);
    if (used >= MAX_INVITES_PER_JOB) {
      throw tooMany(`Invite limit reached for this job (${MAX_INVITES_PER_JOB})`, "INVITE_RATE_LIMIT", {
        limit: MAX_INVITES_PER_JOB,
        used,
      });
    }
    const now = new Date();
    const fields = {
      invitedByUserId: opts.actorId,
      message: opts.message || null,
      source: opts.source,
      shortlistRank: opts.source === "shortlist" ? opts.shortlistRank ?? null : null,
      smartScore: opts.smartScore ?? null,
      status: "pending" as const,
      lastInvitedAt: now,
      declineReason: null,
      declineNote: null,
      declinedAt: null,
    };
    if (existing) {
      await m.update(JobInvite, { id: existing.id }, { ...fields, inviteCount: existing.inviteCount + 1 });
      return m.findOneOrFail(JobInvite, { where: { id: existing.id } });
    }
    return m.save(m.create(JobInvite, { ...fields, jobId: job.id, tradespersonId: opts.tradespersonId, inviteCount: 1 }));
  });

  const homeowner = await AppDataSource.getRepository(User).findOne({ where: { id: job.homeownerId } });
  const parts = [
    `${homeowner?.name || "A client"} invited you to bid on "${job.title}" (${job.category}${job.city ? ` · ${job.city}` : ""}).`,
  ];
  if (opts.message) parts.push(`Message: ${opts.message}`);
  const notification = await createNotification({
    userId: opts.tradespersonId,
    type: NotificationType.MATCH,
    title: "Job invite",
    body: parts.join(" "),
    link: `/professional/jobs/${job.id}?invite=1#bid-form`,
    meta: { jobId: job.id, inviteId: invite.id, invite: true, source: opts.source },
  });
  if (notification) await inviteRepo().update({ id: invite.id }, { notificationId: notification.id });
  return { invite, notificationId: notification?.id ?? null, softSkippedCategory };
}

function assertInvitable(ctx: JobContext) {
  if (ctx.job.status !== JobStatus.OPEN && ctx.job.status !== JobStatus.BIDDING_CLOSED) {
    throw badRequest("Invites are only for open jobs", "INVALID_STATUS");
  }
}

export async function inviteSuggestedPro(req: Request, res: Response) {
  const ctx = await loadJobContext(req.valid.params.id);
  assertOwnerOrAdmin(ctx, viewer(req), "Only the client can invite professionals");
  assertInvitable(ctx);
  const b = req.valid.body;
  const result = await invitePro(ctx, {
    tradespersonId: b.tradespersonId,
    message: b.message,
    source: b.source,
    shortlistRank: b.shortlistRank,
    smartScore: b.smartScore,
    minHeat: b.minHeat,
    actorId: req.user!.id,
  });
  return res.json({
    ok: true,
    jobId: ctx.job.id,
    tradespersonId: b.tradespersonId,
    inviteId: result.invite.id,
    notificationId: result.notificationId,
    softSkippedCategory: result.softSkippedCategory,
    source: b.source,
    shortlistRank: result.invite.shortlistRank ?? null,
    message: result.notificationId
      ? result.softSkippedCategory
        ? "Invite sent (this professional marked the category as not interested — they may decline)."
        : "Invite sent — the professional will see an in-app notification."
      : "Invite recorded (the professional has match notifications turned off).",
  });
}

export async function bulkInviteSuggestedPros(req: Request, res: Response) {
  const ctx = await loadJobContext(req.valid.params.id);
  assertOwnerOrAdmin(ctx, viewer(req), "Only the client can invite professionals");
  assertInvitable(ctx);
  const b = req.valid.body;
  const ids = [...new Set<string>(b.tradespersonIds)];
  type Row = {
    tradespersonId: string;
    ok: boolean;
    code?: string;
    message: string;
    inviteId?: string;
    notificationId?: string | null;
    cooldownUntil?: string | null;
    retryAfterMs?: number;
  };
  const results: Row[] = [];
  let stoppedForRateLimit = false;
  for (const tradespersonId of ids) {
    if (stoppedForRateLimit) {
      results.push({ tradespersonId, ok: false, code: "SKIPPED", message: "Skipped — invite limit reached earlier in this batch" });
      continue;
    }
    try {
      const r = await invitePro(ctx, {
        tradespersonId,
        message: b.message,
        source: b.source,
        shortlistRank: b.shortlistRanks?.[tradespersonId],
        smartScore: b.smartScores?.[tradespersonId],
        minHeat: b.minHeat,
        actorId: req.user!.id,
      });
      results.push({
        tradespersonId,
        ok: true,
        inviteId: r.invite.id,
        notificationId: r.notificationId,
        message: r.notificationId ? "Invite sent" : "Invite recorded (notifications off)",
      });
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
      if (err.code === "INVITE_RATE_LIMIT") stoppedForRateLimit = true;
      results.push({
        tradespersonId,
        ok: false,
        code: err.code,
        message: err.message,
        cooldownUntil: (err.details?.cooldownUntil as string) ?? null,
        retryAfterMs: err.details?.retryAfterMs as number | undefined,
      });
    }
  }
  const sent = results.filter((r) => r.ok).length;
  const failed = results.length - sent;
  return res.json({
    ok: sent > 0,
    jobId: ctx.job.id,
    sent,
    failed,
    stoppedForRateLimit,
    results,
    message:
      sent === 0
        ? failed
          ? "No invites sent — see per-professional results"
          : "Nothing to send"
        : `Sent ${sent} invite${sent === 1 ? "" : "s"}${failed ? ` · ${failed} skipped` : ""}`,
  });
}

export async function declineJobInvite(req: Request, res: Response) {
  const ctx = await loadJobContext(req.valid.params.id);
  const invite = await inviteRepo().findOne({ where: { jobId: ctx.job.id, tradespersonId: req.user!.id } });
  if (!invite || invite.status !== "pending") throw notFound("No pending invite for this job", "NO_INVITE");
  const { note, reason } = req.valid.body;
  const now = new Date();
  await inviteRepo().update(
    { id: invite.id },
    { status: "declined", declinedAt: now, declineReason: reason ?? null, declineNote: note || null, clickedAt: invite.clickedAt ?? now }
  );
  if (invite.notificationId) {
    await AppDataSource.getRepository(Notification).update({ id: invite.notificationId }, { read: true });
  }
  const pro = await AppDataSource.getRepository(User).findOne({ where: { id: req.user!.id } });
  const detail = [reason ? REASON_LABEL[reason] : null, note].filter(Boolean);
  await createNotification({
    userId: ctx.job.homeownerId,
    type: NotificationType.MATCH,
    title: "Invite declined",
    body: detail.length
      ? `${pro?.name || "A professional"} declined your invite on "${ctx.job.title}". ${detail.join(" — ")}`
      : `${pro?.name || "A professional"} declined your invite on "${ctx.job.title}". They may still bid later.`,
    link: `/client/jobs/${ctx.job.id}`,
    meta: { jobId: ctx.job.id, inviteDeclined: true, fromUserId: req.user!.id, reason: reason ?? null },
  });
  return res.json({ ok: true, jobId: ctx.job.id, reason: reason ?? null, message: "Invite declined — the client was notified." });
}

export async function markInviteOpened(req: Request, res: Response) {
  const ctx = await loadJobContext(req.valid.params.id);
  const invite = await inviteRepo().findOne({ where: { jobId: ctx.job.id, tradespersonId: req.user!.id } });
  if (!invite) throw notFound("No invite found for this job", "NO_INVITE");
  const now = new Date();
  const firstOpen = !invite.openedAt;
  await inviteRepo().update({ id: invite.id }, { openedAt: invite.openedAt ?? now, clickedAt: now });
  if (invite.notificationId) {
    await AppDataSource.getRepository(Notification).update({ id: invite.notificationId }, { read: true });
  }
  return res.json({
    ok: true,
    inviteId: invite.id,
    notificationId: invite.notificationId,
    openedAt: invite.openedAt ?? now,
    clickedAt: now,
    firstOpen,
  });
}

async function bidsFor(jobIds: string[], proIds: string[]) {
  if (!jobIds.length || !proIds.length) return [];
  return AppDataSource.getRepository(Bid).find({
    where: { jobId: In(jobIds), tradespersonId: In(proIds) },
    select: { id: true, jobId: true, tradespersonId: true, createdAt: true },
  });
}

/** A bid counts as "after invite" only if it was placed once the first invite went out. */
function bidAfterInviteSet(invites: JobInvite[], bids: Pick<Bid, "jobId" | "tradespersonId" | "createdAt">[]) {
  const firstInvite = new Map(invites.map((i) => [`${i.jobId}:${i.tradespersonId}`, new Date(i.createdAt).getTime()]));
  const out = new Set<string>();
  for (const b of bids) {
    const key = `${b.jobId}:${b.tradespersonId}`;
    const at = firstInvite.get(key);
    if (at !== undefined && new Date(b.createdAt).getTime() >= at) out.add(key);
  }
  return out;
}

export async function listJobInvites(req: Request, res: Response) {
  const ctx = await loadJobContext(req.valid.params.id);
  assertOwnerOrAdmin(ctx, viewer(req), "Only the client can view invites");
  const rows = await inviteRepo().find({ where: { jobId: ctx.job.id }, order: { lastInvitedAt: "DESC" } });
  const userIds = [...new Set(rows.flatMap((r) => [r.tradespersonId, r.invitedByUserId]))];
  const users = userIds.length
    ? await AppDataSource.getRepository(User).find({ where: { id: In(userIds) }, select: { id: true, name: true } })
    : [];
  const names = new Map(users.map((u) => [u.id, u.name ?? null]));
  const after = bidAfterInviteSet(rows, await bidsFor([ctx.job.id], rows.map((r) => r.tradespersonId)));
  const used = rows.reduce((s, r) => s + r.inviteCount, 0);
  return res.json({
    jobId: ctx.job.id,
    invites: rows.map((r) => {
      const cool = cooldownInfo(r);
      return {
        id: r.id,
        tradespersonId: r.tradespersonId,
        tradespersonName: names.get(r.tradespersonId) ?? null,
        invitedByUserId: r.invitedByUserId,
        invitedByName: names.get(r.invitedByUserId) ?? null,
        invitedAt: r.lastInvitedAt,
        firstInvitedAt: r.createdAt,
        inviteCount: r.inviteCount,
        status: r.status,
        declinedAt: r.declinedAt ?? null,
        declineNote: r.declineNote ?? null,
        declineReason: r.declineReason ?? null,
        message: r.message ?? null,
        source: r.source,
        cooldownUntil: cool.cooldownUntil,
        cooldownRemainingMs: cool.remainingMs,
        inCooldown: cool.inCooldown,
        opened: !!(r.openedAt || r.clickedAt),
        openedAt: r.openedAt ?? null,
        clickedAt: r.clickedAt ?? null,
        bidAfterInvite: after.has(`${r.jobId}:${r.tradespersonId}`),
      };
    }),
    used,
    limit: MAX_INVITES_PER_JOB,
    remaining: Math.max(0, MAX_INVITES_PER_JOB - used),
  });
}

function summarize(rows: JobInvite[], after: Set<string>) {
  let sent = 0;
  let declined = 0;
  let opened = 0;
  let clicked = 0;
  let bidAfterInvite = 0;
  const declineReasons: Record<string, number> = {};
  for (const r of rows) {
    sent += r.inviteCount;
    if (r.status === "declined") {
      declined += 1;
      const reason = r.declineReason || "unspecified";
      declineReasons[reason] = (declineReasons[reason] || 0) + 1;
    }
    if (r.openedAt || r.clickedAt) opened += 1;
    if (r.clickedAt) clicked += 1;
    if (after.has(`${r.jobId}:${r.tradespersonId}`)) bidAfterInvite += 1;
  }
  const pros = rows.length;
  return {
    sent,
    uniquePros: pros,
    pending: rows.filter((r) => r.status === "pending").length,
    declined,
    opened,
    clicked,
    bidAfterInvite,
    openRate: rate(opened, pros),
    bidRate: rate(bidAfterInvite, pros),
    declineRate: rate(declined, pros),
    declineReasons,
  };
}

export async function getJobInviteAnalytics(req: Request, res: Response) {
  const ctx = await loadJobContext(req.valid.params.id);
  assertOwnerOrAdmin(ctx, viewer(req), "Only the client can view invite analytics");
  const rows = await inviteRepo().find({ where: { jobId: ctx.job.id } });
  const after = bidAfterInviteSet(rows, await bidsFor([ctx.job.id], rows.map((r) => r.tradespersonId)));
  const s = summarize(rows, after);
  return res.json({
    jobId: ctx.job.id,
    ...s,
    limit: MAX_INVITES_PER_JOB,
    remaining: Math.max(0, MAX_INVITES_PER_JOB - s.sent),
  });
}

function ownerIdFor(req: Request): string {
  const requested = req.valid.query.homeownerId as string | undefined;
  if (requested && requested !== req.user!.id) {
    if (req.user!.role !== UserRole.ADMIN) throw forbidden();
    return requested;
  }
  return req.user!.id;
}

export async function getHomeownerInviteAnalytics(req: Request, res: Response) {
  const homeownerId = ownerIdFor(req);
  const jobs = await AppDataSource.getRepository(Job).find({
    where: { homeownerId },
    select: { id: true, title: true, status: true, category: true },
  });
  const jobIds = jobs.map((j) => j.id);
  const rows = jobIds.length ? await inviteRepo().find({ where: { jobId: In(jobIds) } }) : [];
  const after = bidAfterInviteSet(rows, await bidsFor(jobIds, [...new Set(rows.map((r) => r.tradespersonId))]));
  const byJob = jobs
    .map((j) => {
      const jr = rows.filter((r) => r.jobId === j.id);
      if (!jr.length) return null;
      const s = summarize(jr, after);
      return {
        jobId: j.id,
        title: j.title,
        status: j.status,
        category: j.category,
        sent: s.sent,
        declined: s.declined,
        opened: s.opened,
        clicked: s.clicked,
        bidAfterInvite: s.bidAfterInvite,
      };
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => b.sent - a.sent);
  const s = summarize(rows, after);
  return res.json({ homeownerId, jobs: byJob.length, ...s, byJob });
}

async function shortlistIds(homeownerId: string) {
  const favs = await AppDataSource.getRepository(Favorite).find({
    where: { userId: homeownerId, targetType: FavoriteTargetType.PRO },
    order: { createdAt: "DESC" },
  });
  return favs;
}

export async function getShortlistInviteAnalytics(req: Request, res: Response) {
  const ctx = await loadJobContext(req.valid.params.id);
  assertOwnerOrAdmin(ctx, viewer(req), "Only the client can view shortlist analytics");
  const favs = await shortlistIds(ctx.job.homeownerId);
  const favSet = new Set(favs.map((f) => f.targetId));
  const favOrder = new Map(favs.map((f, i) => [f.targetId, i + 1]));
  const rows = (await inviteRepo().find({ where: { jobId: ctx.job.id } })).filter(
    (r) => r.source === "shortlist" || favSet.has(r.tradespersonId)
  );
  const after = bidAfterInviteSet(rows, await bidsFor([ctx.job.id], rows.map((r) => r.tradespersonId)));
  const users = rows.length
    ? await AppDataSource.getRepository(User).find({
        where: { id: In(rows.map((r) => r.tradespersonId)) },
        select: { id: true, name: true },
      })
    : [];
  const names = new Map(users.map((u) => [u.id, u.name || "Professional"]));

  const ranked = favs.length;
  const invited = rows.length;
  const bidAfter = rows.filter((r) => after.has(`${r.jobId}:${r.tradespersonId}`)).length;
  const byRankMap = new Map<number, { rank: number; invited: number; bidAfter: number; names: string[] }>();
  const ranksWithBid: number[] = [];
  for (const r of rows) {
    const rank = r.shortlistRank ?? favOrder.get(r.tradespersonId) ?? 99;
    const bucket = byRankMap.get(rank) || { rank, invited: 0, bidAfter: 0, names: [] };
    bucket.invited += 1;
    bucket.names.push(names.get(r.tradespersonId) || "Professional");
    if (after.has(`${r.jobId}:${r.tradespersonId}`)) {
      bucket.bidAfter += 1;
      ranksWithBid.push(rank);
    }
    byRankMap.set(rank, bucket);
  }
  const inviteRate = rate(invited, ranked);
  const bidRate = rate(bidAfter, invited);
  return res.json({
    jobId: ctx.job.id,
    ranked,
    invited,
    bidAfter,
    inviteRate,
    bidRate,
    overallRate: rate(bidAfter, ranked),
    avgRankBid: ranksWithBid.length ? round1(ranksWithBid.reduce((a, b) => a + b, 0) / ranksWithBid.length) : null,
    funnel: [
      { stage: "ranked", label: "On shortlist", count: ranked, rate: ranked ? 100 : 0 },
      { stage: "invited", label: "Invited", count: invited, rate: inviteRate },
      { stage: "bid", label: "Bid after invite", count: bidAfter, rate: bidRate },
    ],
    byRank: [...byRankMap.values()].sort((a, b) => a.rank - b.rank),
    sourceTagged: rows.some((r) => r.source === "shortlist"),
  });
}

export async function getHomeownerShortlistInviteAnalytics(req: Request, res: Response) {
  const homeownerId = ownerIdFor(req);
  const favs = await shortlistIds(homeownerId);
  const favSet = new Set(favs.map((f) => f.targetId));
  const jobs = await AppDataSource.getRepository(Job).find({
    where: { homeownerId },
    select: { id: true, title: true, status: true },
  });
  const jobIds = jobs.map((j) => j.id);
  const rows = jobIds.length
    ? (await inviteRepo().find({ where: { jobId: In(jobIds) } })).filter(
        (r) => r.source === "shortlist" || favSet.has(r.tradespersonId)
      )
    : [];
  const after = bidAfterInviteSet(rows, await bidsFor(jobIds, [...new Set(rows.map((r) => r.tradespersonId))]));
  const ranked = favs.length;
  const invited = rows.length;
  const bidAfter = rows.filter((r) => after.has(`${r.jobId}:${r.tradespersonId}`)).length;
  const byJob = jobs
    .map((j) => {
      const jr = rows.filter((r) => r.jobId === j.id);
      return {
        jobId: j.id,
        title: j.title,
        status: j.status,
        invited: jr.length,
        bidAfter: jr.filter((r) => after.has(`${r.jobId}:${r.tradespersonId}`)).length,
      };
    })
    .filter((j) => j.invited > 0)
    .sort((a, b) => b.invited - a.invited);
  const inviteRate = rate(invited, ranked);
  const bidRate = rate(bidAfter, invited);
  return res.json({
    homeownerId,
    ranked,
    invited,
    bidAfter,
    inviteRate,
    bidRate,
    overallRate: rate(bidAfter, ranked),
    jobs: byJob.length,
    byJob,
    funnel: [
      { stage: "ranked", label: "On shortlist", count: ranked, rate: ranked ? 100 : 0 },
      { stage: "invited", label: "Invited (jobs × pros)", count: invited, rate: inviteRate },
      { stage: "bid", label: "Bid after invite", count: bidAfter, rate: bidRate },
    ],
  });
}

/** First invite time per pro for a job (invite→bid response SLA). */
export async function firstInviteTimes(jobId: string): Promise<Map<string, Date>> {
  const rows = await inviteRepo().find({ where: { jobId }, select: { tradespersonId: true, createdAt: true } });
  return new Map(rows.map((r) => [r.tradespersonId, new Date(r.createdAt)]));
}
