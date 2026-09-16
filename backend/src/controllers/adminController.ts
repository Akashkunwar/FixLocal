import { Request, Response } from "express";
import { param } from "../utils/params";
import { AppDataSource } from "../data-source";
import { User, UserRole } from "../entities/User";
import {
  TradespersonProfile,
  VerificationStatus,
} from "../entities/TradespersonProfile";
import { Job, JobStatus } from "../entities/Job";
import { Dispute, DisputeStatus } from "../entities/Dispute";
import { Bid, BidStatus } from "../entities/Bid";
import { Review } from "../entities/Review";
import { invalidateOpenJobsCache } from "../utils/cache";
import { writeAudit, AuditAction } from "../utils/audit";
import { notifyFavoritersProAvailable } from "../utils/matchAlerts";
import { AuditLog } from "../entities/AuditLog";
import { haversineKm } from "../utils/geo";
import { scoreProForJob, type ScoreablePro } from "../utils/matchScore";
import { getMatchWeights, setMatchWeights, weightsSum, DEFAULT_MATCH_WEIGHTS, MATCH_WEIGHT_PRESETS, detectMatchPreset, normalizeMatchWeights, getHeatWeight, setHeatWeight, DEFAULT_HEAT_WEIGHT, normalizeHeatWeight, computeHeatBoost, getBestValueBlend, setBestValueBlend, DEFAULT_BEST_VALUE_BLEND, blendsEqual, normalizeBestValueBlend, BEST_VALUE_BLEND_PRESETS, detectBestValueBlendPreset } from "../utils/matchWeights";
import { scoreBestValueBids, escrowHoldFromAmounts } from "../utils/bestValueScore";
import { hoursBetween, buildEventSla } from "../utils/responseSla";
import { buildAvailabilityHeat } from "../utils/availabilityHeat";
import { In } from "typeorm";

export async function verifyTradesperson(req: Request, res: Response) {
  const userId = param(req, "id");
  const user = await AppDataSource.getRepository(User).findOne({ where: { id: userId } });
  if (!user || user.role !== UserRole.TRADESPERSON) {
    return res.status(404).json({ message: "Tradesperson not found", code: "NOT_FOUND" });
  }

  const profileRepo = AppDataSource.getRepository(TradespersonProfile);
  let profile = await profileRepo.findOne({ where: { userId } });
  if (!profile) {
    profile = profileRepo.create({ userId });
  }

  const action = String(req.body?.status || "verified");
  if (action === "verified") {
    profile.verificationStatus = VerificationStatus.VERIFIED;
    profile.verifiedAt = new Date();
    user.isSuspended = false;
  } else if (action === "rejected") {
    profile.verificationStatus = VerificationStatus.REJECTED;
    profile.verifiedAt = undefined;
  } else if (action === "suspended") {
    profile.verificationStatus = VerificationStatus.SUSPENDED;
    user.isSuspended = true;
  } else if (action === "pending") {
    profile.verificationStatus = VerificationStatus.PENDING;
    profile.verifiedAt = undefined;
    user.isSuspended = false;
  } else {
    return res.status(400).json({ message: "status must be verified|rejected|suspended|pending" });
  }

  await profileRepo.save(profile);
  await AppDataSource.getRepository(User).save(user);

  if (profile.verificationStatus === VerificationStatus.VERIFIED) {
    try {
      await notifyFavoritersProAvailable(user.id, "is now verified and available to hire");
    } catch (e) {
      console.warn("verify match alert failed", e);
    }
  }

  await writeAudit({
    actorUserId: req.user!.id,
    actorEmail: req.user!.email,
    action: AuditAction.VERIFY_TRADESPERSON,
    targetType: "user",
    targetId: user.id,
    summary: `Set verification to ${profile.verificationStatus} for ${user.email}`,
    meta: { status: profile.verificationStatus, email: user.email },
  });

  return res.json({ profile, user: { id: user.id, isSuspended: user.isSuspended } });
}

