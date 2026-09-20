import type { Request, Response } from "express";
import { In, Not } from "typeorm";
import { AppDataSource } from "../data-source";
import { Bid, BidStatus } from "../entities/Bid";
import { Job, JobStatus, PaymentStatus, ScheduleStatus } from "../entities/Job";
import { User, UserRole } from "../entities/User";
import { TradespersonProfile, VerificationStatus } from "../entities/TradespersonProfile";
import { Favorite, FavoriteTargetType } from "../entities/Favorite";
import { Notification, NotificationType } from "../entities/Notification";
import { UploadKind } from "../entities/Upload";
import { invalidateOpenJobsCache } from "../utils/cache";
import { createNotification, createNotifications } from "../utils/notifications";
import { revokeThreadStreams } from "../utils/sse";
import { haversineKm } from "../utils/geo";
import { scoreProForJob, type ScoreablePro } from "../utils/matchScore";
import { computeHeatBoost, getBestValueBlend, getHeatWeight, getMatchWeights } from "../utils/matchWeights";
import { buildAvailabilityHeat, resolveQuoteViewNudgeHours } from "../utils/availabilityHeat";
import { buildEventSla, hoursBetween, isTierImproved } from "../utils/responseSla";
import { computeProOverallSla, slaTrendsForPros } from "../utils/proSlaBatch";
import { createEscrow, escrowAmountFromBid, splitEscrow } from "../domain/escrow";
import { transitionJob } from "../domain/jobStateMachine";
import { mean, median, rate } from "../domain/analytics";
import { roundCoord, toBid, toJob } from "../serializers";
import {
  assertOwner,
  isAdmin,
  isOwner,
  loadJobContext,
  type JobContext,
} from "../policies/jobPolicy";
import { viewer } from "./jobController";
import { firstInviteTimes } from "./inviteController";
import { filesOf } from "../middleware/upload";
import { discardFiles, fileRef, storeUploads } from "../services/files";
import { badRequest, conflict, forbidden, notFound } from "../http/errors";
import { logger } from "../logger";

const bidRepo = () => AppDataSource.getRepository(Bid);

async function loadBid(bidId: string) {
  const bid = await bidRepo().findOne({ where: { id: bidId } });
  if (!bid) throw notFound("Bid not found");
  return bid;
}

function archiveCounterOffer(bid: Bid) {
  if (!bid.counterOffer) return;
  const hist = Array.isArray(bid.counterHistory) ? [...bid.counterHistory] : [];
  hist.push({
    suggestedAmount: bid.counterOffer.suggestedAmount,
    notes: bid.counterOffer.notes ?? null,
    requestedAt: bid.counterOffer.requestedAt,
    status: bid.counterOffer.status,
    resolvedAt: new Date().toISOString(),
    addressedAt: bid.counterOffer.addressedAt ?? null,
    declinedAt: bid.counterOffer.declinedAt ?? null,
    declinedNotes: bid.counterOffer.declinedNotes ?? null,
  });
  bid.counterHistory = hist.slice(-20);
}

/** "Client viewed the revised quote but the pro hasn't followed up" (read-only; nudges run in the worker). */
export function viewedNoReplyState(bid: Bid, thresholdHours?: number | null, now = Date.now()) {
  const histLen = Array.isArray(bid.quoteHistory) ? bid.quoteHistory.length : 0;
  const threshold = resolveQuoteViewNudgeHours(thresholdHours);
  const viewedAt = bid.quoteViewedAt ? new Date(bid.quoteViewedAt) : null;
  if (!viewedAt || histLen < 1) {
    return { due: false, hoursSinceView: null as number | null, thresholdHours: threshold, revisedSinceView: false, nudged: false };
  }
  const revisedSinceView = histLen > (bid.quoteViewedRevisionCount ?? 0);
  const hoursSinceView = Math.round(((now - viewedAt.getTime()) / 3600_000) * 10) / 10;
  return {
    due: !revisedSinceView && hoursSinceView >= threshold,
    hoursSinceView,
    thresholdHours: threshold,
    revisedSinceView,
    nudged: !!bid.quoteViewedNudgeSentAt,
    quoteViewedAt: viewedAt.toISOString(),
    nudgeSentAt: bid.quoteViewedNudgeSentAt ? new Date(bid.quoteViewedNudgeSentAt).toISOString() : null,
  };
}

