import { Request, Response } from "express";
import { param } from "../utils/params";
import { AppDataSource } from "../data-source";
import { Bid, BidStatus } from "../entities/Bid";
import { Job, JobStatus, PaymentStatus, ScheduleStatus } from "../entities/Job";
import { User, UserRole } from "../entities/User";
import {
  TradespersonProfile,
  VerificationStatus,
} from "../entities/TradespersonProfile";
import { invalidateOpenJobsCache } from "../utils/cache";
import { createNotification } from "../utils/notifications";
import { createEscrowForAcceptedBid } from "./paymentController";
import { haversineKm } from "../utils/geo";
import { escrowAmountFromBid, scoreProForJob, type ScoreablePro } from "../utils/matchScore";
import { getMatchWeights, getHeatWeight, computeHeatBoost, getBestValueBlend } from "../utils/matchWeights";
import { buildAvailabilityHeat } from "../utils/availabilityHeat";
import { buildEventSla, hoursBetween, isTierImproved } from "../utils/responseSla";
import { Notification, NotificationType } from "../entities/Notification";
import { slaTrendsForPros, computeProOverallSla } from "../utils/proSlaBatch";
import { Favorite, FavoriteTargetType } from "../entities/Favorite";
import { quoteViewNudgeHours, resolveQuoteViewNudgeHours } from "../utils/availabilityHeat";
import { previewEscrowSplit } from "./paymentController";

const bidRepo = () => AppDataSource.getRepository(Bid);
const jobRepo = () => AppDataSource.getRepository(Job);
const profileRepo = () => AppDataSource.getRepository(TradespersonProfile);

function parseOptionalDate(value: unknown): Date | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? undefined : d;
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

/** Soft flag + optional one-shot notify when homeowner viewed revised quote with no pro reply. */
async function applyViewedNoReplyNudge(
  bid: Bid,
  job: Job,
  opts?: { forceNotify?: boolean; thresholdHours?: number | null }
) {
  const histLen = Array.isArray(bid.quoteHistory) ? bid.quoteHistory.length : 0;
  const viewedAt = bid.quoteViewedAt ? new Date(bid.quoteViewedAt) : null;
  const thresholdH = resolveQuoteViewNudgeHours(opts?.thresholdHours);
  if (!viewedAt || histLen < 1) {
    return {
      viewedNoReply: {
        due: false,
        hoursSinceView: null as number | null,
        thresholdHours: thresholdH,
        revisedSinceView: false,
        nudged: false,
      },
    };
  }
  const viewedCount = bid.quoteViewedRevisionCount ?? 0;
  const revisedSinceView = histLen > viewedCount;
  const hoursSinceView =
    Math.round(((Date.now() - viewedAt.getTime()) / 3600000) * 10) / 10;
  const due = !revisedSinceView && hoursSinceView >= thresholdH;
  let nudged = false;
  if (due && bid.status === BidStatus.ACTIVE && (!bid.quoteViewedNudgeSentAt || opts?.forceNotify)) {
    // Dedupe: only send once unless force
    if (!bid.quoteViewedNudgeSentAt) {
      await createNotification({
        userId: bid.tradespersonId,
        type: NotificationType.SYSTEM,
        title: "Viewed but no reply",
        body: `Homeowner viewed your revised quote on "${job.title}" ~${Math.floor(hoursSinceView)}h ago with no further revise. Consider following up.`,
        link: `/tradesperson/jobs/${job.id}?nudge=viewed#bid-form`,
        meta: {
          jobId: job.id,
          bidId: bid.id,
          viewedNoReply: true,
          hoursSinceView,
          thresholdHours: thresholdH,
          quoteViewedAt: viewedAt.toISOString(),
        },
      });
      bid.quoteViewedNudgeSentAt = new Date();
      await bidRepo().save(bid);
      nudged = true;
    }
  }
  return {
    viewedNoReply: {
      due,
      hoursSinceView,
      thresholdHours: thresholdH,
      revisedSinceView,
      nudged,
      quoteViewedAt: viewedAt.toISOString(),
      nudgeSentAt: bid.quoteViewedNudgeSentAt
        ? new Date(bid.quoteViewedNudgeSentAt).toISOString()
        : null,
    },
  };
}


