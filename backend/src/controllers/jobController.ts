import { Request, Response } from "express";
import { param } from "../utils/params";
import { AppDataSource } from "../data-source";
import { Job, JobCategory, JobStatus } from "../entities/Job";
import { Bid } from "../entities/Bid";
import { User, UserRole } from "../entities/User";
import {
  cacheGetJson,
  cacheSetJson,
  invalidateOpenJobsCache,
  openJobsCacheKey,
} from "../utils/cache";
import { ensureMilestonesForJob } from "./paymentController";
import { notifyHomeownerMatchHints } from "../utils/matchAlerts";
import { haversineKm, parseCoordPair } from "../utils/geo";
import {
  TradespersonProfile,
  VerificationStatus,
} from "../entities/TradespersonProfile";
import { scoreProForJob, type ScoreablePro } from "../utils/matchScore";
import { getMatchWeights, getHeatWeight, computeHeatBoost } from "../utils/matchWeights";
import { buildResponseSla } from "../utils/responseSla";
import { In } from "typeorm";
import { Notification, NotificationType } from "../entities/Notification";
import { Favorite, FavoriteTargetType } from "../entities/Favorite";
import { createNotification } from "../utils/notifications";
import {
  buildAvailabilityHeat,
  DEFAULT_SHORTLIST_INVITE_MIN_HEAT,
  shortlistInviteBlockedByHeat,
} from "../utils/availabilityHeat";

const jobRepo = () => AppDataSource.getRepository(Job);

const CATEGORIES = Object.values(JobCategory);


const CADENCE_VALUES = ["one_time", "weekly", "monthly", "amc"] as const;

function normalizeCadence(raw: unknown): string {
  const s = String(raw || "one_time").trim().toLowerCase();
  return (CADENCE_VALUES as readonly string[]).includes(s) ? s : "one_time";
}

function normalizeCadenceNote(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim().slice(0, 500);
  return s || null;
}

function parseOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function photoPaths(files: Express.Multer.File[] | undefined): string[] {
  if (!files?.length) return [];
  return files.map((f) => `/uploads/${f.filename}`);
}

async function findOwnedJob(jobId: string, userId: string) {
  return jobRepo().findOne({ where: { id: jobId, homeownerId: userId } });
}

const STATUSES = Object.values(JobStatus);

export async function listJobs(req: Request, res: Response) {
  const {
    q,
    keyword,
    category,
    siteType,
    status,
    from,
    to,
    dateField = "created",
    page = "1",
    limit = "10",
    sort = "newest",
    scope,
    area,
    city,
    neighborhood,
    budgetMin,
    budgetMax,
    nearLat,
    nearLng,
    maxKm,
  } = req.query;

  const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
  const limitNum = Math.min(50, Math.max(1, parseInt(String(limit), 10) || 10));
  const skip = (pageNum - 1) * limitNum;

  const qb = jobRepo().createQueryBuilder("job");

  // Role visibility
  const { role, id: userId } = req.user!;
  const mine = String(scope) === "mine";

  if (role === UserRole.HOMEOWNER) {
    qb.andWhere("job.homeownerId = :userId", { userId });
  } else if (role === UserRole.TRADESPERSON) {
    if (mine) {
      qb.innerJoin("job.acceptedBid", "acceptedBid").andWhere(
        "acceptedBid.tradespersonId = :userId",
        { userId }
      );
    } else {
      qb.andWhere("job.status = :openOnly", { openOnly: JobStatus.OPEN });
    }
  }
  // ADMIN: no ownership restriction

  const search = String(q ?? keyword ?? "").trim();
  if (search) {
    qb.andWhere("(job.title ILIKE :search OR job.description ILIKE :search)", {
      search: `%${search}%`,
    });
  }

  if (category) {
    const cat = String(category);
    if (!CATEGORIES.includes(cat as JobCategory)) {
      return res.status(400).json({ message: "Invalid category", code: "INVALID_CATEGORY" });
    }
    qb.andWhere("job.category = :category", { category: cat });
  }

  if (siteType) {
    const st = String(siteType);
    if (!["residential", "office"].includes(st)) {
      return res.status(400).json({ message: "Invalid siteType", code: "INVALID_SITE_TYPE" });
    }
    qb.andWhere("job.siteType = :siteType", { siteType: st });
  }

  const cityQ = String(city || "").trim();
  const neighborhoodQ = String(neighborhood || area || "").trim();
  if (cityQ) {
    qb.andWhere(
      "(job.city ILIKE :cityQ OR job.area ILIKE :cityQ OR job.address ILIKE :cityQ)",
      { cityQ: `%${cityQ}%` }
    );
  }
  if (neighborhoodQ) {
    qb.andWhere(
      "(job.area ILIKE :nbh OR job.address ILIKE :nbh OR job.pincode ILIKE :nbh)",
      { nbh: `%${neighborhoodQ}%` }
    );
  }

  const bMin = parseOptionalNumber(budgetMin);
  const bMax = parseOptionalNumber(budgetMax);
  if (bMin !== undefined) {
    qb.andWhere("(job.budgetMax IS NULL OR job.budgetMax >= :bMin)", { bMin });
  }
  if (bMax !== undefined) {
    qb.andWhere("(job.budgetMin IS NULL OR job.budgetMin <= :bMax)", { bMax });
  }

  // Status filter: homeowners/admin always; tradespeople only on scope=mine
  if (status && (role !== UserRole.TRADESPERSON || mine)) {
    const st = String(status);
    if (!STATUSES.includes(st as JobStatus)) {
      return res.status(400).json({ message: "Invalid status", code: "INVALID_STATUS" });
    }
    qb.andWhere("job.status = :status", { status: st });
  }

  const field = String(dateField) === "preferred" ? "job.preferredStart" : "job.createdAt";
  if (from) {
    qb.andWhere(`${field} >= :from`, { from: new Date(String(from)) });
  }
  if (to) {
    qb.andWhere(`${field} <= :to`, { to: new Date(String(to)) });
  }

  // Soft "distance": prefer exact city match when filtering by city (no geo libs).
  if (cityQ) {
    qb.addSelect(
      `CASE WHEN LOWER(COALESCE(job.city, '')) = LOWER(:cityExact) THEN 0 WHEN job.city ILIKE :cityLike OR job.area ILIKE :cityLike THEN 1 ELSE 2 END`,
      "city_rank"
    );
    qb.setParameter("cityExact", cityQ);
    qb.setParameter("cityLike", `%${cityQ}%`);
    qb.orderBy("city_rank", "ASC");
  }

  const applySort = (primary: boolean) => {
    const fn = primary && !cityQ ? "orderBy" : "addOrderBy";
    switch (String(sort)) {
      case "budget_desc":
        (qb as any)[fn]("job.budgetMax", "DESC", "NULLS LAST");
        break;
      case "budget_asc":
        (qb as any)[fn]("job.budgetMax", "ASC", "NULLS LAST");
        break;
      case "preferred_date":
        (qb as any)[fn]("job.preferredStart", "ASC", "NULLS LAST");
        break;
      case "newest":
      default:
        (qb as any)[fn]("job.createdAt", "DESC");
        break;
    }
  };
  applySort(true);

  // Cache open-job lists (tradesperson browse or status=open)
  const listingOpen =
    (role === UserRole.TRADESPERSON && !mine) ||
    String(status) === JobStatus.OPEN;
  const cacheKey = listingOpen
    ? openJobsCacheKey({
        role,
        q: search,
        category: String(category || ""),
        from: String(from || ""),
        to: String(to || ""),
        dateField: String(dateField),
        page: String(pageNum),
        limit: String(limitNum),
        sort: String(sort),
        area: String(neighborhood || area || ""),
        city: String(city || ""),
        budgetMin: String(budgetMin || ""),
        budgetMax: String(budgetMax || ""),
        nearLat: String(nearLat || ""),
        nearLng: String(nearLng || ""),
        maxKm: String(maxKm || ""),
      })
    : null;

  if (cacheKey) {
    const cached = await cacheGetJson<{
      jobs: Job[];
      pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
      };
      cached: boolean;
    }>(cacheKey);
    if (cached) {
      return res.json({ ...cached, cached: true });
    }
  }

  const origin = parseCoordPair(nearLat, nearLng);
  const maxDistance = Number(maxKm);
  const wantDistanceSort = String(sort) === "distance";

  // When ranking by distance we need coords on all candidates; fetch a wider page then slice.
  let jobs: Job[];
  let total: number;
  if (wantDistanceSort && origin) {
    const all = await qb.getMany();
    const withDist = all.map((j) => ({
      job: j,
      distanceKm: haversineKm(origin.lat, origin.lng, j.lat, j.lng),
    }));
    let filtered = withDist;
    if (Number.isFinite(maxDistance) && maxDistance > 0) {
      filtered = withDist.filter(
        (x) => x.distanceKm != null && x.distanceKm <= maxDistance
      );
    }
    filtered.sort((a, b) => {
      const da = a.distanceKm ?? Number.POSITIVE_INFINITY;
      const db = b.distanceKm ?? Number.POSITIVE_INFINITY;
      if (da !== db) return da - db;
      return new Date(b.job.createdAt).getTime() - new Date(a.job.createdAt).getTime();
    });
    total = filtered.length;
    jobs = filtered.slice(skip, skip + limitNum).map((x) => {
      (x.job as any).distanceKm = x.distanceKm;
      return x.job;
    });
  } else {
    const result = await qb.skip(skip).take(limitNum).getManyAndCount();
    jobs = result[0];
    total = result[1];
    if (origin) {
      for (const j of jobs) {
        (j as any).distanceKm = haversineKm(origin.lat, origin.lng, j.lat, j.lng);
      }
    }
  }


  const payload = {
    jobs: jobs.map((j) => ({
      ...j,
      distanceKm: (j as any).distanceKm ?? null,
    })),
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum) || 1,
    },
    cached: false,
  };

  if (cacheKey) {
    await cacheSetJson(cacheKey, payload, 60);
  }

  return res.json(payload);
}

