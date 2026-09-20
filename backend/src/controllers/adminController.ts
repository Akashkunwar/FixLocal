import type { Request, Response } from "express";
import { In } from "typeorm";
import { AppDataSource } from "../data-source";
import { User, UserRole } from "../entities/User";
import { TradespersonProfile, VerificationStatus } from "../entities/TradespersonProfile";
import { Job, JobStatus } from "../entities/Job";
import { Dispute, DisputeResolution, DisputeStatus } from "../entities/Dispute";
import { Bid, BidStatus } from "../entities/Bid";
import { Review } from "../entities/Review";
import { AuditLog } from "../entities/AuditLog";
import { NotificationType } from "../entities/Notification";
import { invalidateOpenJobsCache } from "../utils/cache";
import { writeAudit, AuditAction } from "../utils/audit";
import { notifyFavoritersProAvailable } from "../utils/matchAlerts";
import { createNotifications } from "../utils/notifications";
import { revokeThreadStreams } from "../utils/sse";
import { haversineKm } from "../utils/geo";
import { scoreProForJob, type ScoreablePro } from "../utils/matchScore";
import { getMatchWeights, setMatchWeights, weightsSum, DEFAULT_MATCH_WEIGHTS, MATCH_WEIGHT_PRESETS, detectMatchPreset, normalizeMatchWeights, getHeatWeight, setHeatWeight, DEFAULT_HEAT_WEIGHT, normalizeHeatWeight, computeHeatBoost, getBestValueBlend, setBestValueBlend, DEFAULT_BEST_VALUE_BLEND, blendsEqual, normalizeBestValueBlend, BEST_VALUE_BLEND_PRESETS, detectBestValueBlendPreset, getShortlistInviteMinHeat, setShortlistInviteMinHeat } from "../utils/matchWeights";
import { scoreBestValueBids, escrowHoldFromAmounts } from "../utils/bestValueScore";
import { hoursBetween, buildEventSla } from "../utils/responseSla";
import { loadJobToBidSamples } from "../utils/proSlaBatch";
import { buildAvailabilityHeat, DEFAULT_SHORTLIST_INVITE_MIN_HEAT } from "../utils/availabilityHeat";
import { invalidateAuthState } from "../auth/authState";
import { revokeAllRefreshTokens } from "../auth/tokens";
import { transitionJob } from "../domain/jobStateMachine";
import { refundMilestones } from "../domain/escrow";
import { mean } from "../domain/analytics";
import { signedUrl } from "../services/files";
import { badRequest, notFound } from "../http/errors";

async function suspendUser(userId: string, suspend: boolean) {
  const repo = AppDataSource.getRepository(User);
  if (suspend) {
    await repo.update({ id: userId }, { isSuspended: true });
    await repo.increment({ id: userId }, "tokenVersion", 1);
    await revokeAllRefreshTokens(userId);
  } else {
    await repo.update({ id: userId }, { isSuspended: false });
  }
  await invalidateAuthState(userId);
}

export async function verifyTradesperson(req: Request, res: Response) {
  const userId = req.valid.params.id as string;
  const user = await AppDataSource.getRepository(User).findOne({ where: { id: userId } });
  if (!user || user.role !== UserRole.TRADESPERSON || user.deletedAt) throw notFound("Professional not found");
  const repo = AppDataSource.getRepository(TradespersonProfile);
  const profile = (await repo.findOne({ where: { userId } })) || repo.create({ userId, galleryUrls: [] });
  const status = req.valid.body.status as VerificationStatus;
  const previous = profile.verificationStatus;
  profile.verificationStatus = status;
  profile.verifiedAt = status === VerificationStatus.VERIFIED ? new Date() : undefined;
  await repo.save(profile);
  if (status === VerificationStatus.SUSPENDED) await suspendUser(userId, true);
  else if (user.isSuspended && status === VerificationStatus.VERIFIED) await suspendUser(userId, false);
  else await invalidateAuthState(userId);

  if (status === VerificationStatus.VERIFIED && previous !== VerificationStatus.VERIFIED) {
    await notifyFavoritersProAvailable(user.id, "is now verified and available to hire").catch(() => undefined);
    await createNotifications([
      {
        userId,
        type: NotificationType.SYSTEM,
        title: "You're verified",
        body: "Your professional account is verified. You can now bid on jobs.",
        link: "/professional",
      },
    ]);
  }
  await writeAudit({
    actorUserId: req.user!.id,
    actorEmail: req.user!.email,
    action: AuditAction.VERIFY_TRADESPERSON,
    targetType: "user",
    targetId: user.id,
    summary: `Set verification to ${status} for ${user.email}`,
    meta: { status, previous, email: user.email },
  });
  return res.json({
    profile: { id: profile.id, userId, verificationStatus: profile.verificationStatus, verifiedAt: profile.verifiedAt ?? null },
    user: { id: user.id, isSuspended: status === VerificationStatus.SUSPENDED ? true : user.isSuspended && status !== VerificationStatus.VERIFIED },
  });
}