export async function placeBid(req: Request, res: Response) {
  const job = await jobRepo().findOne({ where: { id: param(req, "id") } });
  if (!job) {
    return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });
  }
  if (job.status !== JobStatus.OPEN) {
    return res.status(400).json({ message: "Job is not open for bidding", code: "JOB_NOT_OPEN" });
  }

  const profile = await profileRepo().findOne({ where: { userId: req.user!.id } });
  if (!profile || profile.verificationStatus !== VerificationStatus.VERIFIED) {
    return res.status(403).json({
      message: "Tradesperson must be verified by admin before bidding",
      code: "NOT_VERIFIED",
    });
  }

  const existing = await bidRepo().findOne({
    where: { jobId: job.id, tradespersonId: req.user!.id },
  });
  if (existing) {
    return res.status(409).json({
      message: "You already placed a bid on this job",
      code: "DUPLICATE_BID",
    });
  }

  const activeCount = await bidRepo().count({
    where: { jobId: job.id, status: BidStatus.ACTIVE },
  });
  if (activeCount >= job.maxBids) {
    return res.status(400).json({
      message: "This job has reached the maximum number of bids",
      code: "MAX_BIDS",
    });
  }

  const { amount, message, etaDays, proposedVisitStart, proposedVisitEnd, quoteAmount, quoteNotes } =
    req.body ?? {};
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ message: "amount must be a positive number" });
  }

  const visitStart = parseOptionalDate(proposedVisitStart);
  const visitEnd = parseOptionalDate(proposedVisitEnd);
  if (visitStart && visitEnd && visitEnd <= visitStart) {
    return res.status(400).json({ message: "proposedVisitEnd must be after proposedVisitStart" });
  }

  const qAmtRaw = quoteAmount !== undefined && quoteAmount !== "" ? Number(quoteAmount) : NaN;
  const qAmt = Number.isFinite(qAmtRaw) && qAmtRaw > 0 ? qAmtRaw : undefined;
  const quoteFile = (req as any).file as Express.Multer.File | undefined;
  const quoteAttachmentUrl = quoteFile
    ? `/uploads/${quoteFile.filename}`
    : req.body?.quoteAttachmentUrl
      ? String(req.body.quoteAttachmentUrl)
      : undefined;

  const bid = bidRepo().create({
    jobId: job.id,
    tradespersonId: req.user!.id,
    amount: amt,
    message: message ? String(message) : undefined,
    etaDays: etaDays !== undefined ? parseInt(String(etaDays), 10) : undefined,
    proposedVisitStart: visitStart,
    proposedVisitEnd: visitEnd || (visitStart ? new Date(visitStart.getTime() + 2 * 60 * 60 * 1000) : undefined),
    quoteAmount: qAmt,
    quoteNotes: quoteNotes ? String(quoteNotes).slice(0, 4000) : undefined,
    quoteAttachmentUrl,
    status: BidStatus.ACTIVE,
  });
  await bidRepo().save(bid);

  const pro = await AppDataSource.getRepository(User).findOne({ where: { id: req.user!.id } });
  await createNotification({
    userId: job.homeownerId,
    type: NotificationType.NEW_BID,
    title: "New bid on your job",
    body: `${pro?.name || "A tradesperson"} bid ₹${amt} on "${job.title}".`,
    link: `/homeowner/jobs/${job.id}`,
    meta: { jobId: job.id, bidId: bid.id },
  });

  // Soft notify shortlist homeowners when this bid improves the pro's response SLA tier
  try {
    const prevSla = await computeProOverallSla(req.user!.id, bid.id);
    const nextSla = await computeProOverallSla(req.user!.id);
    if (isTierImproved(prevSla.tier, nextSla.tier)) {
      const favs = await AppDataSource.getRepository(Favorite).find({
        where: { targetType: FavoriteTargetType.PRO, targetId: req.user!.id },
      });
      const name = pro?.name || "A saved pro";
      for (const f of favs) {
        // Skip the job's homeowner (they already got a new-bid ping)
        if (f.userId === job.homeownerId) continue;
        // Dedupe: skip if we already sent an SLA-improve note in the last 7 days
        const recent = await AppDataSource.getRepository(Notification)
          .createQueryBuilder("n")
          .where("n.userId = :uid", { uid: f.userId })
          .andWhere("n.type = :type", { type: NotificationType.PRO_AVAILABLE })
          .andWhere("n.meta->>'slaImprove' = 'true'")
          .andWhere("n.meta->>'proUserId' = :pid", { pid: req.user!.id })
          .andWhere("n.createdAt > :since", {
            since: new Date(Date.now() - 7 * 86400000),
          })
          .getOne();
        if (recent) continue;
        await createNotification({
          userId: f.userId,
          type: NotificationType.PRO_AVAILABLE,
          title: "Shortlisted pro replies faster",
          body: `${name} improved to ${nextSla.label} (was ${prevSla.label}).`,
          link: `/pros/${req.user!.id}`,
          meta: {
            proUserId: req.user!.id,
            slaImprove: true,
            fromTier: prevSla.tier,
            toTier: nextSla.tier,
          },
        });
      }
    }
  } catch (e) {
    console.warn("sla improve notify skipped", e);
  }

  return res.status(201).json({ bid });
}