export async function placeBid(req: Request, res: Response) {
  const ctx = await loadJobContext(req.valid.params.id);
  if (!req.user!.proVerified) {
    throw forbidden("Your professional account must be verified before you can bid", "NOT_VERIFIED");
  }
  const b = req.valid.body;
  if (b.proposedVisitStart && b.proposedVisitEnd && b.proposedVisitEnd <= b.proposedVisitStart) {
    throw badRequest("Visit end must be after the start", "VALIDATION");
  }
  const files = filesOf(req, "quoteAttachment");
  let stored: string[] = [];
  const bid = await AppDataSource.transaction(async (m) => {
    const rows: { status: JobStatus; maxBids: number }[] = await m.query(
      `SELECT "status", "maxBids" FROM "jobs" WHERE "id" = $1 FOR UPDATE`,
      [ctx.job.id]
    );
    const job = rows[0];
    if (job.status !== JobStatus.OPEN) throw conflict("This job is no longer open for bids", "JOB_NOT_OPEN");
    if (await m.exists(Bid, { where: { jobId: ctx.job.id, tradespersonId: req.user!.id } })) {
      throw conflict("You already placed a bid on this job", "DUPLICATE_BID");
    }
    const active = await m.count(Bid, { where: { jobId: ctx.job.id, status: BidStatus.ACTIVE } });
    if (active >= job.maxBids) throw conflict("This job has reached the maximum number of bids", "MAX_BIDS");

    const created = await m.save(
      m.create(Bid, {
        jobId: ctx.job.id,
        tradespersonId: req.user!.id,
        amount: b.amount,
        message: b.message || undefined,
        etaDays: b.etaDays,
        proposedVisitStart: b.proposedVisitStart,
        proposedVisitEnd:
          b.proposedVisitEnd || (b.proposedVisitStart ? new Date(b.proposedVisitStart.getTime() + 2 * 3600_000) : undefined),
        quoteAmount: b.quoteAmount,
        quoteNotes: b.quoteNotes || undefined,
        status: BidStatus.ACTIVE,
      })
    );
    const uploads = await storeUploads(
      files,
      { kind: UploadKind.QUOTE, ownerUserId: req.user!.id, jobId: ctx.job.id, bidId: created.id, allowPdf: true },
      m
    );
    if (uploads.length) {
      stored = uploads.map((u) => fileRef(u.name));
      created.quoteAttachmentUrl = stored[0];
      await m.update(Bid, { id: created.id }, { quoteAttachmentUrl: stored[0] });
    }
    return created;
  }).catch(async (err) => {
    await discardFiles(stored);
    throw err;
  });

  const pro = await AppDataSource.getRepository(User).findOne({ where: { id: req.user!.id } });
  await createNotification({
    userId: ctx.job.homeownerId,
    type: NotificationType.NEW_BID,
    title: "New bid on your job",
    body: `${pro?.name || "A professional"} bid ₹${b.amount} on "${ctx.job.title}".`,
    link: `/client/jobs/${ctx.job.id}`,
    meta: { jobId: ctx.job.id, bidId: bid.id },
  });
  await notifyShortlistersOfFasterReplies(req.user!.id, bid.id, ctx.job.homeownerId, pro?.name).catch((err) =>
    logger.warn({ err }, "sla improve notify skipped")
  );
  return res.status(201).json({ bid: toBid(bid) });
}

async function notifyShortlistersOfFasterReplies(proId: string, bidId: string, skipUserId: string, proName?: string | null) {
  const prev = await computeProOverallSla(proId, bidId);
  const next = await computeProOverallSla(proId);
  if (!isTierImproved(prev.tier, next.tier)) return;
  const favs = await AppDataSource.getRepository(Favorite).find({
    where: { targetType: FavoriteTargetType.PRO, targetId: proId, userId: Not(skipUserId) },
  });
  if (!favs.length) return;
  const recent = await AppDataSource.getRepository(Notification)
    .createQueryBuilder("n")
    .select("n.userId", "userId")
    .where("n.userId IN (:...ids)", { ids: favs.map((f) => f.userId) })
    .andWhere("n.type = :type", { type: NotificationType.PRO_AVAILABLE })
    .andWhere("n.meta->>'slaImprove' = 'true' AND n.meta->>'proUserId' = :pid", { pid: proId })
    .andWhere("n.createdAt > :since", { since: new Date(Date.now() - 7 * 86400_000) })
    .getRawMany<{ userId: string }>();
  const skip = new Set(recent.map((r) => r.userId));
  await createNotifications(
    favs
      .filter((f) => !skip.has(f.userId))
      .map((f) => ({
        userId: f.userId,
        type: NotificationType.PRO_AVAILABLE,
        title: "Shortlisted professional replies faster",
        body: `${proName || "A saved professional"} improved to ${next.label} (was ${prev.label}).`,
        link: `/pros/${proId}`,
        meta: { proUserId: proId, slaImprove: true, fromTier: prev.tier, toTier: next.tier },
      }))
  );
}