export async function createJob(req: Request, res: Response) {
  const {
    title,
    description,
    category,
    siteType,
    cadence,
    cadenceNote,
    preferredStart,
    preferredEnd,
    maxBids,
    budgetMin,
    budgetMax,
    address,
    area,
    city,
    pincode,
    lat,
    lng,
  } = req.body ?? {};

  if (!title || !description || !category) {
    return res.status(400).json({ message: "title, description, and category are required" });
  }

  if (!CATEGORIES.includes(category)) {
    return res.status(400).json({
      message: `category must be one of: ${CATEGORIES.join(", ")}`,
      code: "INVALID_CATEGORY",
    });
  }

  const allowedSite = ["residential", "office"];
  const site =
    siteType && allowedSite.includes(String(siteType))
      ? String(siteType)
      : undefined;

  const job = jobRepo().create({
    title: String(title).trim(),
    description: String(description).trim(),
    category,
    siteType: site,
    cadence: normalizeCadence(cadence),
    cadenceNote: normalizeCadenceNote(cadenceNote),
    preferredStart: preferredStart ? new Date(preferredStart) : undefined,
    preferredEnd: preferredEnd ? new Date(preferredEnd) : undefined,
    maxBids: parseOptionalNumber(maxBids) ?? 5,
    budgetMin: parseOptionalNumber(budgetMin),
    budgetMax: parseOptionalNumber(budgetMax),
    address: address ? String(address) : undefined,
    area: area ? String(area) : undefined,
    city: city ? String(city) : undefined,
    pincode: pincode ? String(pincode) : undefined,
    lat: parseOptionalNumber(lat),
    lng: parseOptionalNumber(lng),
    photoUrls: photoPaths(req.files as Express.Multer.File[] | undefined),
    status: JobStatus.OPEN,
    homeownerId: req.user!.id,
  });

  await jobRepo().save(job);
  await invalidateOpenJobsCache();
  try {
    await notifyHomeownerMatchHints(job);
  } catch (e) {
    console.warn("match alerts failed", e);
  }
  return res.status(201).json({ job });
}

export async function getJob(req: Request, res: Response) {
  const job = await jobRepo().findOne({ where: { id: param(req, "id") } });
  if (!job) {
    return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });
  }

  const { role, id: userId } = req.user!;
  const isOwner = job.homeownerId === userId;
  const isAdmin = role === UserRole.ADMIN;

  let isAwardedPro = false;
  if (role === UserRole.TRADESPERSON && job.acceptedBidId) {
    const accepted = await AppDataSource.getRepository(Bid).findOne({
      where: { id: job.acceptedBidId },
    });
    isAwardedPro = !!accepted && accepted.tradespersonId === userId;
  }

  let hasBid = false;
  if (role === UserRole.TRADESPERSON && !isAwardedPro) {
    const bid = await AppDataSource.getRepository(Bid).findOne({
      where: { jobId: job.id, tradespersonId: userId },
    });
    hasBid = !!bid;
  }

  if (!isOwner && !isAdmin && !isAwardedPro && !hasBid && job.status !== JobStatus.OPEN) {
    return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
  }
  if (!isOwner && !isAdmin && role === UserRole.HOMEOWNER) {
    return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
  }

  if (
    job.acceptedBidId &&
    (job.status === JobStatus.AWARDED ||
      job.status === JobStatus.IN_PROGRESS ||
      job.status === JobStatus.COMPLETED ||
      job.status === JobStatus.DISPUTED)
  ) {
    await ensureMilestonesForJob(job);
    const refreshed = await jobRepo().findOne({ where: { id: job.id } });
    if (refreshed) return res.json({ job: refreshed });
  }

  return res.json({ job });
}

export async function updateJob(req: Request, res: Response) {
  const job = await findOwnedJob(param(req, "id"), req.user!.id);
  if (!job) {
    return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });
  }
  if (job.status !== JobStatus.OPEN) {
    return res.status(400).json({
      message: "Only open jobs can be updated",
      code: "JOB_NOT_OPEN",
    });
  }

  const body = req.body ?? {};
  if (body.title !== undefined) job.title = String(body.title).trim();
  if (body.description !== undefined) job.description = String(body.description).trim();
  if (body.category !== undefined) {
    if (!CATEGORIES.includes(body.category)) {
      return res.status(400).json({ message: "Invalid category", code: "INVALID_CATEGORY" });
    }
    job.category = body.category;
  }
  if (body.preferredStart !== undefined) {
    job.preferredStart = body.preferredStart ? new Date(body.preferredStart) : undefined;
  }
  if (body.preferredEnd !== undefined) {
    job.preferredEnd = body.preferredEnd ? new Date(body.preferredEnd) : undefined;
  }
  if (body.maxBids !== undefined) {
    const n = parseOptionalNumber(body.maxBids);
    if (n !== undefined) job.maxBids = n;
  }
  if (body.budgetMin !== undefined) job.budgetMin = parseOptionalNumber(body.budgetMin);
  if (body.budgetMax !== undefined) job.budgetMax = parseOptionalNumber(body.budgetMax);
  if (body.address !== undefined) job.address = body.address ? String(body.address) : undefined;
  if (body.area !== undefined) job.area = body.area ? String(body.area) : undefined;
  if (body.city !== undefined) job.city = body.city ? String(body.city) : undefined;
  if (body.pincode !== undefined) job.pincode = body.pincode ? String(body.pincode) : undefined;
  if (body.lat !== undefined) job.lat = parseOptionalNumber(body.lat);
  if (body.lng !== undefined) job.lng = parseOptionalNumber(body.lng);
  if (body.cadence !== undefined) job.cadence = normalizeCadence(body.cadence);
  if (body.cadenceNote !== undefined) job.cadenceNote = normalizeCadenceNote(body.cadenceNote);

  const newPhotos = photoPaths(req.files as Express.Multer.File[] | undefined);
  if (newPhotos.length) {
    job.photoUrls = [...(job.photoUrls || []), ...newPhotos];
  }

  await jobRepo().save(job);
  return res.json({ job });
}