export async function listTradespeople(req: Request, res: Response) {
  const { status, page = 1, limit = 100 } = req.valid.query;
  const qb = AppDataSource.getRepository(TradespersonProfile)
    .createQueryBuilder("p")
    .innerJoinAndSelect("p.user", "user")
    .where("user.deletedAt IS NULL")
    .orderBy("p.createdAt", "DESC")
    .skip((page - 1) * limit)
    .take(limit);
  if (status) qb.andWhere("p.verificationStatus = :status", { status });
  const [rows, total] = await qb.getManyAndCount();
  return res.json({
    total,
    tradespeople: rows.map((p) => ({
      id: p.id,
      userId: p.userId,
      email: p.user?.email,
      name: p.user?.name,
      phone: p.user?.phone ?? null,
      skills: p.skills,
      serviceAreas: p.serviceAreas,
      city: p.city,
      yearsExperience: p.yearsExperience ?? null,
      licenseDocUrl: signedUrl(p.licenseDocUrl),
      averageRating: Number(p.averageRating || 0),
      reviewCount: p.reviewCount || 0,
      verificationStatus: p.verificationStatus,
      verifiedAt: p.verifiedAt,
      isSuspended: !!p.user?.isSuspended,
      emailVerified: !!p.user?.emailVerifiedAt,
      createdAt: p.createdAt,
    })),
  });
}

export async function listUsers(req: Request, res: Response) {
  const { role, q, suspended, page = 1, limit = 100 } = req.valid.query;
  const qb = AppDataSource.getRepository(User)
    .createQueryBuilder("u")
    .leftJoinAndSelect("u.tradespersonProfile", "p")
    .where("u.deletedAt IS NULL")
    .orderBy("u.createdAt", "DESC")
    .skip((page - 1) * limit)
    .take(limit);
  if (role) qb.andWhere("u.role = :role", { role });
  if (suspended) qb.andWhere("u.isSuspended = true");
  if (q) {
    const text = String(q).trim();
    // Links from reports/audit pass a user id; everything else is a text search.
    const byId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text);
    qb.andWhere(
      byId ? "u.id = :id" : "(u.email ILIKE :q OR u.name ILIKE :q OR u.phone ILIKE :q)",
      byId ? { id: text } : { q: `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%` }
    );
  }
  const [users, total] = await qb.getManyAndCount();
  return res.json({
    total,
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      phone: u.phone,
      role: u.role,
      isSuspended: !!u.isSuspended,
      emailVerified: !!u.emailVerifiedAt,
      createdAt: u.createdAt,
      verificationStatus: u.tradespersonProfile?.verificationStatus || null,
    })),
  });
}

export async function setUserSuspended(req: Request, res: Response) {
  const userId = req.valid.params.id as string;
  const suspend = req.valid.body.suspended as boolean;
  const user = await AppDataSource.getRepository(User).findOne({ where: { id: userId } });
  if (!user || user.deletedAt) throw notFound("User not found");
  if (user.role === UserRole.ADMIN) throw badRequest("Admin accounts can't be suspended", "FORBIDDEN");
  if (user.id === req.user!.id) throw badRequest("You can't suspend yourself", "FORBIDDEN");
  await suspendUser(user.id, suspend);

  if (user.role === UserRole.TRADESPERSON) {
    const repo = AppDataSource.getRepository(TradespersonProfile);
    const profile = (await repo.findOne({ where: { userId: user.id } })) || repo.create({ userId: user.id, galleryUrls: [] });
    if (suspend) {
      profile.verificationStatus = VerificationStatus.SUSPENDED;
    } else if (profile.verificationStatus === VerificationStatus.SUSPENDED) {
      profile.verificationStatus = VerificationStatus.PENDING;
      profile.verifiedAt = undefined;
    }
    await repo.save(profile);
    await invalidateAuthState(user.id);
  }
  if (suspend) {
    // Suspended users' open listings and bids stop being visible.
    await AppDataSource.query(`UPDATE "bids" SET "status" = 'withdrawn' WHERE "tradespersonId" = $1 AND "status" = 'active'`, [user.id]);
    await invalidateOpenJobsCache();
  }
  await writeAudit({
    actorUserId: req.user!.id,
    actorEmail: req.user!.email,
    action: suspend ? AuditAction.USER_SUSPEND : AuditAction.USER_UNSUSPEND,
    targetType: "user",
    targetId: user.id,
    summary: `${suspend ? "Suspended" : "Unsuspended"} ${user.email}`,
    meta: { role: user.role, email: user.email },
  });
  return res.json({ user: { id: user.id, email: user.email, role: user.role, isSuspended: suspend } });
}