export async function listBids(req: Request, res: Response) {
  const job = await jobRepo().findOne({ where: { id: param(req, "id") } });
  if (!job) {
    return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });
  }

  const { role, id: userId } = req.user!;
  const isOwner = job.homeownerId === userId;
  const isAdmin = role === UserRole.ADMIN;

  if (!isOwner && !isAdmin && role !== UserRole.TRADESPERSON) {
    return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
  }

  if (role === UserRole.HOMEOWNER && !isOwner) {
    return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
  }

  const bids = await bidRepo().find({
    where: { jobId: job.id },
    relations: ["tradesperson"],
    order: { createdAt: "ASC" },
  });

  const proIds = [...new Set(bids.map((b) => b.tradespersonId))];
  const profiles = proIds.length
    ? await profileRepo()
        .createQueryBuilder("p")
        .where("p.userId IN (:...ids)", { ids: proIds })
        .getMany()
    : [];
  const profileMap = Object.fromEntries(profiles.map((p) => [p.userId, p]));

  // Invite notifications for invite→bid latency on this job
  const inviteRows = await AppDataSource.getRepository(Notification)
    .createQueryBuilder("n")
    .where("n.type = :type", { type: NotificationType.MATCH })
    .andWhere("n.meta->>'invite' = 'true'")
    .andWhere("n.meta->>'jobId' = :jobId", { jobId: job.id })
    .getMany();
  const inviteAtByPro: Record<string, Date> = {};
  for (const n of inviteRows) {
    const prev = inviteAtByPro[n.userId];
    if (!prev || new Date(n.createdAt) < prev) {
      inviteAtByPro[n.userId] = new Date(n.createdAt);
    }
  }

  const shapedBase = bids.map((b) => {
    const profile = profileMap[b.tradespersonId];
    const distanceKm =
      profile && job.lat != null && job.lng != null
        ? haversineKm(job.lat, job.lng, profile.lat, profile.lng)
        : null;
    const jobToBidHours = hoursBetween(job.createdAt, b.createdAt);
    const inviteAt = inviteAtByPro[b.tradespersonId];
    const inviteToBidHours = inviteAt ? hoursBetween(inviteAt, b.createdAt) : null;
    const responseSla = buildEventSla({
      inviteToBidHours,
      jobToBidHours,
    });
    return {
      ...b,
      amount: b.amount,
      quoteAmount: b.quoteAmount != null ? Number(b.quoteAmount) : null,
      quoteNotes: b.quoteNotes || null,
      quoteAttachmentUrl: b.quoteAttachmentUrl || null,
      quoteHistory: Array.isArray(b.quoteHistory) ? b.quoteHistory : [],
      counterOffer: b.counterOffer || null,
      counterHistory: Array.isArray(b.counterHistory) ? b.counterHistory : [],
      quoteViewedAt: b.quoteViewedAt || null,
      quoteViewedRevisionCount: b.quoteViewedRevisionCount ?? null,
      quoteViewedNudgeSentAt: b.quoteViewedNudgeSentAt || null,
      distanceKm,
      jobToBidHours,
      inviteToBidHours,
      responseSla,
      tradesperson: b.tradesperson
        ? {
            id: b.tradesperson.id,
            email: b.tradesperson.email,
            name: b.tradesperson.name,
          }
        : undefined,
      profile: profile
        ? {
            averageRating: Number(profile.averageRating || 0),
            reviewCount: profile.reviewCount || 0,
            skills: profile.skills,
            city: profile.city,
            lat: profile.lat,
            lng: profile.lng,
            yearsExperience: profile.yearsExperience,
            verificationStatus: profile.verificationStatus,
          }
        : null,
    };
  });

  const trendsMap = proIds.length ? await slaTrendsForPros(proIds) : {};
  const shapedWithTrends = shapedBase.map((b) => {
    const trends = trendsMap[b.tradespersonId];
    if (!trends || !trends.clean) {
      return { ...b, proSlaTrends: null };
    }
    return {
      ...b,
      proSlaTrends: {
        d7: trends.d7,
        d30: trends.d30,
        clean: true,
      },
    };
  });

  // Wave 18/19: soft "viewed but no reply" flags (+ one-shot nudge; per-pro nudge hours)
  const proUsers = proIds.length
    ? await AppDataSource.getRepository(User)
        .createQueryBuilder("u")
        .where("u.id IN (:...ids)", { ids: proIds })
        .getMany()
    : [];
  const nudgeHoursByPro: Record<string, number | null | undefined> = Object.fromEntries(
    proUsers.map((u) => [u.id, u.quoteViewNudgeHours])
  );
  const shapedWithNudge = [];
  for (const b of shapedWithTrends) {
    const full = bids.find((x) => x.id === b.id);
    if (!full) {
      shapedWithNudge.push({ ...b, viewedNoReply: null });
      continue;
    }
    const { viewedNoReply } = await applyViewedNoReplyNudge(full, job, {
      thresholdHours: nudgeHoursByPro[full.tradespersonId],
    });
    shapedWithNudge.push({ ...b, viewedNoReply });
  }

  // Wave 21: attach match score (+ heat) for homeowner "best value" bid blend
  const matchWeights = await getMatchWeights();
  const heatWeightCfg = await getHeatWeight();
  const bestValueBlend = await getBestValueBlend();
  // Lightweight response hours from this job's bids only (demo-friendly)
  const responseHoursByPro: Record<string, number | null> = {};
  for (const b of bids) {
    const h = hoursBetween(job.createdAt, b.createdAt);
    if (h == null) continue;
    const prev = responseHoursByPro[b.tradespersonId];
    if (prev == null || h < prev) responseHoursByPro[b.tradespersonId] = h;
  }
  const shapedWithMatch = shapedWithNudge.map((b) => {
    const profile = profileMap[b.tradespersonId];
    if (!profile) {
      return {
        ...b,
        matchScore: null,
        heatBoost: 0,
        rankedScore: null,
        matchBreakdown: null,
      };
    }
    const input: ScoreablePro = {
      userId: profile.userId,
      skills: profile.skills,
      city: profile.city,
      serviceAreas: profile.serviceAreas,
      lat: profile.lat,
      lng: profile.lng,
      averageRating: Number(profile.averageRating || 0),
      reviewCount: profile.reviewCount || 0,
      avgResponseHours: responseHoursByPro[b.tradespersonId] ?? null,
      name: (b as any).tradesperson?.name || null,
    };
    const breakdown = scoreProForJob(job, input, matchWeights);
    const availabilityHeat = buildAvailabilityHeat(
      profile.weeklyAvailability as any,
      profile.blockedDates
    );
    const heatBoost = computeHeatBoost(availabilityHeat, heatWeightCfg);
    const rankedScore = Math.round((breakdown.total + heatBoost) * 10) / 10;
    return {
      ...b,
      matchScore: breakdown.total,
      heatBoost,
      rankedScore,
      matchBreakdown: breakdown,
    };
  });

  const jobAwarded =
    job.status === JobStatus.AWARDED ||
    job.status === JobStatus.IN_PROGRESS ||
    job.status === JobStatus.COMPLETED;

  if (role === UserRole.TRADESPERSON && !isAdmin) {
    const shaped = shapedWithMatch.map((b) => {
      if (b.tradespersonId === userId || jobAwarded) return b;
      const { amount: _a, ...rest } = b as any;
      return { ...rest, amount: null };
    });
    return res.json({ bids: shaped, bestValueBlend });
  }

  return res.json({ bids: shapedWithMatch, bestValueBlend });
}