export async function cancelJob(req: Request, res: Response) {
  const job = await findOwnedJob(param(req, "id"), req.user!.id);
  if (!job) {
    return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });
  }
  if (job.status !== JobStatus.OPEN) {
    return res.status(400).json({
      message: "Only open jobs can be cancelled",
      code: "JOB_NOT_OPEN",
    });
  }

  job.status = JobStatus.CANCELLED;
  await jobRepo().save(job);
  await invalidateOpenJobsCache();
  return res.json({ job });
}


/** Suggest top scored verified pros for a job (homeowner/admin). */
export async function suggestedProsForJob(req: Request, res: Response) {
  const job = await jobRepo().findOne({ where: { id: param(req, "id") } });
  if (!job) {
    return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });
  }
  const { role, id: userId } = req.user!;
  const isOwner = job.homeownerId === userId;
  const isAdmin = role === UserRole.ADMIN;
  if (!isOwner && !isAdmin) {
    return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
  }

  const limit = Math.min(10, Math.max(1, parseInt(String(req.query.limit || "5"), 10) || 5));
  const pros = await AppDataSource.getRepository(TradespersonProfile).find({
    where: { verificationStatus: VerificationStatus.VERIFIED },
    relations: ["user"],
  });

  const proIds = pros.map((p) => p.userId);
  const bids = proIds.length
    ? await AppDataSource.getRepository(Bid).find({
        where: { tradespersonId: In(proIds) },
        relations: ["job"],
        order: { createdAt: "DESC" },
        take: Math.min(500, proIds.length * 40),
      })
    : [];

  const buckets: Record<string, number[]> = {};
  for (const bid of bids) {
    if (!bid.job?.createdAt) continue;
    const ms = new Date(bid.createdAt).getTime() - new Date(bid.job.createdAt).getTime();
    if (ms < 0 || ms > 14 * 24 * 3600000) continue;
    (buckets[bid.tradespersonId] ||= []).push(ms / 3600000);
  }
  const responseMap: Record<string, number | null> = {};
  for (const id of proIds) {
    const arr = buckets[id];
    responseMap[id] =
      arr?.length
        ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10
        : null;
  }
  const weights = await getMatchWeights();
  const heatWeight = await getHeatWeight();

  const jobCat = String(job.category || "").toLowerCase();
  const eligible = pros.filter((p) => {
    const skip = (p.notInterestedCategories || []).map((c) => String(c).toLowerCase());
    return !jobCat || !skip.includes(jobCat);
  });
  const skippedNotInterested = pros.length - eligible.length;

  const scored = eligible.map((p) => {
    const input: ScoreablePro = {
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
    const breakdown = scoreProForJob(job, input, weights);
    const jobHrs = buckets[p.userId] || [];
    const responseSla = buildResponseSla({ jobHours: jobHrs });
    const availabilityHeat = buildAvailabilityHeat(
      p.weeklyAvailability as any,
      p.blockedDates
    );
    // Wave 20: admin-tunable heat weight (default 10) for clean schedules
    const heatBoost = computeHeatBoost(availabilityHeat, heatWeight);
    const rankedScore = Math.round((breakdown.total + heatBoost) * 10) / 10;
    return {
      userId: p.userId,
      name: p.user?.name || null,
      city: p.city || null,
      skills: p.skills || null,
      averageRating: Number(p.averageRating || 0),
      reviewCount: p.reviewCount || 0,
      score: breakdown.total,
      heatBoost,
      rankedScore,
      breakdown,
      responseSla,
      availabilityHeat,
    };
  });
  scored.sort((a, b) => b.rankedScore - a.rankedScore || b.score - a.score);

  return res.json({
    jobId: job.id,
    category: job.category,
    suggestions: scored.slice(0, limit),
    skippedNotInterested,
    weights,
    heatWeight,
    heatAware: true,
  });
}


/** Rank homeowner shortlist (favorites) for this job: live match score + tag relevance. */
export async function shortlistRankedForJob(req: Request, res: Response) {
  const job = await jobRepo().findOne({ where: { id: param(req, "id") } });
  if (!job) {
    return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });
  }
  const { role, id: userId } = req.user!;
  const isOwner = job.homeownerId === userId;
  const isAdmin = role === UserRole.ADMIN;
  if (!isOwner && !isAdmin) {
    return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
  }

  const favs = await AppDataSource.getRepository(Favorite).find({
    where: { userId: job.homeownerId, targetType: FavoriteTargetType.PRO },
    order: { createdAt: "DESC" },
  });
  if (!favs.length) {
    return res.json({ jobId: job.id, category: job.category, shortlist: [], weights: await getMatchWeights() });
  }

  const proIds = favs.map((f) => f.targetId);
  const profiles = await AppDataSource.getRepository(TradespersonProfile).find({
    where: { userId: In(proIds) },
    relations: ["user"],
  });
  const profileMap = Object.fromEntries(profiles.map((p) => [p.userId, p]));
  const users = await AppDataSource.getRepository(User).find({ where: { id: In(proIds) } });
  const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

  const bids = await AppDataSource.getRepository(Bid).find({
    where: { tradespersonId: In(proIds) },
    relations: ["job"],
    order: { createdAt: "DESC" },
    take: Math.min(500, proIds.length * 40),
  });
  const buckets: Record<string, number[]> = {};
  for (const bid of bids) {
    if (!bid.job?.createdAt) continue;
    const ms = new Date(bid.createdAt).getTime() - new Date(bid.job.createdAt).getTime();
    if (ms < 0 || ms > 14 * 24 * 3600000) continue;
    (buckets[bid.tradespersonId] ||= []).push(ms / 3600000);
  }
  const responseMap: Record<string, number | null> = {};
  for (const id of proIds) {
    const arr = buckets[id];
    responseMap[id] =
      arr?.length
        ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10
        : null;
  }

  const weights = await getMatchWeights();
  const jobCat = String(job.category || "").toLowerCase();
  const catAliases: Record<string, string[]> = {
    plumbing: ["plumbing", "plumber", "leak", "pipe", "bathroom", "kitchen", "fitting", "tap", "drain"],
    electrical: ["electrical", "electrician", "wiring", "fan", "light", "socket", "switch"],
    carpentry: ["carpentry", "carpenter", "wood", "furniture", "door", "cabinet"],
    painting: ["painting", "painter", "paint", "waterproofing", "texture", "wall"],
    appliance: ["appliance", "ac", "fridge", "washing", "microwave", "repair"],
    cleaning: ["cleaning", "cleaner", "housekeeping", "janitor", "sanitation", "deep clean"],
    construction: ["construction", "mason", "tiling", "welding", "fabricator", "civil", "skilled trade"],
    office_facilities: ["office", "facilities", "facility", "pantry", "receptionist", "maintenance", "fm"],
    tech_services: ["cctv", "networking", "network", "amc", "it support", "wifi", "camera", "server"],
    moving: ["moving", "mover", "drivers", "driver", "helpers", "helper", "packing", "relocation"],
    other: ["handyman", "general", "repair", "maintenance"],
  };
  const aliases = catAliases[jobCat] || (jobCat ? [jobCat] : []);

  const ranked = favs.map((f) => {
    const p = profileMap[f.targetId];
    const u = userMap[f.targetId] || p?.user;
    const tags = Array.isArray(f.tags) ? f.tags.map((t) => String(t)) : [];
    const tagHits: string[] = [];
    for (const t of tags) {
      const tl = t.toLowerCase().trim();
      if (!tl) continue;
      if (jobCat && (tl === jobCat || tl.includes(jobCat) || jobCat.includes(tl))) {
        if (!tagHits.includes(t)) tagHits.push(t);
        continue;
      }
      for (const a of aliases) {
        if (tl === a || tl.includes(a) || a.includes(tl)) {
          if (!tagHits.includes(t)) tagHits.push(t);
          break;
        }
      }
    }
    const tagBoost = tagHits.length ? Math.min(12, 4 + tagHits.length * 3) : 0;

    let score = 0;
    let breakdown = {
      skills: 0,
      rating: 0,
      response: 0,
      distance: 0,
      total: 0,
      skillHits: [] as string[],
      distanceKm: null as number | null,
      avgResponseHours: null as number | null,
      weights,
    };
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
        avgResponseHours: responseMap[p.userId],
        name: u?.name || p.user?.name || null,
      };
      breakdown = { ...scoreProForJob(job, input, weights), weights };
      score = breakdown.total;
    }

    const jobHrs = buckets[f.targetId] || [];
    const responseSla = buildResponseSla({ jobHours: jobHrs });
    const smartScore = Math.round((score + tagBoost) * 10) / 10;

    const heat = p
      ? buildAvailabilityHeat(p.weeklyAvailability as any, p.blockedDates)
      : { days: [], score: 0, totalHours: 0, clean: false };
    const minHeatGate = DEFAULT_SHORTLIST_INVITE_MIN_HEAT;
    const heatGate = shortlistInviteBlockedByHeat(heat, minHeatGate);

    return {
      userId: f.targetId,
      name: u?.name || p?.user?.name || null,
      city: p?.city || null,
      skills: p?.skills || null,
      averageRating: Number(p?.averageRating || 0),
      reviewCount: p?.reviewCount || 0,
      verificationStatus: p?.verificationStatus || null,
      notes: f.notes || null,
      tags,
      tagHits,
      tagBoost,
      score,
      smartScore,
      breakdown,
      responseSla,
      availabilityHeat: heat,
      shortlistInviteMinHeat: minHeatGate,
      inviteBlockedByHeat: heatGate.blocked,
      inviteHeatReason: heatGate.blocked ? heatGate.reason : null,
    };
  });

  ranked.sort((a, b) => b.smartScore - a.smartScore || b.score - a.score);

  return res.json({
    jobId: job.id,
    category: job.category,
    shortlist: ranked,
    weights,
    shortlistInviteMinHeat: DEFAULT_SHORTLIST_INVITE_MIN_HEAT,
  });
}