export async function adminStats(_req: Request, res: Response) {
  const users = AppDataSource.getRepository(User);
  const jobs = AppDataSource.getRepository(Job);
  const count = (status: JobStatus) => jobs.count({ where: { status } });
  const [
    totalUsers,
    homeowners,
    tradespeople,
    openJobs,
    awardedJobs,
    inProgressJobs,
    pendingConfirmationJobs,
    completedJobs,
    cancelledJobs,
    disputedJobs,
    openDisputes,
    pendingVerifications,
    suspendedUsers,
    activeBids,
    totalReviews,
    ledger,
    openReports,
  ] = await Promise.all([
    users.count(),
    users.count({ where: { role: UserRole.HOMEOWNER } }),
    users.count({ where: { role: UserRole.TRADESPERSON } }),
    count(JobStatus.OPEN),
    count(JobStatus.AWARDED),
    count(JobStatus.IN_PROGRESS),
    count(JobStatus.PENDING_CONFIRMATION),
    count(JobStatus.COMPLETED),
    count(JobStatus.CANCELLED),
    count(JobStatus.DISPUTED),
    AppDataSource.getRepository(Dispute).count({ where: { status: DisputeStatus.OPEN } }),
    AppDataSource.getRepository(TradespersonProfile).count({ where: { verificationStatus: VerificationStatus.PENDING } }),
    users.count({ where: { isSuspended: true } }),
    AppDataSource.getRepository(Bid).count({ where: { status: BidStatus.ACTIVE } }),
    AppDataSource.getRepository(Review).count(),
    AppDataSource.query(
      `SELECT COALESCE(SUM(CASE WHEN "type" = 'release' THEN "amount" END), 0) AS released,
              COALESCE(SUM(CASE WHEN "type" = 'refund' THEN "amount" END), 0) AS refunded,
              COALESCE(SUM(CASE WHEN "type" = 'hold' THEN "amount" END), 0) AS held
         FROM "ledger_entries"`
    ),
    AppDataSource.query(`SELECT COUNT(*)::int AS n FROM "reports" WHERE "status" = 'open'`),
  ]);
  const l = ledger[0] || {};
  const released = Number(l.released || 0);
  const refunded = Number(l.refunded || 0);
  return res.json({
    stats: {
      totalUsers,
      homeowners,
      tradespeople,
      openJobs,
      awardedJobs,
      inProgressJobs,
      pendingConfirmationJobs,
      completedJobs,
      cancelledJobs,
      disputedJobs,
      openDisputes,
      pendingVerifications,
      suspendedUsers,
      activeBids,
      totalReviews,
      openReports: openReports[0]?.n ?? 0,
      simulatedGMV: released,
      escrowReleased: released,
      escrowRefunded: refunded,
      escrowOutstanding: Math.round((Number(l.held || 0) - released - refunded) * 100) / 100,
    },
  });
}

/** Admin cancel: refunds unreleased escrow, closes bids and disputes, tells both sides. */
export async function forceCancelJob(req: Request, res: Response) {
  const jobId = req.valid.params.id as string;
  const job = await AppDataSource.getRepository(Job).findOne({ where: { id: jobId } });
  if (!job) throw notFound("Job not found");
  const reason = (req.valid.body.reason as string | undefined) || "Cancelled by an admin";
  const outcome = await AppDataSource.transaction(async (m) => {
    const previous = await transitionJob(m, jobId, "force_cancel");
    const active = await m.find(Bid, { where: { jobId, status: BidStatus.ACTIVE } });
    if (active.length) await m.update(Bid, { id: In(active.map((b) => b.id)) }, { status: BidStatus.REJECTED });
    const refund = await refundMilestones(m, job, "all_unreleased", req.user!.id, reason);
    const disputes = await m.update(
      Dispute,
      { jobId, status: DisputeStatus.OPEN },
      { status: DisputeStatus.RESOLVED, resolution: DisputeResolution.NO_ACTION, resolutionNotes: `Job force-cancelled: ${reason}`, resolvedAt: new Date() }
    );
    const accepted = job.acceptedBidId ? await m.findOne(Bid, { where: { id: job.acceptedBidId } }) : null;
    await writeAudit(
      {
        actorUserId: req.user!.id,
        actorEmail: req.user!.email,
        action: AuditAction.FORCE_CANCEL,
        targetType: "job",
        targetId: jobId,
        summary: `Force-cancelled job "${job.title}" (was ${previous})`,
        meta: { title: job.title, previousStatus: previous, reason, refunded: refund.totalRefunded, disputesClosed: disputes.affected ?? 0 },
      },
      m
    );
    return { previous, bidders: active.map((b) => b.tradespersonId), proId: accepted?.tradespersonId ?? null, refund };
  });
  await invalidateOpenJobsCache();
  await revokeThreadStreams(jobId, null);
  const recipients = new Set([job.homeownerId, outcome.proId, ...outcome.bidders].filter(Boolean) as string[]);
  await createNotifications(
    [...recipients].map((userId) => ({
      userId,
      type: NotificationType.JOB_STATUS,
      title: "Job cancelled by FixLocal",
      body: `"${job.title}" was cancelled by an admin: ${reason}${
        outcome.refund.totalRefunded && userId === job.homeownerId ? ` · ₹${outcome.refund.totalRefunded.toFixed(0)} refunded (simulated)` : ""
      }`,
      link: userId === job.homeownerId ? `/client/jobs/${jobId}` : "/professional",
      meta: { jobId, forceCancelled: true },
    }))
  );
  const fresh = await AppDataSource.getRepository(Job).findOneOrFail({ where: { id: jobId } });
  return res.json({ job: { id: fresh.id, title: fresh.title, status: fresh.status, paymentStatus: fresh.paymentStatus }, previousStatus: outcome.previous });
}

export async function listAuditLogs(req: Request, res: Response) {
  const { action, limit = 50, before } = req.valid.query;
  const qb = AppDataSource.getRepository(AuditLog).createQueryBuilder("a").orderBy("a.createdAt", "DESC").take(limit);
  if (action) qb.andWhere("a.action = :action", { action });
  if (before) qb.andWhere("a.createdAt < :before", { before });
  const logs = await qb.getMany();
  return res.json({ logs, nextBefore: logs.length === limit ? logs[logs.length - 1].createdAt : null });
}

export async function createAdminNote(req: Request, res: Response) {
  const { note, targetType, targetId, summary } = req.valid.body;
  const log = await writeAudit({
    actorUserId: req.user!.id,
    actorEmail: req.user!.email,
    action: AuditAction.ADMIN_NOTE,
    targetType,
    targetId,
    summary: summary || note.slice(0, 200),
    meta: { note },
  });
  return res.status(201).json({ log });
}