export async function withdrawBid(req: Request, res: Response) {
  const bid = await bidRepo().findOne({ where: { id: param(req, "id") } });
  if (!bid) {
    return res.status(404).json({ message: "Bid not found", code: "NOT_FOUND" });
  }
  if (bid.tradespersonId !== req.user!.id) {
    return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
  }
  if (bid.status !== BidStatus.ACTIVE) {
    return res.status(400).json({ message: "Only active bids can be withdrawn", code: "BID_NOT_ACTIVE" });
  }

  const job = await jobRepo().findOne({ where: { id: bid.jobId } });
  if (!job || job.status !== JobStatus.OPEN) {
    return res.status(400).json({ message: "Can only withdraw while job is open", code: "JOB_NOT_OPEN" });
  }

  bid.status = BidStatus.WITHDRAWN;
  await bidRepo().save(bid);
  return res.json({ bid });
}

export async function acceptBid(req: Request, res: Response) {
  const bid = await bidRepo().findOne({ where: { id: param(req, "id") } });
  if (!bid) {
    return res.status(404).json({ message: "Bid not found", code: "NOT_FOUND" });
  }
  if (bid.status !== BidStatus.ACTIVE) {
    return res.status(400).json({ message: "Bid is not active", code: "BID_NOT_ACTIVE" });
  }

  const job = await jobRepo().findOne({ where: { id: bid.jobId } });
  if (!job) {
    return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });
  }
  if (job.homeownerId !== req.user!.id) {
    return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
  }
  if (job.status !== JobStatus.OPEN) {
    return res.status(400).json({ message: "Can only accept bids on open jobs", code: "JOB_NOT_OPEN" });
  }

  const rejectedIds: string[] = [];

  await AppDataSource.transaction(async (manager) => {
    bid.status = BidStatus.ACCEPTED;
    await manager.save(bid);

    const others = await manager.find(Bid, {
      where: { jobId: job.id, status: BidStatus.ACTIVE },
    });
    for (const other of others) {
      if (other.id === bid.id) continue;
      other.status = BidStatus.REJECTED;
      await manager.save(other);
      rejectedIds.push(other.tradespersonId);
    }

    job.status = JobStatus.AWARDED;
    job.acceptedBidId = bid.id;
    job.paymentStatus = PaymentStatus.HELD;
    const escrow = escrowAmountFromBid(bid);
    job.escrowAmount = escrow.amount;
    job.escrowSource = escrow.source;

    // Carry bid's proposed visit into job schedule as a proposal from the pro
    if (bid.proposedVisitStart) {
      job.scheduledStart = bid.proposedVisitStart;
      job.scheduledEnd =
        bid.proposedVisitEnd ||
        new Date(bid.proposedVisitStart.getTime() + 2 * 60 * 60 * 1000);
      job.scheduleStatus = ScheduleStatus.PROPOSED;
      job.scheduleProposedByUserId = bid.tradespersonId;
    }

    await manager.save(job);
    await createEscrowForAcceptedBid(job, bid, manager);
  });

  await invalidateOpenJobsCache();

  const escrowInfo = escrowAmountFromBid(bid);
  const escrowLabel =
    escrowInfo.source === "quote"
      ? `₹${escrowInfo.amount.toFixed(0)} (from accepted quote)`
      : `₹${escrowInfo.amount.toFixed(0)}`;
  await createNotification({
    userId: bid.tradespersonId,
    type: NotificationType.BID_ACCEPTED,
    title: "Bid accepted!",
    body: `Your bid on "${job.title}" was accepted. ${escrowLabel} is held in simulated escrow.`,
    link: `/tradesperson/jobs/${job.id}`,
    meta: { jobId: job.id, bidId: bid.id, escrowAmount: escrowInfo.amount, escrowSource: escrowInfo.source },
  });

  for (const tpId of rejectedIds) {
    await createNotification({
      userId: tpId,
      type: NotificationType.BID_REJECTED,
      title: "Bid not selected",
      body: `Another bid was accepted for "${job.title}".`,
      link: `/tradesperson`,
      meta: { jobId: job.id },
    });
  }

  const updatedJob = await jobRepo().findOne({ where: { id: job.id } });
  const bids = await bidRepo().find({ where: { jobId: job.id }, order: { createdAt: "ASC" } });
  const counter = bid.counterOffer || null;
  const counterAddressed = Boolean(counter && counter.status === "addressed");
  const counterSuggested = counter ? Number(counter.suggestedAmount) : null;
  const amountDiffersFromCounter =
    counterSuggested != null &&
    Number.isFinite(counterSuggested) &&
    Math.abs(escrowInfo.amount - counterSuggested) >= 1;
  return res.json({
    job: updatedJob,
    bids,
    escrow: {
      amount: escrowInfo.amount,
      source: escrowInfo.source,
      message:
        escrowInfo.source === "quote"
          ? "Simulated escrow funded from the structured quote amount."
          : "Simulated escrow funded from the bid amount.",
      counterAddressed,
      counterSuggested,
      amountDiffersFromCounter,
      softHoldPreview:
        counterAddressed && amountDiffersFromCounter
          ? {
              holdAmount: escrowInfo.amount,
              counterSuggested,
              delta: Math.round((escrowInfo.amount - (counterSuggested || 0)) * 100) / 100,
              note:
                "Counter was addressed with a different final amount — simulated escrow will hold the accepted quote/bid amount.",
            }
          : null,
    },
  });
}