export async function listTradespeople(req: Request, res: Response) {
  const qb = AppDataSource.getRepository(TradespersonProfile)
    .createQueryBuilder("p")
    .leftJoinAndSelect("p.user", "user")
    .orderBy("p.createdAt", "DESC");

  if (req.query.status) {
    qb.andWhere("p.verificationStatus = :status", { status: String(req.query.status) });
  }

  const profiles = await qb.getMany();
  return res.json({
    tradespeople: profiles.map((p) => ({
      id: p.id,
      userId: p.userId,
      email: p.user?.email,
      name: p.user?.name,
      skills: p.skills,
      serviceAreas: p.serviceAreas,
      city: p.city,
      averageRating: Number(p.averageRating || 0),
      reviewCount: p.reviewCount || 0,
      verificationStatus: p.verificationStatus,
      verifiedAt: p.verifiedAt,
      isSuspended: !!p.user?.isSuspended,
      createdAt: p.createdAt,
    })),
  });
}

export async function listUsers(req: Request, res: Response) {
  const role = req.query.role ? String(req.query.role).toUpperCase() : undefined;
  const q = req.query.q ? String(req.query.q).trim() : "";
  const suspendedOnly = String(req.query.suspended || "") === "1";

  const qb = AppDataSource.getRepository(User)
    .createQueryBuilder("u")
    .leftJoinAndSelect("u.tradespersonProfile", "p")
    .orderBy("u.createdAt", "DESC")
    .take(200);

  if (role && Object.values(UserRole).includes(role as UserRole)) {
    qb.andWhere("u.role = :role", { role });
  }
  if (suspendedOnly) {
    qb.andWhere("u.isSuspended = true");
  }
  if (q) {
    qb.andWhere("(u.email ILIKE :q OR u.name ILIKE :q OR u.phone ILIKE :q)", {
      q: `%${q}%`,
    });
  }

  const users = await qb.getMany();
  return res.json({
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      phone: u.phone,
      role: u.role,
      isSuspended: !!u.isSuspended,
      createdAt: u.createdAt,
      verificationStatus: u.tradespersonProfile?.verificationStatus || null,
    })),
  });
}

export async function setUserSuspended(req: Request, res: Response) {
  const userId = param(req, "id");
  const suspend = req.body?.suspended === true || req.body?.suspended === "true";

  const userRepo = AppDataSource.getRepository(User);
  const user = await userRepo.findOne({ where: { id: userId } });
  if (!user) {
    return res.status(404).json({ message: "User not found", code: "NOT_FOUND" });
  }
  if (user.role === UserRole.ADMIN) {
    return res.status(400).json({ message: "Cannot suspend admin accounts", code: "FORBIDDEN" });
  }
  if (user.id === req.user!.id) {
    return res.status(400).json({ message: "Cannot suspend yourself", code: "FORBIDDEN" });
  }

  user.isSuspended = suspend;
  await userRepo.save(user);

  if (user.role === UserRole.TRADESPERSON) {
    const profileRepo = AppDataSource.getRepository(TradespersonProfile);
    let profile = await profileRepo.findOne({ where: { userId: user.id } });
    if (!profile) {
      profile = profileRepo.create({ userId: user.id, galleryUrls: [] });
    }
    if (suspend) {
      profile.verificationStatus = VerificationStatus.SUSPENDED;
    } else if (profile.verificationStatus === VerificationStatus.SUSPENDED) {
      profile.verificationStatus = VerificationStatus.PENDING;
      profile.verifiedAt = undefined;
    }
    await profileRepo.save(profile);
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

  return res.json({
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      isSuspended: user.isSuspended,
    },
  });
}