/** Richer match-quality: open jobs vs scored verified pros (skills, rating, response, distance). */
async function avgResponseHoursByPro(proUserIds: string[]): Promise<Record<string, number | null>> {
  const samples = await loadJobToBidSamples(proUserIds, 40);
  const out: Record<string, number | null> = {};
  for (const id of proUserIds) out[id] = mean((samples[id] || []).map((s) => s.hours));
  return out;
}


export async function getMatchWeightsConfig(_req: Request, res: Response) {
  const weights = await getMatchWeights();
  const heatWeight = await getHeatWeight();
  const bestValueBlend = await getBestValueBlend();
  const shortlistInviteMinHeat = await getShortlistInviteMinHeat();
  return res.json({
    shortlistInviteMinHeat,
    defaultShortlistInviteMinHeat: DEFAULT_SHORTLIST_INVITE_MIN_HEAT,
    weights,
    defaults: DEFAULT_MATCH_WEIGHTS,
    sum: weightsSum(weights),
    preset: detectMatchPreset(weights, heatWeight),
    presets: Object.values(MATCH_WEIGHT_PRESETS),
    heatWeight,
    defaultHeatWeight: DEFAULT_HEAT_WEIGHT,
    bestValueBlend,
    defaultBestValueBlend: DEFAULT_BEST_VALUE_BLEND,
    bestValueBlendPreset: detectBestValueBlendPreset(bestValueBlend),
    bestValueBlendPresets: Object.values(BEST_VALUE_BLEND_PRESETS),
  });
}

export async function updateMatchWeightsConfig(req: Request, res: Response) {
  const presetId = req.body?.preset != null ? String(req.body.preset) : "";
  let presetHeat: number | null = null;
  let nextWeightsRaw: Partial<typeof DEFAULT_MATCH_WEIGHTS> | null = null;
  if (presetId && MATCH_WEIGHT_PRESETS[presetId as keyof typeof MATCH_WEIGHT_PRESETS]) {
    const pr = MATCH_WEIGHT_PRESETS[presetId as keyof typeof MATCH_WEIGHT_PRESETS];
    nextWeightsRaw = pr.weights;
    presetHeat = pr.heatWeight;
  } else if (req.body?.weights != null && typeof req.body.weights === "object") {
    nextWeightsRaw = req.body.weights;
  } else if (
    req.body?.skills != null ||
    req.body?.rating != null ||
    req.body?.response != null ||
    req.body?.distance != null
  ) {
    // Legacy flat body { skills, rating, ... }
    nextWeightsRaw = req.body;
  }
  const before = await getMatchWeights();
  const beforeHeat = await getHeatWeight();
  const beforeMinHeat = await getShortlistInviteMinHeat();
  const rawMinHeat = req.body?.shortlistInviteMinHeat;
  if (rawMinHeat !== undefined && rawMinHeat !== null && rawMinHeat !== "") {
    const n = Number(rawMinHeat);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      throw badRequest("The shortlist availability gate must be between 0 and 100", "VALIDATION");
    }
  }
  const minHeat =
    rawMinHeat !== undefined && rawMinHeat !== null && rawMinHeat !== ""
      ? await setShortlistInviteMinHeat(rawMinHeat)
      : beforeMinHeat;
  // Wave 24: blend-only updates must not clobber match weights with defaults
  const weights = nextWeightsRaw != null ? await setMatchWeights(nextWeightsRaw) : before;
  let heatWeight = beforeHeat;
  if (req.body?.heatWeight !== undefined && req.body?.heatWeight !== null && req.body?.heatWeight !== "") {
    heatWeight = await setHeatWeight(req.body.heatWeight);
  } else if (presetHeat != null) {
    // Wave 21: presets include heat weight
    heatWeight = await setHeatWeight(presetHeat);
  }
  const beforeBlend = await getBestValueBlend();
  let bestValueBlend = beforeBlend;
  let blendTouched = false;
  const blendPresetId =
    req.body?.bestValueBlendPreset != null
      ? String(req.body.bestValueBlendPreset)
      : req.body?.blendPreset != null
        ? String(req.body.blendPreset)
        : "";
  if (
    blendPresetId &&
    BEST_VALUE_BLEND_PRESETS[blendPresetId as keyof typeof BEST_VALUE_BLEND_PRESETS]
  ) {
    const pr = BEST_VALUE_BLEND_PRESETS[blendPresetId as keyof typeof BEST_VALUE_BLEND_PRESETS];
    bestValueBlend = await setBestValueBlend(pr.blend);
    blendTouched = true;
  } else if (req.body?.bestValueBlend !== undefined && req.body?.bestValueBlend !== null) {
    bestValueBlend = await setBestValueBlend(req.body.bestValueBlend);
    blendTouched = true;
  } else if (
    req.body?.matchPct !== undefined ||
    req.body?.pricePct !== undefined ||
    req.body?.slaHeatPct !== undefined
  ) {
    bestValueBlend = await setBestValueBlend({
      matchPct: req.body?.matchPct ?? bestValueBlend.matchPct,
      pricePct: req.body?.pricePct ?? bestValueBlend.pricePct,
      slaHeatPct: req.body?.slaHeatPct ?? bestValueBlend.slaHeatPct,
    });
    blendTouched = true;
  }
  const preset = detectMatchPreset(weights, heatWeight);
  const weightsChanged =
    before.skills !== weights.skills ||
    before.rating !== weights.rating ||
    before.response !== weights.response ||
    before.distance !== weights.distance ||
    beforeHeat !== heatWeight ||
    beforeMinHeat !== minHeat;
  if (weightsChanged) {
    try {
      await writeAudit({
        actorUserId: req.user!.id,
        actorEmail: req.user!.email,
        action: AuditAction.MATCH_WEIGHTS_UPDATE,
        targetType: "app_config",
        targetId: undefined,
        summary:
          (preset
            ? `Match weights preset "${preset}" applied (heat ${heatWeight})`
            : `Match weights updated (sk${weights.skills}/rt${weights.rating}/rs${weights.response}/ds${weights.distance}, heat ${heatWeight})`) +
          (beforeMinHeat !== minHeat ? ` · shortlist gate ${beforeMinHeat} → ${minHeat}` : ""),
        meta: {
          // Include heat and the shortlist gate in before/after snapshots for clean rollback
          before: { ...before, heatWeight: beforeHeat, shortlistInviteMinHeat: beforeMinHeat },
          after: { ...weights, heatWeight, shortlistInviteMinHeat: minHeat },
          preset: preset || null,
          beforeHeatWeight: beforeHeat,
          afterHeatWeight: heatWeight,
        },
      });
    } catch (e) {
      console.warn("audit match weights failed", e);
    }
  }
  // Wave 23: dedicated audit + rollback snapshots for best_value_blend
  if (blendTouched && !blendsEqual(beforeBlend, bestValueBlend)) {
    try {
      await writeAudit({
        actorUserId: req.user!.id,
        actorEmail: req.user!.email,
        action: AuditAction.BEST_VALUE_BLEND_UPDATE,
        targetType: "app_config",
        targetId: undefined,
        summary: `Best-value blend updated (mt${bestValueBlend.matchPct}/px${bestValueBlend.pricePct}/sh${bestValueBlend.slaHeatPct}${detectBestValueBlendPreset(bestValueBlend) ? ` · ${detectBestValueBlendPreset(bestValueBlend)}` : ""})`,
        meta: {
          before: { ...beforeBlend },
          after: { ...bestValueBlend },
          key: "best_value_blend",
          blendPreset: detectBestValueBlendPreset(bestValueBlend),
        },
      });
    } catch (e) {
      console.warn("audit best_value_blend failed", e);
    }
  }
  const bestValueBlendPreset = detectBestValueBlendPreset(bestValueBlend);
  return res.json({
    ok: true,
    shortlistInviteMinHeat: minHeat,
    defaultShortlistInviteMinHeat: DEFAULT_SHORTLIST_INVITE_MIN_HEAT,
    weights,
    defaults: DEFAULT_MATCH_WEIGHTS,
    sum: weightsSum(weights),
    preset,
    presets: Object.values(MATCH_WEIGHT_PRESETS),
    heatWeight,
    defaultHeatWeight: DEFAULT_HEAT_WEIGHT,
    bestValueBlend,
    defaultBestValueBlend: DEFAULT_BEST_VALUE_BLEND,
    bestValueBlendPreset,
    bestValueBlendPresets: Object.values(BEST_VALUE_BLEND_PRESETS),
    message: blendTouched && bestValueBlendPreset
      ? `Best-value blend preset "${bestValueBlendPreset}" saved`
      : preset
        ? `Preset "${preset}" saved (heat ${heatWeight})`
        : blendTouched
          ? `Best-value blend saved (mt${bestValueBlend.matchPct}/px${bestValueBlend.pricePct}/sh${bestValueBlend.slaHeatPct})`
          : "Match score weights saved",
  });
}