export async function listBids(req: Request, res: Response) {
  const ctx = await loadJobContext(req.valid.params.id);
  const v = viewer(req);
  const job = ctx.job;

  if (v.role === UserRole.TRADESPERSON) {
    const mine = await bidRepo().find({ where: { jobId: job.id, tradespersonId: v.id } });
    if (!mine.length && ctx.acceptedProId !== v.id) throw forbidden("You don't have access to these bids");
    const otherActiveBidCount = await bidRepo().count({
      where: { jobId: job.id, status: BidStatus.ACTIVE, tradespersonId: Not(v.id) },
    });
    return res.json({
      bids: mine.map((b) => ({ ...toBid(b), viewedNoReply: viewedNoReplyState(b) })),
      otherActiveBidCount,
    });
  }
  if (!isOwner(ctx, v) && !isAdmin(v)) throw forbidden("You don't have access to these bids");

  const bids = await bidRepo().find({ where: { jobId: job.id }, relations: ["tradesperson"], order: { createdAt: "ASC" } });
  const proIds = [...new Set(bids.map((b) => b.tradespersonId))];
  const profiles = proIds.length
    ? await AppDataSource.getRepository(TradespersonProfile).find({ where: { userId: In(proIds) } })
    : [];
  const profileMap = new Map(profiles.map((p) => [p.userId, p]));
  const inviteAt = await firstInviteTimes(job.id);
  const trends = proIds.length ? await slaTrendsForPros(proIds) : {};
  const matchWeights = await getMatchWeights();
  const heatWeight = await getHeatWeight();
  const bestValueBlend = await getBestValueBlend();

  const shaped = bids.map((b) => {
    const p = profileMap.get(b.tradespersonId);
    const jobToBidHours = hoursBetween(job.createdAt, b.createdAt);
    const invitedAt = inviteAt.get(b.tradespersonId);
    const inviteToBidHours = invitedAt ? hoursBetween(invitedAt, b.createdAt) : null;
    const t = trends[b.tradespersonId];
    let match: Record<string, unknown> = { matchScore: null, heatBoost: 0, rankedScore: null, matchBreakdown: null };
    if (p) {
      const input: ScoreablePro = {
        userId: p.userId,
        skills: p.skills,
        city: p.city,
        serviceAreas: p.serviceAreas,
        lat: p.lat,
        lng: p.lng,
        averageRating: Number(p.averageRating || 0),
        reviewCount: p.reviewCount || 0,
        avgResponseHours: jobToBidHours,
        name: b.tradesperson?.name || null,
      };
      const breakdown = scoreProForJob(job, input, matchWeights);
      const heatBoost = computeHeatBoost(buildAvailabilityHeat(p.weeklyAvailability, p.blockedDates, b.tradesperson?.timezone), heatWeight);
      match = {
        matchScore: breakdown.total,
        heatBoost,
        rankedScore: Math.round((breakdown.total + heatBoost) * 10) / 10,
        matchBreakdown: breakdown,
      };
    }
    return {
      ...toBid(b),
      distanceKm: p && job.lat != null && job.lng != null ? haversineKm(job.lat, job.lng, p.lat, p.lng) : null,
      jobToBidHours,
      inviteToBidHours,
      responseSla: buildEventSla({ inviteToBidHours, jobToBidHours }),
      proSlaTrends: t?.clean ? { d7: t.d7, d30: t.d30, clean: true } : null,
      viewedNoReply: viewedNoReplyState(b, b.tradesperson?.quoteViewNudgeHours),
      tradesperson: b.tradesperson ? { id: b.tradesperson.id, name: b.tradesperson.name ?? null } : undefined,
      profile: p
        ? {
            averageRating: Number(p.averageRating || 0),
            reviewCount: p.reviewCount || 0,
            skills: p.skills ?? null,
            city: p.city ?? null,
            lat: roundCoord(p.lat),
            lng: roundCoord(p.lng),
            yearsExperience: p.yearsExperience ?? null,
            verificationStatus: p.verificationStatus,
          }
        : null,
      ...match,
    };
  });
  return res.json({ bids: shaped, bestValueBlend });
}