export async function updateBidQuote(req: Request, res: Response) {
  const bid = await bidRepo().findOne({ where: { id: param(req, "id") } });
  if (!bid) {
    return res.status(404).json({ message: "Bid not found", code: "NOT_FOUND" });
  }
  if (bid.tradespersonId !== req.user!.id) {
    return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
  }
  if (bid.status !== BidStatus.ACTIVE) {
    return res.status(400).json({ message: "Only active bids can revise quotes", code: "BID_NOT_ACTIVE" });
  }

  const job = await jobRepo().findOne({ where: { id: bid.jobId } });
  if (!job || job.status !== JobStatus.OPEN) {
    return res.status(400).json({ message: "Can only revise quotes while job is open", code: "JOB_NOT_OPEN" });
  }

  const { quoteAmount, quoteNotes } = req.body ?? {};
  const hasAmount = quoteAmount !== undefined && quoteAmount !== "";
  const hasNotes = quoteNotes !== undefined;
  const quoteFile = (req as any).file as Express.Multer.File | undefined;
  const clearAttachment = String(req.body?.clearQuoteAttachment || "") === "1";

  if (!hasAmount && !hasNotes && !quoteFile && !clearAttachment) {
    return res.status(400).json({
      message: "Provide quoteAmount, quoteNotes, and/or quoteAttachment",
      code: "VALIDATION",
    });
  }

  let nextAmount = bid.quoteAmount != null ? Number(bid.quoteAmount) : undefined;
  if (hasAmount) {
    const qAmtRaw = Number(quoteAmount);
    if (!Number.isFinite(qAmtRaw) || qAmtRaw <= 0) {
      return res.status(400).json({ message: "quoteAmount must be a positive number" });
    }
    nextAmount = qAmtRaw;
  }

  let nextNotes = bid.quoteNotes;
  if (hasNotes) {
    nextNotes = quoteNotes ? String(quoteNotes).slice(0, 4000) : undefined;
  }

  let nextAttachment = bid.quoteAttachmentUrl;
  if (quoteFile) {
    nextAttachment = `/uploads/${quoteFile.filename}`;
  } else if (clearAttachment) {
    nextAttachment = undefined;
  }

  const prevAmount = bid.quoteAmount != null ? Number(bid.quoteAmount) : null;
  const prevNotes = bid.quoteNotes || null;
  const prevAttachment = bid.quoteAttachmentUrl || null;
  const changed =
    (nextAmount ?? null) !== prevAmount ||
    (nextNotes || null) !== prevNotes ||
    (nextAttachment || null) !== prevAttachment;

  if (!changed) {
    return res.json({ bid, message: "No quote changes" });
  }

  const history = Array.isArray(bid.quoteHistory) ? [...bid.quoteHistory] : [];
  history.push({
    amount: prevAmount,
    notes: prevNotes,
    attachmentUrl: prevAttachment,
    revisedAt: new Date().toISOString(),
  });
  // Keep a reasonable trail
  bid.quoteHistory = history.slice(-20);
  bid.quoteAmount = nextAmount;
  bid.quoteNotes = nextNotes;
  bid.quoteAttachmentUrl = nextAttachment;
  if (bid.counterOffer && bid.counterOffer.status === "pending") {
    bid.counterOffer = {
      ...bid.counterOffer,
      status: "addressed",
      addressedAt: new Date().toISOString(),
    };
  }
  await bidRepo().save(bid);

  const amountDelta =
    nextAmount != null && prevAmount != null
      ? Math.round((nextAmount - prevAmount) * 100) / 100
      : nextAmount != null && prevAmount == null
        ? nextAmount
        : null;
  const notesChanged = (nextNotes || null) !== prevNotes;
  const deltaParts: string[] = [];
  if (amountDelta != null && amountDelta !== 0) {
    const sign = amountDelta > 0 ? "+" : "";
    deltaParts.push(`amount ${sign}₹${Math.abs(amountDelta).toFixed(0)}`);
  } else if (prevAmount != null && nextAmount != null && amountDelta === 0) {
    deltaParts.push("amount unchanged");
  } else if (nextAmount != null && prevAmount == null) {
    deltaParts.push(`amount set to ₹${nextAmount.toFixed(0)}`);
  }
  if (notesChanged) deltaParts.push(nextNotes ? "notes updated" : "notes cleared");
  if ((nextAttachment || null) !== prevAttachment) {
    deltaParts.push(nextAttachment ? "attachment updated" : "attachment cleared");
  }
  const deltaSummary = deltaParts.length ? deltaParts.join(", ") : "quote updated";

  await createNotification({
    userId: job.homeownerId,
    type: NotificationType.NEW_BID,
    title: "Quote revised on a bid",
    body: `A tradesperson revised their quote on "${job.title}" (${deltaSummary}).`,
    link: `/homeowner/jobs/${job.id}?bid=${bid.id}#bid-${bid.id}`,
    meta: {
      jobId: job.id,
      bidId: bid.id,
      quoteRevised: true,
      previousAmount: prevAmount,
      newAmount: nextAmount ?? null,
      amountDelta,
      notesChanged,
      previousNotes: prevNotes,
      newNotes: nextNotes || null,
    },
  });

  return res.json({
    bid: {
      ...bid,
      quoteAmount: bid.quoteAmount != null ? Number(bid.quoteAmount) : null,
      quoteHistory: bid.quoteHistory || [],
    },
    message: "Quote revised",
    quoteDiff: {
      previousAmount: prevAmount,
      newAmount: nextAmount ?? null,
      amountDelta,
      notesChanged,
      previousNotes: prevNotes,
      newNotes: nextNotes || null,
    },
  });
}