/** Roll back match weights to the `before` snapshot on a match_weights_update audit row, if clean. */
export async function rollbackMatchWeightsFromAudit(req: Request, res: Response) {
  const auditLogId = req.valid.body.auditLogId as string;

  const log = await AppDataSource.getRepository(AuditLog).findOne({ where: { id: auditLogId } });
  if (!log) {
    return res.status(404).json({ message: "Audit log not found", code: "NOT_FOUND" });
  }
  if (log.action !== AuditAction.MATCH_WEIGHTS_UPDATE) {
    return res.status(400).json({
      message: "Only match_weights_update audit rows can be rolled back",
      code: "WRONG_ACTION",
    });
  }

  const beforeRaw = log.meta?.before;
  if (!beforeRaw || typeof beforeRaw !== "object") {
    return res.status(400).json({
      message: "Audit row has no clean before snapshot",
      code: "NOT_CLEAN",
    });
  }

  const raw = beforeRaw as Record<string, unknown>;
  const keys = ["skills", "rating", "response", "distance"] as const;
  for (const k of keys) {
    const n = Number(raw[k]);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      return res.status(400).json({
        message: `Before snapshot is not clean (${k})`,
        code: "NOT_CLEAN",
      });
    }
  }

  const target = normalizeMatchWeights(raw);
  const sum = weightsSum(target);
  // Clean = sane total (allow custom weights that don't sum exactly to 100)
  if (sum < 40 || sum > 160) {
    return res.status(400).json({
      message: `Before snapshot sum ${sum} is out of clean range`,
      code: "NOT_CLEAN",
    });
  }

  // Wave 21: restore heat weight from clean before snapshot when present
  const metaHeat =
    log.meta?.beforeHeatWeight != null
      ? log.meta.beforeHeatWeight
      : raw.heatWeight;
  let targetHeat: number | null = null;
  if (metaHeat !== undefined && metaHeat !== null && metaHeat !== "") {
    const n = Number(metaHeat);
    if (!Number.isFinite(n) || n < 0 || n > 20) {
      return res.status(400).json({
        message: "Before heatWeight snapshot is not clean",
        code: "NOT_CLEAN",
      });
    }
    targetHeat = normalizeHeatWeight(n);
  }

  const current = await getMatchWeights();
  const currentHeat = await getHeatWeight();
  const currentMinHeat = await getShortlistInviteMinHeat();
  const rawBeforeMinHeat = raw.shortlistInviteMinHeat;
  if (rawBeforeMinHeat !== undefined && rawBeforeMinHeat !== null) {
    const n = Number(rawBeforeMinHeat);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      return res.status(400).json({ message: "Before shortlist gate snapshot is not clean", code: "NOT_CLEAN" });
    }
  }
  const weights = await setMatchWeights(target);
  const minHeat =
    rawBeforeMinHeat !== undefined && rawBeforeMinHeat !== null
      ? await setShortlistInviteMinHeat(rawBeforeMinHeat)
      : currentMinHeat;
  const heatWeight =
    targetHeat != null ? await setHeatWeight(targetHeat) : await getHeatWeight();
  const preset = detectMatchPreset(weights, heatWeight);

  try {
    await writeAudit({
      actorUserId: req.user!.id,
      actorEmail: req.user!.email,
      action: AuditAction.MATCH_WEIGHTS_UPDATE,
      targetType: "app_config",
      summary: preset
        ? `Match weights rolled back to preset "${preset}" (heat ${heatWeight})`
        : `Match weights rolled back from audit ${auditLogId.slice(0, 8)} (heat ${heatWeight})`,
      meta: {
        before: { ...current, heatWeight: currentHeat, shortlistInviteMinHeat: currentMinHeat },
        after: { ...weights, heatWeight, shortlistInviteMinHeat: minHeat },
        preset: preset || null,
        beforeHeatWeight: currentHeat,
        afterHeatWeight: heatWeight,
        rollbackFrom: auditLogId,
        rollback: true,
      },
    });
  } catch (e) {
    console.warn("audit rollback failed", e);
  }

  const bestValueBlend = await getBestValueBlend();
  return res.json({
    ok: true,
    weights,
    defaults: DEFAULT_MATCH_WEIGHTS,
    sum: weightsSum(weights),
    preset,
    presets: Object.values(MATCH_WEIGHT_PRESETS),
    heatWeight,
    defaultHeatWeight: DEFAULT_HEAT_WEIGHT,
    bestValueBlend,
    defaultBestValueBlend: DEFAULT_BEST_VALUE_BLEND,
    bestValueBlendPreset: detectBestValueBlendPreset(bestValueBlend),
    bestValueBlendPresets: Object.values(BEST_VALUE_BLEND_PRESETS),
    rolledBackFrom: auditLogId,
    shortlistInviteMinHeat: minHeat,
    message: preset
      ? `Rolled back to preset "${preset}" (heat ${heatWeight})`
      : `Match weights rolled back from audit (heat ${heatWeight})`,
  });
}