const INVITE_COOLDOWN_MS = 60 * 60 * 1000;
const MAX_INVITES_PER_JOB = 20;
const MAX_BULK_INVITE = 10;

async function findInviteNotifications(jobId: string, tradespersonId?: string) {
  const qb = AppDataSource.getRepository(Notification)
    .createQueryBuilder("n")
    .where("n.type = :type", { type: NotificationType.MATCH })
    .andWhere("n.meta->>'invite' = 'true'")
    .andWhere("n.meta->>'jobId' = :jobId", { jobId })
    .orderBy("n.createdAt", "DESC");
  if (tradespersonId) {
    qb.andWhere("n.userId = :uid", { uid: tradespersonId });
  }
  return qb.getMany();
}

export async function inviteSuggestedPro(req: Request, res: Response) {
  const job = await jobRepo().findOne({ where: { id: param(req, "id") } });
  if (!job) {
    return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });
  }
  if (job.homeownerId !== req.user!.id && req.user!.role !== UserRole.ADMIN) {
    return res.status(403).json({ message: "Only the homeowner can invite pros", code: "FORBIDDEN" });
  }
  if (job.status !== JobStatus.OPEN && job.status !== JobStatus.BIDDING_CLOSED) {
    return res.status(400).json({
      message: "Invites are only for open jobs",
      code: "INVALID_STATUS",
    });
  }

  const tradespersonId = String(req.body?.tradespersonId || "").trim();
  if (!tradespersonId) {
    return res.status(400).json({ message: "tradespersonId is required" });
  }
  const messageRaw = req.body?.message != null ? String(req.body.message).trim() : "";
  const message = messageRaw.slice(0, 500) || undefined;
  const sourceRaw = String(req.body?.source || "").trim().toLowerCase();
  const inviteSource = ["shortlist", "suggested", "profile", "bulk", "other"].includes(sourceRaw)
    ? sourceRaw
    : "suggested";
  const shortlistRankRaw = Number(req.body?.shortlistRank);
  const shortlistRank =
    inviteSource === "shortlist" && Number.isFinite(shortlistRankRaw) && shortlistRankRaw > 0
      ? Math.floor(shortlistRankRaw)
      : null;
  const smartScoreRaw = Number(req.body?.smartScore);
  const smartScore =
    Number.isFinite(smartScoreRaw) ? Math.round(smartScoreRaw * 10) / 10 : null;

  const profile = await AppDataSource.getRepository(TradespersonProfile).findOne({
    where: { userId: tradespersonId },
    relations: ["user"],
  });
  if (!profile || profile.verificationStatus !== VerificationStatus.VERIFIED) {
    return res.status(404).json({ message: "Verified pro not found", code: "PRO_NOT_FOUND" });
  }
  if (profile.user?.role !== UserRole.TRADESPERSON) {
    return res.status(400).json({ message: "User is not a tradesperson" });
  }

  const notInterested = (profile.notInterestedCategories || [])
    .map((c) => String(c).toLowerCase())
    .includes(String(job.category).toLowerCase());
  // Soft preference only — invite still allowed; surfaced in response.

  // Wave 18: shortlist invites require heat ≥ N when schedule is clean
  const minHeatRaw = Number(req.body?.minHeat ?? req.query?.minHeat);
  const minHeatGate =
    Number.isFinite(minHeatRaw) && minHeatRaw > 0
      ? minHeatRaw
      : DEFAULT_SHORTLIST_INVITE_MIN_HEAT;
  if (inviteSource === "shortlist") {
    const heat = buildAvailabilityHeat(
      profile.weeklyAvailability as any,
      profile.blockedDates
    );
    const gate = shortlistInviteBlockedByHeat(heat, minHeatGate);
    if (gate.blocked) {
      return res.status(400).json({
        message: gate.reason,
        code: "SHORTLIST_HEAT_TOO_LOW",
        minHeat: gate.minHeat,
        availabilityHeat: heat,
      });
    }
  }

  // Already invited (active, not declined)?
  const existingForPro = await findInviteNotifications(job.id, tradespersonId);
  const active = existingForPro.find((n) => n.meta?.declined !== true);
  if (active) {
    return res.status(409).json({
      message: "This pro was already invited to this job",
      code: "ALREADY_INVITED",
      notificationId: active.id,
      invitedAt: active.createdAt,
    });
  }

  // Soft re-invite cooldown after decline (1 hour from declinedAt)
  const declined = existingForPro.find((n) => n.meta?.declined === true);
  if (declined) {
    const declinedAtRaw = declined.meta?.declinedAt;
    const declinedAt = declinedAtRaw
      ? new Date(String(declinedAtRaw))
      : new Date(declined.createdAt);
    const ageMs = Date.now() - declinedAt.getTime();
    if (ageMs < INVITE_COOLDOWN_MS) {
      const remainingMs = INVITE_COOLDOWN_MS - ageMs;
      const mins = Math.ceil(remainingMs / 60000);
      const cooldownUntil = new Date(declinedAt.getTime() + INVITE_COOLDOWN_MS).toISOString();
      return res.status(429).json({
        message: `Pro declined recently — try again in ~${mins} min`,
        code: "INVITE_COOLDOWN",
        retryAfterMinutes: mins,
        retryAfterMs: remainingMs,
        cooldownUntil,
        declinedAt: declinedAt.toISOString(),
      });
    }
  }

  // Per-job invite rate limit (active + declined count)
  const allForJob = await findInviteNotifications(job.id);
  if (allForJob.length >= MAX_INVITES_PER_JOB) {
    return res.status(429).json({
      message: `Invite limit reached for this job (${MAX_INVITES_PER_JOB})`,
      code: "INVITE_RATE_LIMIT",
      limit: MAX_INVITES_PER_JOB,
      used: allForJob.length,
    });
  }

  const homeowner = await AppDataSource.getRepository(User).findOne({
    where: { id: job.homeownerId },
  });
  const homeName = homeowner?.name || "A homeowner";

  const bodyParts = [
    `${homeName} invited you to bid on "${job.title}" (${job.category}${job.city ? ` · ${job.city}` : ""}).`,
  ];
  if (message) bodyParts.push(`Message: ${message}`);

  const notification = await createNotification({
    userId: tradespersonId,
    type: NotificationType.MATCH,
    title: "Job invite",
    body: bodyParts.join(" "),
    link: `/tradesperson/jobs/${job.id}?invite=1#bid-form`,
    meta: {
      jobId: job.id,
      invite: true,
      declined: false,
      fromUserId: job.homeownerId,
      message: message || null,
      source: inviteSource,
      shortlistRank,
      smartScore,
    },
  });

  return res.json({
    ok: true,
    jobId: job.id,
    tradespersonId,
    notificationId: notification?.id || null,
    softSkippedCategory: notInterested,
    source: inviteSource,
    shortlistRank,
    message: notification
      ? notInterested
        ? "Invite sent (pro marked this category as not interested — they may decline)."
        : "Invite sent — the pro will see an in-app notification."
      : "Invite recorded (pro may have match notifications disabled).",
  });
}