export async function adminStats(_req: Request, res: Response) {
  const userRepo = AppDataSource.getRepository(User);
  const jobRepo = AppDataSource.getRepository(Job);
  const disputeRepo = AppDataSource.getRepository(Dispute);
  const profileRepo = AppDataSource.getRepository(TradespersonProfile);
  const bidRepo = AppDataSource.getRepository(Bid);
  const reviewRepo = AppDataSource.getRepository(Review);

  const [
    totalUsers,
    homeowners,
    tradespeople,
    openJobs,
    awardedJobs,
    inProgressJobs,
    completedJobs,
    cancelledJobs,
    disputedJobs,
    openDisputes,
    pendingVerifications,
    suspendedUsers,
    activeBids,
    totalReviews,
  ] = await Promise.all([
    userRepo.count(),
    userRepo.count({ where: { role: UserRole.HOMEOWNER } }),
    userRepo.count({ where: { role: UserRole.TRADESPERSON } }),
    jobRepo.count({ where: { status: JobStatus.OPEN } }),
    jobRepo.count({ where: { status: JobStatus.AWARDED } }),
    jobRepo.count({ where: { status: JobStatus.IN_PROGRESS } }),
    jobRepo.count({ where: { status: JobStatus.COMPLETED } }),
    jobRepo.count({ where: { status: JobStatus.CANCELLED } }),
    jobRepo.count({ where: { status: JobStatus.DISPUTED } }),
    disputeRepo.count({ where: { status: DisputeStatus.OPEN } }),
    profileRepo.count({ where: { verificationStatus: VerificationStatus.PENDING } }),
    userRepo.count({ where: { isSuspended: true } }),
    bidRepo.count({ where: { status: BidStatus.ACTIVE } }),
    reviewRepo.count(),
  ]);

  const completedWithBids = await bidRepo
    .createQueryBuilder("b")
    .innerJoin("b.job", "job")
    .where("b.status = :accepted", { accepted: BidStatus.ACCEPTED })
    .andWhere("job.status = :completed", { completed: JobStatus.COMPLETED })
    .select("COALESCE(SUM(b.amount), 0)", "sum")
    .getRawOne();

  const simulatedGMV = Number(completedWithBids?.sum || 0);

  return res.json({
    stats: {
      totalUsers,
      homeowners,
      tradespeople,
      openJobs,
      awardedJobs,
      inProgressJobs,
      completedJobs,
      cancelledJobs,
      disputedJobs,
      openDisputes,
      pendingVerifications,
      suspendedUsers,
      activeBids,
      totalReviews,
      simulatedGMV,
    },
  });
}

export async function forceCancelJob(req: Request, res: Response) {
  const job = await AppDataSource.getRepository(Job).findOne({
    where: { id: param(req, "id") },
  });
  if (!job) {
    return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });
  }
  if (job.status === JobStatus.COMPLETED || job.status === JobStatus.CANCELLED) {
    return res.status(400).json({
      message: "Job is already terminal",
      code: "INVALID_STATUS",
    });
  }

  job.status = JobStatus.CANCELLED;
  await AppDataSource.getRepository(Job).save(job);

  await AppDataSource.getRepository(Bid)
    .createQueryBuilder()
    .update(Bid)
    .set({ status: BidStatus.REJECTED })
    .where("jobId = :jobId AND status = :active", {
      jobId: job.id,
      active: BidStatus.ACTIVE,
    })
    .execute();

  await invalidateOpenJobsCache();

  await writeAudit({
    actorUserId: req.user!.id,
    actorEmail: req.user!.email,
    action: AuditAction.FORCE_CANCEL,
    targetType: "job",
    targetId: job.id,
    summary: `Force-cancelled job "${job.title}"`,
    meta: { title: job.title, previousStatus: "non-terminal" },
  });

  return res.json({ job });
}


export async function listAuditLogs(req: Request, res: Response) {
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "50"), 10) || 50));
  const action = req.query.action ? String(req.query.action) : undefined;

  const qb = AppDataSource.getRepository(AuditLog)
    .createQueryBuilder("a")
    .orderBy("a.createdAt", "DESC")
    .take(limit);

  if (action) {
    qb.andWhere("a.action = :action", { action });
  }

  const logs = await qb.getMany();
  return res.json({ logs });
}