/** Roll back best_value_blend to the `before` snapshot on a best_value_blend_update audit row. */
export async function rollbackBestValueBlendFromAudit(req: Request, res: Response) {
  const auditLogId = req.valid.body.auditLogId as string;

  const log = await AppDataSource.getRepository(AuditLog).findOne({ where: { id: auditLogId } });
  if (!log) {
    return res.status(404).json({ message: "Audit log not found", code: "NOT_FOUND" });
  }
  if (log.action !== AuditAction.BEST_VALUE_BLEND_UPDATE) {
    return res.status(400).json({
      message: "Only best_value_blend_update audit rows can be rolled back",
      code: "WRONG_ACTION",
    });
  }

  const beforeRaw = log.meta?.before;
  if (!beforeRaw || typeof beforeRaw !== "object") {
    return res.status(400).json({
      message: "Audit row has no clean before snapshot",
      code: "NOT_CLEAN",
    });
  }

  const raw = beforeRaw as Record<string, unknown>;
  for (const k of ["matchPct", "pricePct"] as const) {
    const n = Number(raw[k]);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      return res.status(400).json({
        message: `Before snapshot is not clean (${k})`,
        code: "NOT_CLEAN",
      });
    }
  }
  if (raw.slaHeatPct != null && raw.slaHeatPct !== "") {
    const n = Number(raw.slaHeatPct);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      return res.status(400).json({
        message: "Before snapshot is not clean (slaHeatPct)",
        code: "NOT_CLEAN",
      });
    }
  }

  const target = normalizeBestValueBlend(raw);
  const sum = target.matchPct + target.pricePct + (target.slaHeatPct || 0);
  if (sum < 90 || sum > 110) {
    return res.status(400).json({
      message: `Before blend sum ${sum} is out of clean range`,
      code: "NOT_CLEAN",
    });
  }

  const current = await getBestValueBlend();
  const bestValueBlend = await setBestValueBlend(target);

  try {
    await writeAudit({
      actorUserId: req.user!.id,
      actorEmail: req.user!.email,
      action: AuditAction.BEST_VALUE_BLEND_UPDATE,
      targetType: "app_config",
      summary: `Best-value blend rolled back from audit ${auditLogId.slice(0, 8)} (mt${bestValueBlend.matchPct}/px${bestValueBlend.pricePct}/sh${bestValueBlend.slaHeatPct})`,
      meta: {
        before: { ...current },
        after: { ...bestValueBlend },
        key: "best_value_blend",
        rollbackFrom: auditLogId,
        rollback: true,
      },
    });
  } catch (e) {
    console.warn("audit best_value_blend rollback failed", e);
  }

  const weights = await getMatchWeights();
  const heatWeight = await getHeatWeight();
  return res.json({
    ok: true,
    bestValueBlend,
    defaultBestValueBlend: DEFAULT_BEST_VALUE_BLEND,
    bestValueBlendPreset: detectBestValueBlendPreset(bestValueBlend),
    bestValueBlendPresets: Object.values(BEST_VALUE_BLEND_PRESETS),
    weights,
    heatWeight,
    rolledBackFrom: auditLogId,
    message: `Best-value blend rolled back (mt${bestValueBlend.matchPct}/px${bestValueBlend.pricePct}/sh${bestValueBlend.slaHeatPct})`,
  });
}