/** Soft decline: pro passes on an invite without bidding. Notifies homeowner gently. */
export async function declineJobInvite(req: Request, res: Response) {
  const job = await jobRepo().findOne({ where: { id: param(req, "id") } });
  if (!job) {
    return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });
  }
  if (req.user!.role !== UserRole.TRADESPERSON) {
    return res.status(403).json({ message: "Only tradespeople can decline invites", code: "FORBIDDEN" });
  }

  const invites = await findInviteNotifications(job.id, req.user!.id);
  const active = invites.find((n) => n.meta?.declined !== true);
  if (!active) {
    return res.status(404).json({
      message: "No pending invite for this job",
      code: "NO_INVITE",
    });
  }

  const noteRaw = req.body?.note != null ? String(req.body.note).trim() : "";
  const reasonRaw = req.body?.reason != null ? String(req.body.reason).trim() : "";
  const ALLOWED_REASONS = new Set([
    "busy",
    "schedule",
    "too_far",
    "rate",
    "specialty",
    "other",
  ]);
  const reason = ALLOWED_REASONS.has(reasonRaw) ? reasonRaw : undefined;
  const note = noteRaw.slice(0, 300) || undefined;

  const repo = AppDataSource.getRepository(Notification);
  active.read = true;
  active.meta = {
    ...(active.meta || {}),
    invite: true,
    jobId: job.id,
    declined: true,
    declinedAt: new Date().toISOString(),
    declineNote: note || null,
    declineReason: reason || null,
  };
  await repo.save(active);

  const pro = await AppDataSource.getRepository(User).findOne({ where: { id: req.user!.id } });
  const proName = pro?.name || "A tradesperson";
  const reasonLabel: Record<string, string> = {
    busy: "Busy / fully booked",
    schedule: "Schedule conflict",
    too_far: "Too far",
    rate: "Rate mismatch",
    specialty: "Not my specialty",
    other: "Other",
  };
  const reasonText = reason ? reasonLabel[reason] || reason : null;
  const detailParts = [reasonText, note].filter(Boolean);
  const body = detailParts.length
    ? `${proName} declined your invite on "${job.title}". ${detailParts.join(" — ")}`
    : `${proName} declined your invite on "${job.title}". They may still bid later.`;

  await createNotification({
    userId: job.homeownerId,
    type: NotificationType.MATCH,
    title: "Invite declined",
    body,
    link: `/homeowner/jobs/${job.id}`,
    meta: {
      jobId: job.id,
      inviteDeclined: true,
      fromUserId: req.user!.id,
      note: note || null,
      reason: reason || null,
    },
  });

  return res.json({
    ok: true,
    jobId: job.id,
    reason: reason || null,
    message: "Invite declined — the homeowner was notified.",
  });
}


function inviteCooldownInfo(n: Notification) {
  if (n.meta?.declined !== true) {
    return { inCooldown: false as const, remainingMs: 0, cooldownUntil: null as string | null };
  }
  const declinedAtRaw = n.meta?.declinedAt;
  const declinedAt = declinedAtRaw ? new Date(String(declinedAtRaw)) : new Date(n.createdAt);
  const until = declinedAt.getTime() + INVITE_COOLDOWN_MS;
  const remainingMs = Math.max(0, until - Date.now());
  return {
    inCooldown: remainingMs > 0,
    remainingMs,
    cooldownUntil: remainingMs > 0 ? new Date(until).toISOString() : null,
  };
}

/** Invite history for a job (homeowner/admin): who was invited, when, pending/declined + cooldown. */
export async function listJobInvites(req: Request, res: Response) {
  const job = await jobRepo().findOne({ where: { id: param(req, "id") } });
  if (!job) {
    return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });
  }
  if (job.homeownerId !== req.user!.id && req.user!.role !== UserRole.ADMIN) {
    return res.status(403).json({ message: "Only the homeowner can view invites", code: "FORBIDDEN" });
  }

  const rows = await findInviteNotifications(job.id);
  const proIds = [...new Set(rows.map((n) => n.userId))];
  const inviterIds = [
    ...new Set(
      rows
        .map((n) => (n.meta?.fromUserId != null ? String(n.meta.fromUserId) : ""))
        .filter(Boolean)
    ),
  ];
  const userIds = [...new Set([...proIds, ...inviterIds, job.homeownerId])];
  const users = userIds.length
    ? await AppDataSource.getRepository(User).find({ where: { id: In(userIds) } })
    : [];
  const byId = Object.fromEntries(users.map((u) => [u.id, u]));

  const bidRows = proIds.length
    ? await AppDataSource.getRepository(Bid).find({
        where: { jobId: job.id, tradespersonId: In(proIds) },
      })
    : [];
  const bidByPro = new Set(bidRows.map((b) => b.tradespersonId));

  const invites = rows.map((n) => {
    const declined = n.meta?.declined === true;
    const cool = inviteCooldownInfo(n);
    const inviterId =
      n.meta?.fromUserId != null ? String(n.meta.fromUserId) : job.homeownerId;
    const inviter = byId[inviterId];
    const pro = byId[n.userId];
    const opened =
      n.meta?.openedAt != null || n.meta?.clickedAt != null || n.read === true;
    return {
      id: n.id,
      tradespersonId: n.userId,
      tradespersonName: pro?.name || null,
      tradespersonEmail: pro?.email || null,
      invitedByUserId: inviterId,
      invitedByName: inviter?.name || null,
      invitedAt: n.createdAt,
      status: declined ? ("declined" as const) : ("pending" as const),
      declinedAt: declined
        ? n.meta?.declinedAt
          ? String(n.meta.declinedAt)
          : n.createdAt.toISOString()
        : null,
      declineNote: declined && n.meta?.declineNote != null ? String(n.meta.declineNote) : null,
      declineReason:
        declined && n.meta?.declineReason != null ? String(n.meta.declineReason) : null,
      message: n.meta?.message != null ? String(n.meta.message) : null,
      cooldownUntil: cool.cooldownUntil,
      cooldownRemainingMs: cool.remainingMs,
      inCooldown: cool.inCooldown,
      opened,
      openedAt: n.meta?.openedAt != null ? String(n.meta.openedAt) : null,
      clickedAt: n.meta?.clickedAt != null ? String(n.meta.clickedAt) : n.read ? n.createdAt : null,
      notificationRead: !!n.read,
      bidAfterInvite: bidByPro.has(n.userId),
    };
  });

  return res.json({
    jobId: job.id,
    invites,
    used: rows.length,
    limit: MAX_INVITES_PER_JOB,
    remaining: Math.max(0, MAX_INVITES_PER_JOB - rows.length),
  });
}