export async function createAdminNote(req: Request, res: Response) {
  const noteRaw = req.body?.note != null ? String(req.body.note).trim() : "";
  const note = noteRaw.slice(0, 2000);
  if (!note) {
    return res.status(400).json({ message: "note is required", code: "VALIDATION" });
  }
  const targetType = req.body?.targetType != null ? String(req.body.targetType).slice(0, 64) : undefined;
  const targetId = req.body?.targetId != null ? String(req.body.targetId).trim() || undefined : undefined;
  const summary = (req.body?.summary != null ? String(req.body.summary).trim() : "") || note.slice(0, 200);

  const log = await writeAudit({
    actorUserId: req.user!.id,
    actorEmail: req.user!.email,
    action: AuditAction.ADMIN_NOTE,
    targetType,
    targetId,
    summary,
    meta: { note, optional: true },
  });
  return res.status(201).json({ log });
}



/** Richer match-quality: open jobs vs scored verified pros (skills, rating, response, distance). */
async function avgResponseHoursByPro(proUserIds: string[]): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {};
  for (const id of proUserIds) out[id] = null;
  if (!proUserIds.length) return out;

  const bids = await AppDataSource.getRepository(Bid).find({
    where: { tradespersonId: In(proUserIds) },
    relations: ["job"],
    order: { createdAt: "DESC" },
    take: Math.min(500, proUserIds.length * 40),
  });

  const buckets: Record<string, number[]> = {};
  for (const bid of bids) {
    if (!bid.job?.createdAt) continue;
    const ms = new Date(bid.createdAt).getTime() - new Date(bid.job.createdAt).getTime();
    if (ms < 0 || ms > 14 * 24 * 3600000) continue; // ignore weird / >14d
    const hours = ms / 3600000;
    (buckets[bid.tradespersonId] ||= []).push(hours);
  }
  for (const id of proUserIds) {
    const arr = buckets[id];
    if (!arr?.length) continue;
    out[id] = Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10;
  }
  return out;
}


export async function getMatchWeightsConfig(_req: Request, res: Response) {
  const weights = await getMatchWeights();
  const heatWeight = await getHeatWeight();
  const bestValueBlend = await getBestValueBlend();
  return res.json({
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
    beforeHeat !== heatWeight;
  if (weightsChanged) {
    try {
      await writeAudit({
        actorUserId: req.user!.id,
        actorEmail: req.user!.email,
        action: AuditAction.MATCH_WEIGHTS_UPDATE,
        targetType: "app_config",
        targetId: undefined,
        summary: preset
          ? `Match weights preset "${preset}" applied (heat ${heatWeight})`
          : `Match weights updated (sk${weights.skills}/rt${weights.rating}/rs${weights.response}/ds${weights.distance}, heat ${heatWeight})`,
        meta: {
          // Include heat in before/after snapshots for clean rollback
          before: { ...before, heatWeight: beforeHeat },
          after: { ...weights, heatWeight },
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
  const auditLogId = String(req.body?.auditLogId || "").trim();
  if (!auditLogId) {
    return res.status(400).json({ message: "auditLogId is required", code: "VALIDATION" });
  }

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

  const target = normalizeMatchWeights(raw as any);
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
      : (raw as any).heatWeight;
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
  const weights = await setMatchWeights(target);
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
        before: { ...current, heatWeight: currentHeat },
        after: { ...weights, heatWeight },
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
    message: preset
      ? `Rolled back to preset "${preset}" (heat ${heatWeight})`
      : `Match weights rolled back from audit (heat ${heatWeight})`,
  });
}

/** Roll back best_value_blend to the `before` snapshot on a best_value_blend_update audit row. */
export async function rollbackBestValueBlendFromAudit(req: Request, res: Response) {
  const auditLogId = String(req.body?.auditLogId || "").trim();
  if (!auditLogId) {
    return res.status(400).json({ message: "auditLogId is required", code: "VALIDATION" });
  }

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

  const target = normalizeBestValueBlend(raw as any);
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
        const availabilityHeat = buildAvailabilityHeat(
          profile.weeklyAvailability as any,
          profile.blockedDates
        );
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
        email: p.user?.email || null,
      };
      const breakdown = scoreProForJob(job, proInput, weights);
      const availabilityHeat = buildAvailabilityHeat(
        p.weeklyAvailability as any,
        p.blockedDates
      );
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