/** Homeowner counter-offer / request revise on an active quote/bid. */
export async function requestQuoteRevise(req: Request, res: Response) {
  const bid = await bidRepo().findOne({ where: { id: param(req, "id") } });
  if (!bid) {
    return res.status(404).json({ message: "Bid not found", code: "NOT_FOUND" });
  }
  if (bid.status !== BidStatus.ACTIVE) {
    return res.status(400).json({ message: "Only active bids can receive a counter-offer", code: "BID_NOT_ACTIVE" });
  }

  const job = await jobRepo().findOne({ where: { id: bid.jobId } });
  if (!job) {
    return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });
  }
  if (job.homeownerId !== req.user!.id) {
    return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
  }
  if (job.status !== JobStatus.OPEN) {
    return res.status(400).json({ message: "Can only counter while job is open", code: "JOB_NOT_OPEN" });
  }

  const { suggestedAmount, notes } = req.body ?? {};
  const amt = Number(suggestedAmount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ message: "suggestedAmount must be a positive number", code: "VALIDATION" });
  }
  const noteText = notes != null ? String(notes).slice(0, 2000) : null;

  if (bid.counterOffer) {
    archiveCounterOffer(bid);
  }
  bid.counterOffer = {
    suggestedAmount: Math.round(amt * 100) / 100,
    notes: noteText,
    requestedAt: new Date().toISOString(),
    status: "pending",
  };
  await bidRepo().save(bid);

  const quotePart =
    bid.quoteAmount != null
      ? `current quote ₹${Number(bid.quoteAmount).toFixed(0)}`
      : `current bid ₹${Number(bid.amount).toFixed(0)}`;
  const noteHint = noteText ? ` Note: ${noteText.slice(0, 120)}` : "";

  await createNotification({
    userId: bid.tradespersonId,
    type: NotificationType.SYSTEM,
    title: "Counter-offer / revise requested",
    body: `Homeowner suggested ₹${amt.toFixed(0)} on "${job.title}" (${quotePart}).${noteHint}`,
    link: `/tradesperson/jobs/${job.id}?counter=1#bid-form`,
    meta: {
      jobId: job.id,
      bidId: bid.id,
      counterOffer: true,
      suggestedAmount: bid.counterOffer.suggestedAmount,
      notes: noteText,
      currentQuoteAmount: bid.quoteAmount != null ? Number(bid.quoteAmount) : null,
      currentBidAmount: Number(bid.amount),
    },
  });

  return res.json({
    bid: {
      id: bid.id,
      counterOffer: bid.counterOffer,
      counterHistory: bid.counterHistory || [],
      quoteAmount: bid.quoteAmount != null ? Number(bid.quoteAmount) : null,
    },
    message: "Counter-offer sent",
  });
}

/** Pro declines a pending homeowner counter-offer. */
export async function declineCounterOffer(req: Request, res: Response) {
  const bid = await bidRepo().findOne({ where: { id: param(req, "id") } });
  if (!bid) {
    return res.status(404).json({ message: "Bid not found", code: "NOT_FOUND" });
  }
  if (bid.tradespersonId !== req.user!.id) {
    return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
  }
  if (bid.status !== BidStatus.ACTIVE) {
    return res.status(400).json({ message: "Bid is not active", code: "BID_NOT_ACTIVE" });
  }
  if (!bid.counterOffer || bid.counterOffer.status !== "pending") {
    return res.status(400).json({
      message: "No pending counter-offer to decline",
      code: "NO_PENDING_COUNTER",
    });
  }

  const job = await jobRepo().findOne({ where: { id: bid.jobId } });
  if (!job) {
    return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });
  }

  const notesRaw = req.body?.notes != null ? String(req.body.notes).slice(0, 2000) : null;
  const declinedAt = new Date().toISOString();
  bid.counterOffer = {
    ...bid.counterOffer,
    status: "declined",
    declinedAt,
    declinedNotes: notesRaw,
  };
  await bidRepo().save(bid);

  await createNotification({
    userId: job.homeownerId,
    type: NotificationType.SYSTEM,
    title: "Counter-offer declined",
    body: notesRaw
      ? `Pro declined your counter (₹${Number(bid.counterOffer.suggestedAmount).toFixed(0)}) on "${job.title}": ${notesRaw.slice(0, 120)}`
      : `Pro declined your counter (₹${Number(bid.counterOffer.suggestedAmount).toFixed(0)}) on "${job.title}".`,
    link: `/homeowner/jobs/${job.id}?bid=${bid.id}#bid-${bid.id}`,
    meta: {
      jobId: job.id,
      bidId: bid.id,
      counterDeclined: true,
      suggestedAmount: bid.counterOffer.suggestedAmount,
      notes: notesRaw,
    },
  });

  return res.json({
    bid: {
      id: bid.id,
      counterOffer: bid.counterOffer,
      counterHistory: bid.counterHistory || [],
    },
    message: "Counter-offer declined",
  });
}

/** Force-check / return viewed-no-reply soft flag (also used by smoke). */
export async function checkViewedNoReply(req: Request, res: Response) {
  const bid = await bidRepo().findOne({ where: { id: param(req, "id") } });
  if (!bid) {
    return res.status(404).json({ message: "Bid not found", code: "NOT_FOUND" });
  }
  const job = await jobRepo().findOne({ where: { id: bid.jobId } });
  if (!job) {
    return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });
  }
  const isPro = bid.tradespersonId === req.user!.id;
  const isHome = job.homeownerId === req.user!.id;
  const isAdmin = req.user!.role === UserRole.ADMIN;
  if (!isPro && !isHome && !isAdmin) {
    return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
  }
  // Only the pro (or admin) triggers the notify side-effect
  const force = String(req.query.force || req.body?.force || "") === "1";
  const notify = isPro || isAdmin;
  const proUser = await AppDataSource.getRepository(User).findOne({
    where: { id: bid.tradespersonId },
  });
  const thresholdH = resolveQuoteViewNudgeHours(proUser?.quoteViewNudgeHours);
  const { viewedNoReply } = await applyViewedNoReplyNudge(bid, job, {
    forceNotify: notify && force,
    thresholdHours: proUser?.quoteViewNudgeHours,
  });
  // Soft override for smoke: if forceHours provided, recompute due
  const forceHours = Number(req.query.forceHours ?? req.body?.forceHours);
  if (Number.isFinite(forceHours) && forceHours >= 0 && bid.quoteViewedAt) {
    const histLen = Array.isArray(bid.quoteHistory) ? bid.quoteHistory.length : 0;
    const viewedCount = bid.quoteViewedRevisionCount ?? 0;
    const revisedSinceView = histLen > viewedCount;
    const due = !revisedSinceView && forceHours >= thresholdH;
    viewedNoReply.hoursSinceView = forceHours;
    viewedNoReply.due = due;
    viewedNoReply.thresholdHours = thresholdH;
    if (due && notify && !bid.quoteViewedNudgeSentAt) {
      await createNotification({
        userId: bid.tradespersonId,
        type: NotificationType.SYSTEM,
        title: "Viewed but no reply",
        body: `Homeowner viewed your revised quote on "${job.title}" ~${Math.floor(forceHours)}h ago with no further revise. Consider following up.`,
        link: `/tradesperson/jobs/${job.id}?nudge=viewed#bid-form`,
        meta: {
          jobId: job.id,
          bidId: bid.id,
          viewedNoReply: true,
          hoursSinceView: forceHours,
          thresholdHours: thresholdH,
          forced: true,
        },
      });
      bid.quoteViewedNudgeSentAt = new Date();
      await bidRepo().save(bid);
      viewedNoReply.nudged = true;
      viewedNoReply.nudgeSentAt = bid.quoteViewedNudgeSentAt.toISOString();
    }
  }
  return res.json({ bidId: bid.id, viewedNoReply, thresholdHours: thresholdH });
}