/** Bulk invite suggested pros (rate-limit aware; stops when job invite cap hit). */
export async function bulkInviteSuggestedPros(req: Request, res: Response) {
  const job = await jobRepo().findOne({ where: { id: param(req, "id") } });
  if (!job) {
    return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });
  }
  if (job.homeownerId !== req.user!.id && req.user!.role !== UserRole.ADMIN) {
    return res.status(403).json({ message: "Only the homeowner can invite pros", code: "FORBIDDEN" });
  }
  if (job.status !== JobStatus.OPEN && job.status !== JobStatus.BIDDING_CLOSED) {
    return res.status(400).json({
      message: "Invites are only for open jobs",
      code: "INVALID_STATUS",
    });
  }

  const rawIds: unknown[] = Array.isArray(req.body?.tradespersonIds)
    ? req.body.tradespersonIds
    : [];
  const tradespersonIds = Array.from(
    new Set(
      rawIds
        .map((x) => String(x ?? "").trim())
        .filter((id) => id.length > 0)
    )
  ).slice(0, MAX_BULK_INVITE);
  if (!tradespersonIds.length) {
    return res.status(400).json({
      message: "tradespersonIds is required (1–10)",
      code: "VALIDATION",
    });
  }
  const messageRaw = req.body?.message != null ? String(req.body.message).trim() : "";
  const message = messageRaw.slice(0, 500) || undefined;
  const sourceRaw = String(req.body?.source || "").trim().toLowerCase();
  const inviteSource = ["shortlist", "suggested", "profile", "bulk", "other"].includes(sourceRaw)
    ? sourceRaw
    : "bulk";
  const ranksIn =
    req.body?.shortlistRanks && typeof req.body.shortlistRanks === "object"
      ? (req.body.shortlistRanks as Record<string, unknown>)
      : {};
  const scoresIn =
    req.body?.smartScores && typeof req.body.smartScores === "object"
      ? (req.body.smartScores as Record<string, unknown>)
      : {};
  const minHeatRaw = Number(req.body?.minHeat);
  const minHeatGate =
    Number.isFinite(minHeatRaw) && minHeatRaw > 0
      ? minHeatRaw
      : DEFAULT_SHORTLIST_INVITE_MIN_HEAT;

  const homeowner = await AppDataSource.getRepository(User).findOne({
    where: { id: job.homeownerId },
  });
  const homeName = homeowner?.name || "A homeowner";

  type BulkResult = {
    tradespersonId: string;
    ok: boolean;
    code?: string;
    message: string;
    notificationId?: string | null;
    cooldownUntil?: string | null;
    retryAfterMs?: number;
  };
  const results: BulkResult[] = [];
  let stoppedForRateLimit = false;

  for (const tradespersonId of tradespersonIds) {
    if (stoppedForRateLimit) {
      results.push({
        tradespersonId,
        ok: false,
        code: "SKIPPED",
        message: "Skipped — invite limit reached earlier in this batch",
      });
      continue;
    }

    const profile = await AppDataSource.getRepository(TradespersonProfile).findOne({
      where: { userId: tradespersonId },
      relations: ["user"],
    });
    if (!profile || profile.verificationStatus !== VerificationStatus.VERIFIED) {
      results.push({
        tradespersonId,
        ok: false,
        code: "PRO_NOT_FOUND",
        message: "Verified pro not found",
      });
      continue;
    }

    if (inviteSource === "shortlist") {
      const heat = buildAvailabilityHeat(
        profile.weeklyAvailability as any,
        profile.blockedDates
      );
      const gate = shortlistInviteBlockedByHeat(heat, minHeatGate);
      if (gate.blocked) {
        results.push({
          tradespersonId,
          ok: false,
          code: "SHORTLIST_HEAT_TOO_LOW",
          message: gate.reason || "Availability heat too low for shortlist invite",
        });
        continue;
      }
    }

    const existingForPro = await findInviteNotifications(job.id, tradespersonId);
    const active = existingForPro.find((n) => n.meta?.declined !== true);
    if (active) {
      results.push({
        tradespersonId,
        ok: false,
        code: "ALREADY_INVITED",
        message: "Already invited",
        notificationId: active.id,
      });
      continue;
    }

    const declined = existingForPro.find((n) => n.meta?.declined === true);
    if (declined) {
      const cool = inviteCooldownInfo(declined);
      if (cool.inCooldown) {
        results.push({
          tradespersonId,
          ok: false,
          code: "INVITE_COOLDOWN",
          message: `In cooldown (~${Math.ceil(cool.remainingMs / 60000)} min)`,
          cooldownUntil: cool.cooldownUntil,
          retryAfterMs: cool.remainingMs,
        });
        continue;
      }
    }

    const allForJob = await findInviteNotifications(job.id);
    if (allForJob.length >= MAX_INVITES_PER_JOB) {
      stoppedForRateLimit = true;
      results.push({
        tradespersonId,
        ok: false,
        code: "INVITE_RATE_LIMIT",
        message: `Invite limit reached (${MAX_INVITES_PER_JOB})`,
      });
      continue;
    }

    const bodyParts = [
      `${homeName} invited you to bid on "${job.title}" (${job.category}${job.city ? ` · ${job.city}` : ""}).`,
    ];
    if (message) bodyParts.push(`Message: ${message}`);

    const rankN = Number(ranksIn[tradespersonId]);
    const shortlistRank =
      inviteSource === "shortlist" && Number.isFinite(rankN) && rankN > 0
        ? Math.floor(rankN)
        : null;
    const scoreN = Number(scoresIn[tradespersonId]);
    const smartScore = Number.isFinite(scoreN) ? Math.round(scoreN * 10) / 10 : null;

    const notification = await createNotification({
      userId: tradespersonId,
      type: NotificationType.MATCH,
      title: "Job invite",
      body: bodyParts.join(" "),
      link: `/tradesperson/jobs/${job.id}?invite=1#bid-form`,
      meta: {
        jobId: job.id,
        invite: true,
        declined: false,
        fromUserId: job.homeownerId,
        message: message || null,
        bulk: true,
        source: inviteSource,
        shortlistRank,
        smartScore,
      },
    });

    results.push({
      tradespersonId,
      ok: true,
      message: notification
        ? "Invite sent"
        : "Invite recorded (pro may have match notifications disabled)",
      notificationId: notification?.id || null,
    });
  }

  const sent = results.filter((r) => r.ok).length;
  const failed = results.length - sent;
  return res.json({
    ok: sent > 0,
    jobId: job.id,
    sent,
    failed,
    stoppedForRateLimit,
    results,
    message:
      sent === 0
        ? failed
          ? "No invites sent — see per-pro results"
          : "Nothing to send"
        : `Sent ${sent} invite${sent === 1 ? "" : "s"}${failed ? ` · ${failed} skipped` : ""}`,
  });
}