export async function withdrawBid(req: Request, res: Response) {
  const bid = await loadBid(req.valid.params.id);
  if (bid.tradespersonId !== req.user!.id) throw forbidden("You can only withdraw your own bid");
  await AppDataSource.transaction(async (m) => {
    const rows = await m.query(`SELECT "status" FROM "jobs" WHERE "id" = $1 FOR UPDATE`, [bid.jobId]);
    if (rows[0]?.status !== JobStatus.OPEN) throw conflict("Bids can only be withdrawn while the job is open", "JOB_NOT_OPEN");
    const res2 = await m.update(Bid, { id: bid.id, status: BidStatus.ACTIVE }, { status: BidStatus.WITHDRAWN });
    if (!res2.affected) throw conflict("Only active bids can be withdrawn", "BID_NOT_ACTIVE");
  });
  await revokeThreadStreams(bid.jobId, null).catch(() => undefined);
  const fresh = await loadBid(bid.id);
  return res.json({ bid: toBid(fresh) });
}

/**
 * Accept a bid. The client must send the amount and quote revision they saw;
 * if the pro changed the quote in the meantime the request fails with QUOTE_CHANGED.
 */
export async function acceptBid(req: Request, res: Response) {
  const bid = await loadBid(req.valid.params.id);
  const ctx = await loadJobContext(bid.jobId);
  assertOwner(ctx, viewer(req), "Only the client who posted this job can accept bids");
  const { expectedAmount, expectedRevision } = req.valid.body;

  const outcome = await AppDataSource.transaction(async (m) => {
    const jobRows = await m.query(`SELECT "status" FROM "jobs" WHERE "id" = $1 FOR UPDATE`, [ctx.job.id]);
    if (jobRows[0]?.status !== JobStatus.OPEN) {
      throw conflict("Bids can only be accepted while the job is open", "JOB_NOT_OPEN");
    }
    const current = await m.findOne(Bid, { where: { id: bid.id } });
    if (!current || current.status !== BidStatus.ACTIVE) throw conflict("This bid is no longer active", "BID_NOT_ACTIVE");
    const escrow = escrowAmountFromBid(current);
    if (current.quoteRevision !== expectedRevision || Math.abs(escrow.amount - expectedAmount) > 0.004) {
      throw conflict("The quote changed since you last looked. Review the new amount and accept again.", "QUOTE_CHANGED", {
        currentAmount: escrow.amount,
        currentRevision: current.quoteRevision,
        source: escrow.source,
      });
    }
    const pro = await m.findOne(User, { where: { id: current.tradespersonId } });
    const profile = await m.findOne(TradespersonProfile, { where: { userId: current.tradespersonId } });
    if (!pro || pro.isSuspended || pro.deletedAt || profile?.verificationStatus !== VerificationStatus.VERIFIED) {
      throw conflict("This professional can't be hired right now", "PRO_UNAVAILABLE");
    }

    await m.update(Bid, { id: current.id }, { status: BidStatus.ACCEPTED });
    const others = await m.find(Bid, { where: { jobId: ctx.job.id, status: BidStatus.ACTIVE } });
    if (others.length) await m.update(Bid, { id: In(others.map((o) => o.id)) }, { status: BidStatus.REJECTED });

    const patch: Partial<Job> = {
      acceptedBidId: current.id,
      paymentStatus: PaymentStatus.HELD,
      escrowAmount: escrow.amount,
      escrowSource: escrow.source,
    };
    if (current.proposedVisitStart) {
      patch.scheduledStart = current.proposedVisitStart;
      patch.scheduledEnd = current.proposedVisitEnd || new Date(current.proposedVisitStart.getTime() + 2 * 3600_000);
      patch.scheduleStatus = ScheduleStatus.PROPOSED;
      patch.scheduleProposedByUserId = current.tradespersonId;
    }
    await transitionJob(m, ctx.job.id, "award", patch);
    await createEscrow(m, ctx.job, current.tradespersonId, escrow.amount, req.user!.id);
    return { accepted: current, escrow, rejected: others.map((o) => o.tradespersonId) };
  });

  await invalidateOpenJobsCache();
  await revokeThreadStreams(ctx.job.id, outcome.accepted.tradespersonId);
  const label = `₹${outcome.escrow.amount.toFixed(0)}${outcome.escrow.source === "quote" ? " (from the accepted quote)" : ""}`;
  await createNotifications([
    {
      userId: outcome.accepted.tradespersonId,
      type: NotificationType.BID_ACCEPTED,
      title: "Bid accepted!",
      body: `Your bid on "${ctx.job.title}" was accepted. ${label} is held in simulated escrow.`,
      link: `/professional/jobs/${ctx.job.id}`,
      meta: { jobId: ctx.job.id, bidId: outcome.accepted.id, escrowAmount: outcome.escrow.amount, escrowSource: outcome.escrow.source },
    },
    ...outcome.rejected.map((userId) => ({
      userId,
      type: NotificationType.BID_REJECTED,
      title: "Bid not selected",
      body: `Another bid was accepted for "${ctx.job.title}".`,
      link: "/professional",
      meta: { jobId: ctx.job.id },
    })),
  ]);

  const job = await AppDataSource.getRepository(Job).findOneOrFail({ where: { id: ctx.job.id } });
  const bids = await bidRepo().find({ where: { jobId: ctx.job.id }, order: { createdAt: "ASC" } });
  const counter = outcome.accepted.counterOffer || null;
  const counterSuggested = counter ? Number(counter.suggestedAmount) : null;
  const differs = counterSuggested != null && Math.abs(outcome.escrow.amount - counterSuggested) >= 1;
  const counterAddressed = counter?.status === "addressed";
  return res.json({
    job: toJob(job, "private"),
    bids: bids.map(toBid),
    escrow: {
      amount: outcome.escrow.amount,
      source: outcome.escrow.source,
      message:
        outcome.escrow.source === "quote"
          ? "Simulated escrow funded from the structured quote amount."
          : "Simulated escrow funded from the bid amount.",
      counterAddressed,
      counterSuggested,
      amountDiffersFromCounter: differs,
      softHoldPreview:
        counterAddressed && differs
          ? {
              holdAmount: outcome.escrow.amount,
              counterSuggested,
              delta: Math.round((outcome.escrow.amount - (counterSuggested || 0)) * 100) / 100,
              note: "The counter was addressed with a different final amount — escrow holds the accepted amount.",
            }
          : null,
    },
  });
}