/** Live best-value blend preview vs a sample of open jobs with ≥2 active bids. */
export async function previewBestValueBlend(req: Request, res: Response) {
  const saved = await getBestValueBlend();
  const draftRaw =
    req.query.matchPct != null ||
    req.query.pricePct != null ||
    req.query.slaHeatPct != null ||
    req.body?.matchPct != null ||
    req.body?.pricePct != null ||
    req.body?.slaHeatPct != null ||
    req.body?.bestValueBlend != null
      ? {
          matchPct: Number(
            req.query.matchPct ?? req.body?.bestValueBlend?.matchPct ?? req.body?.matchPct ?? saved.matchPct
          ),
          pricePct: Number(
            req.query.pricePct ?? req.body?.bestValueBlend?.pricePct ?? req.body?.pricePct ?? saved.pricePct
          ),
          slaHeatPct: Number(
            req.query.slaHeatPct ??
              req.body?.bestValueBlend?.slaHeatPct ??
              req.body?.slaHeatPct ??
              saved.slaHeatPct
          ),
        }
      : saved;
  const blend = normalizeBestValueBlend(draftRaw);
  const limitRaw = Number(req.query.limit ?? req.body?.limit ?? 5);
  const limit = Math.min(12, Math.max(1, Number.isFinite(limitRaw) ? Math.round(limitRaw) : 5));

  const matchWeights = await getMatchWeights();
  const heatWeightCfg = await getHeatWeight();

  const openJobs = await AppDataSource.getRepository(Job).find({
    where: { status: JobStatus.OPEN },
    order: { createdAt: "DESC" },
    take: 40,
  });
  if (!openJobs.length) {
    return res.json({
      blend,
      bestValueBlendPreset: detectBestValueBlendPreset(blend),
      bestValueBlendPresets: Object.values(BEST_VALUE_BLEND_PRESETS),
      sampleSize: 0,
      jobs: [],
      message: "No open jobs",
    });
  }

  const jobIds = openJobs.map((j) => j.id);
  const bids = await AppDataSource.getRepository(Bid).find({
    where: { jobId: In(jobIds), status: BidStatus.ACTIVE },
    relations: ["tradesperson"],
  });
  const bidsByJob: Record<string, typeof bids> = {};
  for (const b of bids) {
    (bidsByJob[b.jobId] ||= []).push(b);
  }

  const eligibleJobs = openJobs.filter((j) => (bidsByJob[j.id] || []).length >= 2).slice(0, limit);
  const proIds = [
    ...new Set(eligibleJobs.flatMap((j) => (bidsByJob[j.id] || []).map((b) => b.tradespersonId))),
  ];
  const profiles = proIds.length
    ? await AppDataSource.getRepository(TradespersonProfile).find({
        where: { userId: In(proIds) },
      })
    : [];
  const profileMap: Record<string, (typeof profiles)[0]> = {};
  for (const p of profiles) profileMap[p.userId] = p;

  const jobsOut = [];
  for (const job of eligibleJobs) {
    const jobBids = bidsByJob[job.id] || [];
    const inputs = jobBids.map((b) => {
      const profile = profileMap[b.tradespersonId];
      let matchScore = 0;
      let heatBoost = 0;
      if (profile) {
        const input: ScoreablePro = {
          userId: profile.userId,
          skills: profile.skills,
          city: profile.city,
          serviceAreas: profile.serviceAreas,
          lat: profile.lat,
          lng: profile.lng,
          averageRating: Number(profile.averageRating || 0),
          reviewCount: profile.reviewCount || 0,
          avgResponseHours: hoursBetween(job.createdAt, b.createdAt),
          name: b.tradesperson?.name || null,
        };
        const breakdown = scoreProForJob(job, input, matchWeights);
        const availabilityHeat = buildAvailabilityHeat(profile.weeklyAvailability, profile.blockedDates);
        heatBoost = computeHeatBoost(availabilityHeat, heatWeightCfg);
        matchScore = Math.round((breakdown.total + heatBoost) * 10) / 10;
      }
      const jobToBidHours = hoursBetween(job.createdAt, b.createdAt);
      const sla = buildEventSla({ jobToBidHours });
      return {
        bidId: b.id,
        name: b.tradesperson?.name || "Pro",
        matchScore,
        hold: escrowHoldFromAmounts(b.quoteAmount, b.amount),
        heatBoost,
        responseSlaTier: sla.tier,
      };
    });
    const ranked = scoreBestValueBids(inputs, blend);
    if (!ranked?.clean) continue;
    jobsOut.push({
      jobId: job.id,
      title: job.title,
      category: job.category,
      city: job.city,
      area: job.area,
      bidCount: jobBids.length,
      bestBidId: ranked.bestBidId,
      topBids: ranked.rows.slice(0, 3).map((r) => ({
        bidId: r.bidId,
        name: r.name,
        valueScore: r.valueScore,
        matchScore: r.matchScore,
        hold: r.hold,
        isBest: r.bidId === ranked.bestBidId,
      })),
    });
  }

  return res.json({
    blend,
    bestValueBlendPreset: detectBestValueBlendPreset(blend),
    bestValueBlendPresets: Object.values(BEST_VALUE_BLEND_PRESETS),
    sampleSize: jobsOut.length,
    jobs: jobsOut,
    message:
      jobsOut.length > 0
        ? `Previewed blend on ${jobsOut.length} open job(s) with competing bids`
        : "No open jobs with ≥2 active bids to preview",
  });
}