/** Pro marks invite as opened/clicked when landing via ?invite=1 deep-link. */
export async function markInviteOpened(req: Request, res: Response) {
  const job = await jobRepo().findOne({ where: { id: param(req, "id") } });
  if (!job) {
    return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });
  }
  if (req.user!.role !== UserRole.TRADESPERSON) {
    return res.status(403).json({ message: "Only tradespeople can mark invite opens", code: "FORBIDDEN" });
  }

  const invites = await findInviteNotifications(job.id, req.user!.id);
  const active = invites.find((n) => n.meta?.declined !== true) || invites[0];
  if (!active) {
    return res.status(404).json({ message: "No invite found for this job", code: "NO_INVITE" });
  }

  const now = new Date().toISOString();
  const meta = { ...(active.meta || {}) };
  const firstOpen = meta.openedAt == null;
  if (firstOpen) meta.openedAt = now;
  meta.clickedAt = now;
  meta.lastOpenedAt = now;
  active.meta = meta;
  active.read = true;
  await AppDataSource.getRepository(Notification).save(active);

  return res.json({
    ok: true,
    notificationId: active.id,
    openedAt: meta.openedAt,
    clickedAt: meta.clickedAt,
    firstOpen,
  });
}

/** Job-level invite analytics for homeowners (sent / declined / opened / bid-after). */
export async function getJobInviteAnalytics(req: Request, res: Response) {
  const job = await jobRepo().findOne({ where: { id: param(req, "id") } });
  if (!job) {
    return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });
  }
  if (job.homeownerId !== req.user!.id && req.user!.role !== UserRole.ADMIN) {
    return res.status(403).json({ message: "Only the homeowner can view invite analytics", code: "FORBIDDEN" });
  }

  const rows = await findInviteNotifications(job.id);
  const proIds = [...new Set(rows.map((n) => n.userId))];
  const bids = proIds.length
    ? await AppDataSource.getRepository(Bid).find({
        where: { jobId: job.id, tradespersonId: In(proIds) },
      })
    : [];
  const bidByPro = new Set(bids.map((b) => b.tradespersonId));

  let sent = rows.length;
  let declined = 0;
  let pending = 0;
  let opened = 0;
  let clicked = 0;
  let bidAfterInvite = 0;
  const byReason: Record<string, number> = {};

  for (const n of rows) {
    const isDeclined = n.meta?.declined === true;
    if (isDeclined) {
      declined += 1;
      const reason = n.meta?.declineReason != null ? String(n.meta.declineReason) : "unspecified";
      byReason[reason] = (byReason[reason] || 0) + 1;
    } else {
      pending += 1;
    }
    const wasOpened = n.meta?.openedAt != null || n.meta?.clickedAt != null || n.read === true;
    if (wasOpened) opened += 1;
    if (n.meta?.clickedAt != null || n.read === true) clicked += 1;
    if (bidByPro.has(n.userId)) bidAfterInvite += 1;
  }

  const uniquePros = proIds.length;
  const openRate = sent ? Math.round((opened / sent) * 1000) / 10 : 0;
  const bidRate = sent ? Math.round((bidAfterInvite / sent) * 1000) / 10 : 0;
  const declineRate = sent ? Math.round((declined / sent) * 1000) / 10 : 0;

  return res.json({
    jobId: job.id,
    sent,
    uniquePros,
    pending,
    declined,
    opened,
    clicked,
    bidAfterInvite,
    openRate,
    bidRate,
    declineRate,
    declineReasons: byReason,
    limit: MAX_INVITES_PER_JOB,
    remaining: Math.max(0, MAX_INVITES_PER_JOB - sent),
  });
}

/** Aggregate invite analytics across all of a homeowner's jobs. */
export async function getHomeownerInviteAnalytics(req: Request, res: Response) {
  if (req.user!.role !== UserRole.HOMEOWNER && req.user!.role !== UserRole.ADMIN) {
    return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
  }
  const homeownerId =
    req.user!.role === UserRole.ADMIN && req.query.homeownerId
      ? String(req.query.homeownerId)
      : req.user!.id;

  const jobs = await jobRepo().find({ where: { homeownerId } });
  if (!jobs.length) {
    return res.json({
      homeownerId,
      jobs: 0,
      sent: 0,
      declined: 0,
      opened: 0,
      clicked: 0,
      bidAfterInvite: 0,
      openRate: 0,
      bidRate: 0,
      declineRate: 0,
      byJob: [],
    });
  }

  const jobIds = jobs.map((j) => j.id);
  const allInvites = await AppDataSource.getRepository(Notification)
    .createQueryBuilder("n")
    .where("n.type = :type", { type: NotificationType.MATCH })
    .andWhere("n.meta->>'invite' = 'true'")
    .andWhere("n.meta->>'jobId' IN (:...jobIds)", { jobIds })
    .getMany();

  const invitesByJob: Record<string, typeof allInvites> = {};
  for (const n of allInvites) {
    const jid = n.meta?.jobId != null ? String(n.meta.jobId) : "";
    if (!jid) continue;
    (invitesByJob[jid] ||= []).push(n);
  }

  const allProIds = [...new Set(allInvites.map((n) => n.userId))];
  const allBids = allProIds.length
    ? await AppDataSource.getRepository(Bid).find({
        where: { jobId: In(jobIds), tradespersonId: In(allProIds) },
      })
    : [];
  const bidKey = new Set(allBids.map((b) => `${b.jobId}:${b.tradespersonId}`));

  let sent = 0;
  let declined = 0;
  let opened = 0;
  let clicked = 0;
  let bidAfterInvite = 0;
  const byJob: {
    jobId: string;
    title: string;
    status: string;
    category: string;
    sent: number;
    declined: number;
    opened: number;
    clicked: number;
    bidAfterInvite: number;
  }[] = [];

  for (const job of jobs) {
    const rows = invitesByJob[job.id] || [];
    if (!rows.length) continue;
    let jSent = rows.length;
    let jDeclined = 0;
    let jOpened = 0;
    let jClicked = 0;
    let jBid = 0;
    for (const n of rows) {
      if (n.meta?.declined === true) jDeclined += 1;
      if (n.meta?.openedAt != null || n.meta?.clickedAt != null || n.read === true) jOpened += 1;
      if (n.meta?.clickedAt != null || n.read === true) jClicked += 1;
      if (bidKey.has(`${job.id}:${n.userId}`)) jBid += 1;
    }
    sent += jSent;
    declined += jDeclined;
    opened += jOpened;
    clicked += jClicked;
    bidAfterInvite += jBid;
    byJob.push({
      jobId: job.id,
      title: job.title,
      status: job.status,
      category: job.category,
      sent: jSent,
      declined: jDeclined,
      opened: jOpened,
      clicked: jClicked,
      bidAfterInvite: jBid,
    });
  }

  byJob.sort((a, b) => b.sent - a.sent);

  return res.json({
    homeownerId,
    jobs: byJob.length,
    sent,
    declined,
    opened,
    clicked,
    bidAfterInvite,
    openRate: sent ? Math.round((opened / sent) * 1000) / 10 : 0,
    bidRate: sent ? Math.round((bidAfterInvite / sent) * 1000) / 10 : 0,
    declineRate: sent ? Math.round((declined / sent) * 1000) / 10 : 0,
    byJob,
  });
}

/**
 * Shortlist invite funnel for a job: rank → invite → bid.
 * Uses current shortlist size as "ranked", invites tagged source=shortlist,
 * and bids from those invited pros.
 */