async function openBidForPro(req: Request) {
  const bid = await loadBid(req.valid.params.id);
  if (bid.tradespersonId !== req.user!.id) throw forbidden("You can only change your own bid");
  if (bid.status !== BidStatus.ACTIVE) throw conflict("Only active bids can be changed", "BID_NOT_ACTIVE");
  const ctx = await loadJobContext(bid.jobId);
  if (ctx.job.status !== JobStatus.OPEN) throw conflict("Quotes can only be revised while the job is open", "JOB_NOT_OPEN");
  return { bid, ctx };
}

export async function updateBidQuote(req: Request, res: Response) {
  const { bid, ctx } = await openBidForPro(req);
  const b = req.valid.body;
  const file = filesOf(req, "quoteAttachment")[0];
  if (b.quoteAmount === undefined && b.quoteNotes === undefined && !file && !b.clearQuoteAttachment) {
    throw badRequest("Provide quoteAmount, quoteNotes and/or quoteAttachment", "VALIDATION");
  }
  const prevAmount = bid.quoteAmount != null ? Number(bid.quoteAmount) : null;
  const prevNotes = bid.quoteNotes || null;
  const prevAttachment = bid.quoteAttachmentUrl || null;
  const nextAmount = b.quoteAmount !== undefined ? b.quoteAmount : prevAmount;
  const nextNotes = b.quoteNotes !== undefined ? b.quoteNotes || null : prevNotes;

  let stored: string[] = [];
  const saved = await AppDataSource.transaction(async (m) => {
    const rows = await m.query(`SELECT "status" FROM "jobs" WHERE "id" = $1 FOR UPDATE`, [ctx.job.id]);
    if (rows[0]?.status !== JobStatus.OPEN) throw conflict("Quotes can only be revised while the job is open", "JOB_NOT_OPEN");
    const current = await m.findOneOrFail(Bid, { where: { id: bid.id } });
    if (current.status !== BidStatus.ACTIVE) throw conflict("Only active bids can be changed", "BID_NOT_ACTIVE");
    let nextAttachment = prevAttachment;
    if (file) {
      const [u] = await storeUploads([file], {
        kind: UploadKind.QUOTE,
        ownerUserId: req.user!.id,
        jobId: ctx.job.id,
        bidId: bid.id,
        allowPdf: true,
      }, m);
      nextAttachment = fileRef(u.name);
      stored = [nextAttachment];
    } else if (b.clearQuoteAttachment) {
      nextAttachment = null;
    }
    const changed = nextAmount !== prevAmount || nextNotes !== prevNotes || nextAttachment !== prevAttachment;
    if (!changed) return { bid: current, changed: false };
    const history = Array.isArray(current.quoteHistory) ? [...current.quoteHistory] : [];
    history.push({ amount: prevAmount, notes: prevNotes, attachmentUrl: prevAttachment, revisedAt: new Date().toISOString() });
    current.quoteHistory = history.slice(-20);
    current.quoteAmount = nextAmount ?? undefined;
    current.quoteNotes = nextNotes ?? undefined;
    current.quoteAttachmentUrl = nextAttachment ?? undefined;
    current.quoteRevision = (current.quoteRevision || 0) + 1;
    if (current.counterOffer?.status === "pending") {
      current.counterOffer = { ...current.counterOffer, status: "addressed", addressedAt: new Date().toISOString() };
    }
    await m.save(current);
    if (nextAttachment !== prevAttachment && current.quoteAttachmentUrl == null) {
      await m.query(`UPDATE "bids" SET "quoteAttachmentUrl" = NULL WHERE "id" = $1`, [current.id]);
    }
    return { bid: current, changed: true };
  }).catch(async (err) => {
    await discardFiles(stored);
    throw err;
  });

  if (!saved.changed) return res.json({ bid: toBid(saved.bid), message: "No quote changes" });

  const amountDelta =
    nextAmount != null && prevAmount != null ? Math.round((nextAmount - prevAmount) * 100) / 100 : nextAmount;
  const parts: string[] = [];
  if (amountDelta != null && prevAmount != null && amountDelta !== 0) {
    parts.push(`amount ${amountDelta > 0 ? "+" : "−"}₹${Math.abs(amountDelta).toFixed(0)}`);
  } else if (prevAmount == null && nextAmount != null) {
    parts.push(`amount set to ₹${nextAmount.toFixed(0)}`);
  }
  if (nextNotes !== prevNotes) parts.push(nextNotes ? "notes updated" : "notes cleared");
  if ((saved.bid.quoteAttachmentUrl || null) !== prevAttachment) {
    parts.push(saved.bid.quoteAttachmentUrl ? "attachment updated" : "attachment cleared");
  }
  await createNotification({
    userId: ctx.job.homeownerId,
    type: NotificationType.NEW_BID,
    title: "Quote revised on a bid",
    body: `A professional revised their quote on "${ctx.job.title}" (${parts.join(", ") || "quote updated"}).`,
    link: `/client/jobs/${ctx.job.id}?bid=${bid.id}#bid-${bid.id}`,
    meta: {
      jobId: ctx.job.id,
      bidId: bid.id,
      quoteRevised: true,
      quoteRevision: saved.bid.quoteRevision,
      previousAmount: prevAmount,
      newAmount: nextAmount ?? null,
      amountDelta,
    },
  });
  return res.json({
    bid: toBid(saved.bid),
    message: "Quote revised",
    quoteDiff: {
      previousAmount: prevAmount,
      newAmount: nextAmount ?? null,
      amountDelta,
      notesChanged: nextNotes !== prevNotes,
      previousNotes: prevNotes,
      newNotes: nextNotes,
    },
  });
}