/** Homeowner viewed a revised quote — soft alert the pro (deduped per revision). */
export async function markQuoteViewed(req: Request, res: Response) {
  const bid = await bidRepo().findOne({ where: { id: param(req, "id") } });
  if (!bid) {
    return res.status(404).json({ message: "Bid not found", code: "NOT_FOUND" });
  }

  const job = await jobRepo().findOne({ where: { id: bid.jobId } });
  if (!job) {
    return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });
  }
  if (job.homeownerId !== req.user!.id) {
    return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
  }

  const histLen = Array.isArray(bid.quoteHistory) ? bid.quoteHistory.length : 0;
  if (histLen < 1) {
    return res.json({ viewed: false, message: "No revised quote to view", notified: false });
  }

  const prevCount = bid.quoteViewedRevisionCount ?? 0;
  const alreadySeen = prevCount >= histLen;
  bid.quoteViewedAt = new Date();
  bid.quoteViewedRevisionCount = histLen;
  await bidRepo().save(bid);

  let notified = false;
  if (!alreadySeen) {
    const latest = bid.quoteAmount != null ? Number(bid.quoteAmount) : null;
    await createNotification({
      userId: bid.tradespersonId,
      type: NotificationType.SYSTEM,
      title: "Homeowner viewed your revised quote",
      body:
        latest != null
          ? `Homeowner opened your revised quote (₹${latest.toFixed(0)}) on "${job.title}".`
          : `Homeowner opened your revised quote on "${job.title}".`,
      link: `/tradesperson/jobs/${job.id}`,
      meta: {
        jobId: job.id,
        bidId: bid.id,
        quoteViewed: true,
        revisionCount: histLen,
        quoteAmount: latest,
      },
    });
    notified = true;
  }

  return res.json({
    viewed: true,
    notified,
    quoteViewedAt: bid.quoteViewedAt,
    quoteViewedRevisionCount: bid.quoteViewedRevisionCount,
  });
}


type CounterEvent = {
  suggestedAmount: number;
  notes?: string | null;
  requestedAt: string;
  status: "pending" | "addressed" | "dismissed" | "declined";
  resolvedAt?: string | null;
  addressedAt?: string | null;
  declinedAt?: string | null;
  declinedNotes?: string | null;
  bidId: string;
  jobId: string;
  bidStatus: string;
};

function collectCounterEvents(bid: Bid): CounterEvent[] {
  const out: CounterEvent[] = [];
  const hist = Array.isArray(bid.counterHistory) ? bid.counterHistory : [];
  for (const h of hist) {
    out.push({
      suggestedAmount: Number(h.suggestedAmount),
      notes: h.notes ?? null,
      requestedAt: h.requestedAt,
      status: h.status,
      resolvedAt: h.resolvedAt ?? null,
      addressedAt: h.addressedAt ?? null,
      declinedAt: h.declinedAt ?? null,
      declinedNotes: h.declinedNotes ?? null,
      bidId: bid.id,
      jobId: bid.jobId,
      bidStatus: bid.status,
    });
  }
  if (bid.counterOffer) {
    out.push({
      suggestedAmount: Number(bid.counterOffer.suggestedAmount),
      notes: bid.counterOffer.notes ?? null,
      requestedAt: bid.counterOffer.requestedAt,
      status: bid.counterOffer.status,
      resolvedAt: null,
      addressedAt: bid.counterOffer.addressedAt ?? null,
      declinedAt: bid.counterOffer.declinedAt ?? null,
      declinedNotes: bid.counterOffer.declinedNotes ?? null,
      bidId: bid.id,
      jobId: bid.jobId,
      bidStatus: bid.status,
    });
  }
  return out;
}