export async function getShortlistInviteAnalytics(req: Request, res: Response) {
  const job = await jobRepo().findOne({ where: { id: param(req, "id") } });
  if (!job) {
    return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });
  }
  if (job.homeownerId !== req.user!.id && req.user!.role !== UserRole.ADMIN) {
    return res.status(403).json({
      message: "Only the homeowner can view shortlist invite analytics",
      code: "FORBIDDEN",
    });
  }

  const favs = await AppDataSource.getRepository(Favorite).find({
    where: { userId: job.homeownerId, targetType: FavoriteTargetType.PRO },
    order: { createdAt: "DESC" },
  });
  const ranked = favs.length;

  const invites = await findInviteNotifications(job.id);
  const shortlistInvites = invites.filter((n) => String(n.meta?.source || "") === "shortlist");
  // Fallback: if older invites lack source but pro is on shortlist, count them softly
  const shortlistIds = new Set(favs.map((f) => f.targetId));
  const invitedRows =
    shortlistInvites.length > 0
      ? shortlistInvites
      : invites.filter((n) => shortlistIds.has(n.userId));

  const invitedProIds = [...new Set(invitedRows.map((n) => n.userId))];
  const invited = invitedProIds.length;

  const bids =
    invitedProIds.length > 0
      ? await AppDataSource.getRepository(Bid).find({
          where: { jobId: job.id, tradespersonId: In(invitedProIds) },
        })
      : [];
  const bidPros = new Set(bids.map((b) => b.tradespersonId));
  const bidAfter = bidPros.size;

  const users =
    invitedProIds.length > 0
      ? await AppDataSource.getRepository(User).find({ where: { id: In(invitedProIds) } })
      : [];
  const nameById = Object.fromEntries(users.map((u) => [u.id, u.name || u.email]));

  // Rank at invite time (from meta), else current shortlist order index
  const favOrder = Object.fromEntries(favs.map((f, i) => [f.targetId, i + 1]));
  const byRankMap: Record<
    number,
    { rank: number; invited: number; bidAfter: number; names: string[] }
  > = {};
  for (const n of invitedRows) {
    const rankRaw = Number(n.meta?.shortlistRank);
    const rank =
      Number.isFinite(rankRaw) && rankRaw > 0
        ? Math.floor(rankRaw)
        : favOrder[n.userId] || 99;
    const bucket = (byRankMap[rank] ||= { rank, invited: 0, bidAfter: 0, names: [] });
    // count unique pros per rank loosely by name push once
    if (!bucket.names.includes(nameById[n.userId] || n.userId)) {
      bucket.invited += 1;
      bucket.names.push(nameById[n.userId] || "Pro");
      if (bidPros.has(n.userId)) bucket.bidAfter += 1;
    }
  }
  const byRank = Object.values(byRankMap).sort((a, b) => a.rank - b.rank);

  const inviteRate = ranked ? Math.round((invited / ranked) * 1000) / 10 : 0;
  const bidRate = invited ? Math.round((bidAfter / invited) * 1000) / 10 : 0;
  const overallRate = ranked ? Math.round((bidAfter / ranked) * 1000) / 10 : 0;

  const ranksWithBid = invitedRows
    .filter((n) => bidPros.has(n.userId))
    .map((n) => {
      const r = Number(n.meta?.shortlistRank);
      return Number.isFinite(r) && r > 0 ? r : favOrder[n.userId] || null;
    })
    .filter((r): r is number => r != null);
  const avgRankBid =
    ranksWithBid.length > 0
      ? Math.round((ranksWithBid.reduce((a, b) => a + b, 0) / ranksWithBid.length) * 10) / 10
      : null;

  return res.json({
    jobId: job.id,
    ranked,
    invited,
    bidAfter,
    inviteRate,
    bidRate,
    overallRate,
    avgRankBid,
    funnel: [
      { stage: "ranked", label: "On shortlist", count: ranked, rate: 100 },
      { stage: "invited", label: "Invited", count: invited, rate: inviteRate },
      { stage: "bid", label: "Bid after invite", count: bidAfter, rate: bidRate },
    ],
    byRank,
    sourceTagged: shortlistInvites.length > 0,
  });
}

/** Aggregate shortlist invite funnel across homeowner jobs. */
export async function getHomeownerShortlistInviteAnalytics(req: Request, res: Response) {
  if (req.user!.role !== UserRole.HOMEOWNER && req.user!.role !== UserRole.ADMIN) {
    return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
  }
  const homeownerId =
    req.user!.role === UserRole.ADMIN && req.query.homeownerId
      ? String(req.query.homeownerId)
      : req.user!.id;

  const jobs = await jobRepo().find({ where: { homeownerId } });
  const favs = await AppDataSource.getRepository(Favorite).find({
    where: { userId: homeownerId, targetType: FavoriteTargetType.PRO },
  });
  const ranked = favs.length;
  const shortlistIds = new Set(favs.map((f) => f.targetId));

  if (!jobs.length) {
    return res.json({
      homeownerId,
      ranked,
      invited: 0,
      bidAfter: 0,
      inviteRate: 0,
      bidRate: 0,
      overallRate: 0,
      jobs: 0,
      byJob: [],
      funnel: [
        { stage: "ranked", label: "On shortlist", count: ranked, rate: 100 },
        { stage: "invited", label: "Invited", count: 0, rate: 0 },
        { stage: "bid", label: "Bid after invite", count: 0, rate: 0 },
      ],
    });
  }

  const jobIds = jobs.map((j) => j.id);
  const allInvites = await AppDataSource.getRepository(Notification)
    .createQueryBuilder("n")
    .where("n.type = :type", { type: NotificationType.MATCH })
    .andWhere("n.meta->>'invite' = 'true'")
    .andWhere("n.meta->>'jobId' IN (:...jobIds)", { jobIds })
    .getMany();

  const shortlistInvites = allInvites.filter((n) => {
    if (String(n.meta?.source || "") === "shortlist") return true;
    return shortlistIds.has(n.userId);
  });

  // Unique (jobId, proId) pairs
  const inviteKeys = new Set(
    shortlistInvites.map((n) => `${n.meta?.jobId}:${n.userId}`)
  );
  const invited = inviteKeys.size;

  const allProIds = [...new Set(shortlistInvites.map((n) => n.userId))];
  const allBids =
    allProIds.length > 0
      ? await AppDataSource.getRepository(Bid).find({
          where: { jobId: In(jobIds), tradespersonId: In(allProIds) },
        })
      : [];
  const bidKey = new Set(allBids.map((b) => `${b.jobId}:${b.tradespersonId}`));
  let bidAfter = 0;
  for (const key of inviteKeys) {
    if (bidKey.has(key)) bidAfter += 1;
  }

  const byJobMap: Record<
    string,
    { jobId: string; title: string; status: string; invited: number; bidAfter: number }
  > = {};
  for (const n of shortlistInvites) {
    const jid = String(n.meta?.jobId || "");
    if (!jid) continue;
    const job = jobs.find((j) => j.id === jid);
    if (!job) continue;
    const row = (byJobMap[jid] ||= {
      jobId: jid,
      title: job.title,
      status: job.status,
      invited: 0,
      bidAfter: 0,
    });
  }
  for (const key of inviteKeys) {
    const [jid, pid] = key.split(":");
    if (!byJobMap[jid]) continue;
    byJobMap[jid].invited += 1;
    if (bidKey.has(key)) byJobMap[jid].bidAfter += 1;
  }
  const byJob = Object.values(byJobMap).sort((a, b) => b.invited - a.invited);

  // For aggregate, "ranked" is shortlist size (cross-job pool); invite rate vs that pool is soft
  const inviteRate = ranked ? Math.round((invited / Math.max(ranked, 1)) * 1000) / 10 : 0;
  const bidRate = invited ? Math.round((bidAfter / invited) * 1000) / 10 : 0;
  const overallRate = ranked ? Math.round((bidAfter / Math.max(ranked, 1)) * 1000) / 10 : 0;

  return res.json({
    homeownerId,
    ranked,
    invited,
    bidAfter,
    inviteRate,
    bidRate,
    overallRate,
    jobs: byJob.length,
    byJob,
    funnel: [
      { stage: "ranked", label: "On shortlist", count: ranked, rate: 100 },
      { stage: "invited", label: "Invited (jobs×pros)", count: invited, rate: inviteRate },
      { stage: "bid", label: "Bid after invite", count: bidAfter, rate: bidRate },
    ],
  });
}