export async function requestQuoteRevise(req: Request, res: Response) {
  const bid = await loadBid(req.valid.params.id);
  const ctx = await loadJobContext(bid.jobId);
  assertOwner(ctx, viewer(req));
  if (bid.status !== BidStatus.ACTIVE) throw conflict("Only active bids can receive a counter-offer", "BID_NOT_ACTIVE");
  if (ctx.job.status !== JobStatus.OPEN) throw conflict("Counter-offers are only possible while the job is open", "JOB_NOT_OPEN");
  const { suggestedAmount, notes } = req.valid.body;
  archiveCounterOffer(bid);
  bid.counterOffer = {
    suggestedAmount,
    notes: notes || null,
    requestedAt: new Date().toISOString(),
    status: "pending",
  };
  await bidRepo().save(bid);
  const current = bid.quoteAmount != null ? `current quote ₹${Number(bid.quoteAmount).toFixed(0)}` : `current bid ₹${Number(bid.amount).toFixed(0)}`;
  await createNotification({
    userId: bid.tradespersonId,
    type: NotificationType.SYSTEM,
    title: "Counter-offer received",
    body: `The client suggested ₹${suggestedAmount.toFixed(0)} on "${ctx.job.title}" (${current}).${notes ? ` Note: ${notes.slice(0, 120)}` : ""}`,
    link: `/professional/jobs/${ctx.job.id}?counter=1#bid-form`,
    meta: { jobId: ctx.job.id, bidId: bid.id, counterOffer: true, suggestedAmount },
  });
  return res.json({
    bid: { id: bid.id, counterOffer: bid.counterOffer, counterHistory: bid.counterHistory || [], quoteAmount: bid.quoteAmount ?? null },
    message: "Counter-offer sent",
  });
}