function hoursBetweenIso(fromIso: string, toIso: string): number | null {
  const a = new Date(fromIso).getTime();
  const b = new Date(toIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round(((b - a) / 3600000) * 10) / 10;
}

function summarizeCounterEvents(events: CounterEvent[]) {
  let pending = 0;
  let addressed = 0;
  let declined = 0;
  let dismissed = 0;
  const addressHours: number[] = [];
  const declineHours: number[] = [];
  let afterAddressedAccepted = 0;
  let afterAddressedRejected = 0;
  let afterAddressedOpen = 0;

  for (const e of events) {
    if (e.status === "pending") pending += 1;
    else if (e.status === "addressed") {
      addressed += 1;
      const end = e.addressedAt || e.resolvedAt;
      if (end) {
        const h = hoursBetweenIso(e.requestedAt, end);
        if (h != null) addressHours.push(h);
      }
      if (e.bidStatus === BidStatus.ACCEPTED) afterAddressedAccepted += 1;
      else if (e.bidStatus === BidStatus.REJECTED) afterAddressedRejected += 1;
      else if (e.bidStatus === BidStatus.ACTIVE) afterAddressedOpen += 1;
    } else if (e.status === "declined") {
      declined += 1;
      const end = e.declinedAt || e.resolvedAt;
      if (end) {
        const h = hoursBetweenIso(e.requestedAt, end);
        if (h != null) declineHours.push(h);
      }
    } else if (e.status === "dismissed") {
      dismissed += 1;
    }
  }

  const sent = events.length;
  const avg = (arr: number[]) =>
    arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : null;
  const median = (arr: number[]) => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : Math.round(((s[mid - 1] + s[mid]) / 2) * 10) / 10;
  };

  return {
    sent,
    pending,
    addressed,
    declined,
    dismissed,
    addressRate: sent ? Math.round((addressed / sent) * 1000) / 10 : 0,
    declineRate: sent ? Math.round((declined / sent) * 1000) / 10 : 0,
    avgTimeToAddressHours: avg(addressHours),
    medianTimeToAddressHours: median(addressHours),
    avgTimeToDeclineHours: avg(declineHours),
    medianTimeToDeclineHours: median(declineHours),
    afterAddressedAccepted,
    afterAddressedRejected,
    afterAddressedOpen,
    addressSampleSize: addressHours.length,
    declineSampleSize: declineHours.length,
  };
}

/** Escrow what-if calculator: milestone split preview for an amount (before accept). */
export async function escrowWhatIf(req: Request, res: Response) {
  const bid = await bidRepo().findOne({ where: { id: param(req, "id") } });
  if (!bid) {
    return res.status(404).json({ message: "Bid not found", code: "NOT_FOUND" });
  }
  const job = await jobRepo().findOne({ where: { id: bid.jobId } });
  if (!job) {
    return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });
  }
  const isHome = job.homeownerId === req.user!.id;
  const isPro = bid.tradespersonId === req.user!.id;
  const isAdmin = req.user!.role === UserRole.ADMIN;
  if (!isHome && !isPro && !isAdmin) {
    return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
  }

  const fromBid = escrowAmountFromBid(bid);
  const rawAmount = req.query.amount ?? req.body?.amount;
  const amount =
    rawAmount !== undefined && rawAmount !== null && rawAmount !== ""
      ? Number(rawAmount)
      : fromBid.amount;
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ message: "amount must be a positive number", code: "VALIDATION" });
  }

  const preview = previewEscrowSplit(amount);
  const counter = bid.counterOffer || null;
  return res.json({
    bidId: bid.id,
    jobId: job.id,
    source: fromBid.source,
    defaultAmount: fromBid.amount,
    amount: preview.amount,
    milestones: preview.milestones,
    note: "Simulated escrow what-if — Deposit / Progress / Completion split if you accept at this amount.",
    counterOffer: counter
      ? {
          suggestedAmount: Number(counter.suggestedAmount),
          status: counter.status,
          deltaVsAmount:
            Math.round((preview.amount - Number(counter.suggestedAmount)) * 100) / 100,
        }
      : null,
  });
}

/** Homeowner aggregate (or per-job) + pro counter accept/reject analytics + time-to-address SLA. */
export async function getCounterAnalytics(req: Request, res: Response) {
  const role = req.user!.role;
  const jobId = req.query.jobId ? String(req.query.jobId) : null;

  if (role === UserRole.HOMEOWNER || (role === UserRole.ADMIN && !req.query.asPro)) {
    const homeownerId =
      role === UserRole.ADMIN && req.query.homeownerId
        ? String(req.query.homeownerId)
        : req.user!.id;
    let jobs = await jobRepo().find({ where: { homeownerId } });
    if (jobId) {
      jobs = jobs.filter((j) => j.id === jobId);
      if (!jobs.length) {
        return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });
      }
    }
    if (!jobs.length) {
      return res.json({
        role: "homeowner",
        homeownerId,
        jobId: jobId || null,
        jobs: 0,
        ...summarizeCounterEvents([]),
        byJob: [],
      });
    }
    const jobIds = jobs.map((j) => j.id);
    const bids = jobIds.length
      ? await bidRepo()
          .createQueryBuilder("b")
          .where("b.jobId IN (:...jobIds)", { jobIds })
          .getMany()
      : [];
    const events = bids.flatMap(collectCounterEvents);
    const byJob = jobs.map((j) => {
      const jobBids = bids.filter((b) => b.jobId === j.id);
      const ev = jobBids.flatMap(collectCounterEvents);
      return { jobId: j.id, title: j.title, ...summarizeCounterEvents(ev) };
    });
    return res.json({
      role: "homeowner",
      homeownerId,
      jobId: jobId || null,
      jobs: jobs.length,
      ...summarizeCounterEvents(events),
      byJob: jobId ? byJob : byJob.filter((j) => j.sent > 0).slice(0, 20),
    });
  }

  if (role === UserRole.TRADESPERSON || (role === UserRole.ADMIN && req.query.asPro)) {
    const proId =
      role === UserRole.ADMIN && req.query.tradespersonId
        ? String(req.query.tradespersonId)
        : req.user!.id;
    const bids = await bidRepo().find({ where: { tradespersonId: proId } });
    const events = bids.flatMap(collectCounterEvents);
    return res.json({
      role: "tradesperson",
      tradespersonId: proId,
      bids: bids.length,
      ...summarizeCounterEvents(events),
    });
  }

  return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
}