export async function matchQualityLite(_req: Request, res: Response) {
  const jobs = await AppDataSource.getRepository(Job).find({
    where: { status: JobStatus.OPEN },
    order: { createdAt: "DESC" },
    take: 50,
  });
  const pros = await AppDataSource.getRepository(TradespersonProfile).find({
    where: { verificationStatus: VerificationStatus.VERIFIED },
    relations: ["user"],
    order: { averageRating: "DESC" },
    take: 500,
  });

  const responseMap = await avgResponseHoursByPro(pros.map((p) => p.userId));
  const weights = await getMatchWeights();
  const heatWeight = await getHeatWeight();

  const RADIUS_KM = 25;
  const rows = jobs.map((job) => {
    let nearby = 0;
    let sameCity = 0;
    const scored: {
      userId: string;
      name: string | null;
      score: number;
      heatBoost: number;
      rankedScore: number;
      breakdown: ReturnType<typeof scoreProForJob>;
      city: string | null;
      averageRating: number;
      reviewCount: number;
      skills: string | null;
    }[] = [];

    for (const p of pros) {
      const cityMatch =
        job.city &&
        p.city &&
        job.city.toLowerCase().trim() === p.city.toLowerCase().trim();
      const inAreas =
        job.city &&
        p.serviceAreas &&
        p.serviceAreas.toLowerCase().includes(job.city.toLowerCase().trim());
      if (cityMatch || inAreas) sameCity += 1;

      const dist = haversineKm(job.lat, job.lng, p.lat, p.lng);
      if (job.lat != null && job.lng != null && p.lat != null && p.lng != null) {
        if (dist != null && dist <= RADIUS_KM) nearby += 1;
      } else if (cityMatch || inAreas) {
        nearby += 1;
      }

      const proInput: ScoreablePro = {
        userId: p.userId,
        skills: p.skills,
        city: p.city,
        serviceAreas: p.serviceAreas,
        lat: p.lat,
        lng: p.lng,
        averageRating: Number(p.averageRating || 0),
        reviewCount: p.reviewCount || 0,
        avgResponseHours: responseMap[p.userId],
        name: p.user?.name || null,
      };
      const breakdown = scoreProForJob(job, proInput, weights);
      const availabilityHeat = buildAvailabilityHeat(p.weeklyAvailability, p.blockedDates, p.user?.timezone);
      const heatBoost = computeHeatBoost(availabilityHeat, heatWeight);
      const rankedScore = Math.round((breakdown.total + heatBoost) * 10) / 10;
      scored.push({
        userId: p.userId,
        name: p.user?.name || null,
        score: breakdown.total,
        heatBoost,
        rankedScore,
        breakdown,
        city: p.city || null,
        averageRating: Number(p.averageRating || 0),
        reviewCount: p.reviewCount || 0,
        skills: p.skills || null,
      });
    }

    scored.sort((a, b) => b.rankedScore - a.rankedScore || b.score - a.score);
    const topPros = scored.slice(0, 5);
    const bestScore = topPros[0]?.rankedScore ?? topPros[0]?.score ?? 0;

    return {
      jobId: job.id,
      title: job.title,
      category: job.category,
      city: job.city || null,
      area: job.area || null,
      lat: job.lat ?? null,
      lng: job.lng ?? null,
      createdAt: job.createdAt,
      nearbyVerifiedPros: nearby,
      sameCityPros: sameCity,
      bestMatchScore: bestScore,
      topPros,
      matchBand:
        nearby === 0 ? "none" : nearby <= 2 ? "thin" : nearby <= 6 ? "ok" : "strong",
    };
  });

  const summary = {
    openJobs: rows.length,
    verifiedPros: pros.length,
    jobsWithNoNearby: rows.filter((r) => r.nearbyVerifiedPros === 0).length,
    jobsThin: rows.filter((r) => r.matchBand === "thin").length,
    jobsOk: rows.filter((r) => r.matchBand === "ok").length,
    jobsStrong: rows.filter((r) => r.matchBand === "strong").length,
    radiusKm: RADIUS_KM,
    avgBestScore:
      rows.length > 0
        ? Math.round(
            (rows.reduce((s, r) => s + (r.bestMatchScore || 0), 0) / rows.length) * 10
          ) / 10
        : 0,
  };

  return res.json({ summary, jobs: rows, weights, heatWeight });
}