export async function declineCounterOffer(req: Request, res: Response) {
  const { bid, ctx } = await openBidForPro(req);
  if (!bid.counterOffer || bid.counterOffer.status !== "pending") {
    throw badRequest("There is no pending counter-offer to decline", "NO_PENDING_COUNTER");
  }
  const notes = req.valid.body.notes || null;
  bid.counterOffer = { ...bid.counterOffer, status: "declined", declinedAt: new Date().toISOString(), declinedNotes: notes };
  await bidRepo().save(bid);
  const amount = Number(bid.counterOffer.suggestedAmount).toFixed(0);
  await createNotification({
    userId: ctx.job.homeownerId,
    type: NotificationType.SYSTEM,
    title: "Counter-offer declined",
    body: notes
      ? `The professional declined your counter (₹${amount}) on "${ctx.job.title}": ${notes.slice(0, 120)}`
      : `The professional declined your counter (₹${amount}) on "${ctx.job.title}".`,
    link: `/client/jobs/${ctx.job.id}?bid=${bid.id}#bid-${bid.id}`,
    meta: { jobId: ctx.job.id, bidId: bid.id, counterDeclined: true },
  });
  return res.json({
    bid: { id: bid.id, counterOffer: bid.counterOffer, counterHistory: bid.counterHistory || [] },
    message: "Counter-offer declined",
  });
}

async function bidParty(req: Request) {
  const bid = await loadBid(req.valid.params.id);
  const ctx = await loadJobContext(bid.jobId);
  const v = viewer(req);
  const isPro = bid.tradespersonId === v.id;
  if (!isPro && !isOwner(ctx, v) && !isAdmin(v)) throw forbidden("You don't have access to this bid");
  return { bid, ctx, isPro };
}

export async function checkViewedNoReply(req: Request, res: Response) {
  const { bid } = await bidParty(req);
  const pro = await AppDataSource.getRepository(User).findOne({ where: { id: bid.tradespersonId } });
  const state = viewedNoReplyState(bid, pro?.quoteViewNudgeHours);
  return res.json({ bidId: bid.id, viewedNoReply: state, thresholdHours: state.thresholdHours });
}

export async function markQuoteViewed(req: Request, res: Response) {
  const bid = await loadBid(req.valid.params.id);
  const ctx: JobContext = await loadJobContext(bid.jobId);
  assertOwner(ctx, viewer(req));
  const histLen = Array.isArray(bid.quoteHistory) ? bid.quoteHistory.length : 0;
  if (histLen < 1) return res.json({ viewed: false, notified: false, message: "No revised quote to view" });
  const alreadySeen = (bid.quoteViewedRevisionCount ?? 0) >= histLen;
  const now = new Date();
  await bidRepo().update({ id: bid.id }, { quoteViewedAt: now, quoteViewedRevisionCount: histLen, ...(alreadySeen ? {} : { quoteViewedNudgeSentAt: null }) });
  if (!alreadySeen) {
    const latest = bid.quoteAmount != null ? Number(bid.quoteAmount) : null;
    await createNotification({
      userId: bid.tradespersonId,
      type: NotificationType.SYSTEM,
      title: "The client viewed your revised quote",
      body: latest != null
        ? `The client opened your revised quote (₹${latest.toFixed(0)}) on "${ctx.job.title}".`
        : `The client opened your revised quote on "${ctx.job.title}".`,
      link: `/professional/jobs/${ctx.job.id}`,
      meta: { jobId: ctx.job.id, bidId: bid.id, quoteViewed: true, revisionCount: histLen },
    });
  }
  return res.json({ viewed: true, notified: !alreadySeen, quoteViewedAt: now, quoteViewedRevisionCount: histLen });
}

export async function escrowWhatIf(req: Request, res: Response) {
  const { bid, ctx } = await bidParty(req);
  const fromBid = escrowAmountFromBid(bid);
  const amount = req.valid.query.amount ?? fromBid.amount;
  const preview = splitEscrow(amount);
  const counter = bid.counterOffer || null;
  return res.json({
    bidId: bid.id,
    jobId: ctx.job.id,
    source: fromBid.source,
    defaultAmount: fromBid.amount,
    quoteRevision: bid.quoteRevision,
    amount: preview.amount,
    milestones: preview.milestones,
    note: "Simulated escrow preview — Deposit / Progress / Completion split if you accept at this amount.",
    counterOffer: counter
      ? {
          suggestedAmount: Number(counter.suggestedAmount),
          status: counter.status,
          deltaVsAmount: Math.round((preview.amount - Number(counter.suggestedAmount)) * 100) / 100,
        }
      : null,
  });
}

type CounterEvent = {
  status: "pending" | "addressed" | "dismissed" | "declined";
  requestedAt: string;
  addressedAt?: string | null;
  declinedAt?: string | null;
  resolvedAt?: string | null;
  bidStatus: string;
};

function counterEvents(bid: Bid): CounterEvent[] {
  const out: CounterEvent[] = (Array.isArray(bid.counterHistory) ? bid.counterHistory : []).map((h) => ({
    ...h,
    bidStatus: bid.status,
  }));
  if (bid.counterOffer) out.push({ ...bid.counterOffer, resolvedAt: null, bidStatus: bid.status });
  return out;
}

function hoursBetweenIso(from: string, to?: string | null) {
  if (!to) return null;
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return (b - a) / 3600_000;
}

export function summarizeCounterEvents(events: CounterEvent[]) {
  const addressHours: number[] = [];
  const declineHours: number[] = [];
  const count = { pending: 0, addressed: 0, declined: 0, dismissed: 0, afterAddressedAccepted: 0, afterAddressedRejected: 0, afterAddressedOpen: 0 };
  for (const e of events) {
    count[e.status] += 1;
    if (e.status === "addressed") {
      const h = hoursBetweenIso(e.requestedAt, e.addressedAt || e.resolvedAt);
      if (h != null) addressHours.push(h);
      if (e.bidStatus === BidStatus.ACCEPTED) count.afterAddressedAccepted += 1;
      else if (e.bidStatus === BidStatus.REJECTED) count.afterAddressedRejected += 1;
      else if (e.bidStatus === BidStatus.ACTIVE) count.afterAddressedOpen += 1;
    } else if (e.status === "declined") {
      const h = hoursBetweenIso(e.requestedAt, e.declinedAt || e.resolvedAt);
      if (h != null) declineHours.push(h);
    }
  }
  const sent = events.length;
  return {
    sent,
    ...count,
    addressRate: rate(count.addressed, sent),
    declineRate: rate(count.declined, sent),
    avgTimeToAddressHours: mean(addressHours),
    medianTimeToAddressHours: median(addressHours),
    avgTimeToDeclineHours: mean(declineHours),
    medianTimeToDeclineHours: median(declineHours),
    addressSampleSize: addressHours.length,
    declineSampleSize: declineHours.length,
  };
}

export async function getCounterAnalytics(req: Request, res: Response) {
  const { role, id } = req.user!;
  const q = req.valid.query;
  const asPro = role === UserRole.TRADESPERSON || (role === UserRole.ADMIN && q.asPro);
  if (role !== UserRole.ADMIN && (q.homeownerId || q.tradespersonId)) {
    if ((q.homeownerId && q.homeownerId !== id) || (q.tradespersonId && q.tradespersonId !== id)) throw forbidden();
  }
  if (asPro) {
    const proId = role === UserRole.ADMIN && q.tradespersonId ? q.tradespersonId : id;
    const bids = await bidRepo().find({ where: { tradespersonId: proId } });
    return res.json({ role: "tradesperson", tradespersonId: proId, bids: bids.length, ...summarizeCounterEvents(bids.flatMap(counterEvents)) });
  }
  if (role !== UserRole.HOMEOWNER && role !== UserRole.ADMIN) throw forbidden();
  const homeownerId = role === UserRole.ADMIN && q.homeownerId ? q.homeownerId : id;
  const jobs = await AppDataSource.getRepository(Job).find({
    where: q.jobId ? { homeownerId, id: q.jobId } : { homeownerId },
    select: { id: true, title: true },
  });
  if (q.jobId && !jobs.length) throw notFound("Job not found");
  const bids = jobs.length ? await bidRepo().find({ where: { jobId: In(jobs.map((j) => j.id)) } }) : [];
  const byJob = jobs.map((j) => ({
    jobId: j.id,
    title: j.title,
    ...summarizeCounterEvents(bids.filter((b) => b.jobId === j.id).flatMap(counterEvents)),
  }));
  return res.json({
    role: "homeowner",
    homeownerId,
    jobId: q.jobId || null,
    jobs: jobs.length,
    ...summarizeCounterEvents(bids.flatMap(counterEvents)),
    byJob: q.jobId ? byJob : byJob.filter((j) => j.sent > 0).slice(0, 20),
  });
}
