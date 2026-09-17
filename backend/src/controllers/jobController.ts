import type { Request, Response } from "express";
import { In } from "typeorm";
import { AppDataSource } from "../data-source";
import { Job, JobStatus } from "../entities/Job";
import { Bid, BidStatus } from "../entities/Bid";
import { UserRole } from "../entities/User";
import { NotificationType } from "../entities/Notification";
import { UploadKind } from "../entities/Upload";
import {
  cacheGetJson,
  cacheSetJson,
  invalidateOpenJobsCache,
  openJobsCacheKey,
} from "../utils/cache";
import { notifyHomeownerMatchHints } from "../utils/matchAlerts";
import { createNotifications } from "../utils/notifications";
import { revokeThreadStreams } from "../utils/sse";
import { toJob } from "../serializers";
import {
  assertJobAccess,
  assertOwner,
  loadJobContext,
  type Viewer,
} from "../policies/jobPolicy";
import { transitionJob } from "../domain/jobStateMachine";
import { deleteUploadByRef, discardFiles, fileRef, storeUploads } from "../services/files";
import { filesOf } from "../middleware/upload";
import { badRequest, conflict } from "../http/errors";
import { logger } from "../logger";

const jobRepo = () => AppDataSource.getRepository(Job);

export const viewer = (req: Request): Viewer => ({
  id: req.user!.id,
  role: req.user!.role,
  proVerified: req.user!.proVerified,
});

const EARTH_KM = 6371;
const distanceSql = `(${EARTH_KM} * 2 * asin(sqrt(power(sin(radians(job.lat - :nearLat) / 2), 2) + cos(radians(:nearLat)) * cos(radians(job.lat)) * power(sin(radians(job.lng - :nearLng) / 2), 2))))`;

export async function listJobs(req: Request, res: Response) {
  const query = req.valid.query;
  const { role, id: userId } = req.user!;
  const pageNum = query.page ?? 1;
  const limitNum = query.limit ?? 10;
  const mine = query.scope === "mine";
  const proBrowse = role === UserRole.TRADESPERSON && !mine;

  const cacheKey = proBrowse
    ? await openJobsCacheKey({ ...query, page: pageNum, limit: limitNum, from: query.from?.toISOString(), to: query.to?.toISOString() })
    : null;
  if (cacheKey) {
    const cached = await cacheGetJson<Record<string, unknown>>(cacheKey);
    if (cached) return res.json({ ...cached, cached: true });
  }

  const qb = jobRepo().createQueryBuilder("job");
  if (role === UserRole.HOMEOWNER) {
    qb.andWhere("job.homeownerId = :userId", { userId });
  } else if (role === UserRole.TRADESPERSON) {
    if (mine) {
      qb.innerJoin(Bid, "accepted", "accepted.id = job.acceptedBidId").andWhere("accepted.tradespersonId = :userId", {
        userId,
      });
    } else {
      qb.andWhere("job.status = :openOnly", { openOnly: JobStatus.OPEN });
    }
  }

  const search = String(query.q ?? query.keyword ?? "").trim();
  if (search) {
    qb.andWhere("(job.title ILIKE :search OR job.description ILIKE :search)", { search: `%${escapeLike(search)}%` });
  }
  if (query.category) qb.andWhere("job.category = :category", { category: query.category });
  if (query.siteType) qb.andWhere("job.siteType = :siteType", { siteType: query.siteType });

  const cityQ = String(query.city || "").trim();
  const nbhQ = String(query.neighborhood || query.area || "").trim();
  if (cityQ) {
    qb.andWhere("(job.city ILIKE :cityQ OR job.area ILIKE :cityQ)", { cityQ: `%${escapeLike(cityQ)}%` });
  }
  if (nbhQ) {
    qb.andWhere("(job.area ILIKE :nbh OR job.pincode ILIKE :nbh)", { nbh: `%${escapeLike(nbhQ)}%` });
  }
  if (query.budgetMin !== undefined) qb.andWhere("(job.budgetMax IS NULL OR job.budgetMax >= :bMin)", { bMin: query.budgetMin });
  if (query.budgetMax !== undefined) qb.andWhere("(job.budgetMin IS NULL OR job.budgetMin <= :bMax)", { bMax: query.budgetMax });

  if (query.status && (role !== UserRole.TRADESPERSON || mine)) {
    qb.andWhere("job.status = :status", { status: query.status });
  }

  const field = query.dateField === "preferred" ? "job.preferredStart" : "job.createdAt";
  if (query.from) qb.andWhere(`${field} >= :from`, { from: query.from });
  if (query.to) qb.andWhere(`${field} <= :to`, { to: query.to });

  const hasOrigin = query.nearLat !== undefined && query.nearLng !== undefined;
  if (hasOrigin) {
    qb.setParameters({ nearLat: query.nearLat, nearLng: query.nearLng });
    qb.addSelect(`CASE WHEN job.lat IS NULL OR job.lng IS NULL THEN NULL ELSE ${distanceSql} END`, "distance_km");
    if (query.maxKm && query.maxKm > 0) {
      const dLat = query.maxKm / 111;
      const dLng = query.maxKm / (111 * Math.max(0.1, Math.cos((query.nearLat! * Math.PI) / 180)));
      qb.andWhere("job.lat BETWEEN :minLat AND :maxLat AND job.lng BETWEEN :minLng AND :maxLng", {
        minLat: query.nearLat! - dLat,
        maxLat: query.nearLat! + dLat,
        minLng: query.nearLng! - dLng,
        maxLng: query.nearLng! + dLng,
      });
      qb.andWhere(`${distanceSql} <= :maxKm`, { maxKm: query.maxKm });
    }
  }

  if (cityQ) {
    qb.addSelect(
      `CASE WHEN LOWER(COALESCE(job.city, '')) = LOWER(:cityExact) THEN 0 WHEN job.city ILIKE :cityLike OR job.area ILIKE :cityLike THEN 1 ELSE 2 END`,
      "city_rank"
    );
    qb.setParameter("cityExact", cityQ);
    qb.setParameter("cityLike", `%${escapeLike(cityQ)}%`);
    qb.orderBy("city_rank", "ASC");
  }
  const order = (col: string, dir: "ASC" | "DESC", nulls?: "NULLS LAST") => {
    if (cityQ) qb.addOrderBy(col, dir, nulls);
    else qb.orderBy(col, dir, nulls);
  };
  switch (query.sort) {
    case "budget_desc":
      order("job.budgetMax", "DESC", "NULLS LAST");
      break;
    case "budget_asc":
      order("job.budgetMax", "ASC", "NULLS LAST");
      break;
    case "preferred_date":
      order("job.preferredStart", "ASC", "NULLS LAST");
      break;
    case "distance":
      if (hasOrigin) {
        order("distance_km", "ASC", "NULLS LAST");
        break;
      }
      order("job.createdAt", "DESC");
      break;
    default:
      order("job.createdAt", "DESC");
  }
  qb.addOrderBy("job.id", "ASC");

  const total = await qb.clone().orderBy().getCount();
  const { entities, raw } = await qb
    .offset((pageNum - 1) * limitNum)
    .limit(limitNum)
    .getRawAndEntities();

  const access = role === UserRole.TRADESPERSON && !mine ? "listing" : "private";
  const jobs = entities.map((j, i) => {
    let distanceKm: number | null = null;
    if (hasOrigin) {
      const rawDist = raw[i]?.distance_km;
      distanceKm = rawDist == null ? null : Math.round(Number(rawDist) * 10) / 10;
    }
    return { ...toJob(j, access), distanceKm };
  });

  const payload = {
    jobs,
    pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.max(1, Math.ceil(total / limitNum)) },
    cached: false,
  };
  if (cacheKey) await cacheSetJson(cacheKey, payload, 60);
  return res.json(payload);
}

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function createJob(req: Request, res: Response) {
  const b = req.valid.body;
  let stored: string[] = [];
  const job = await AppDataSource.transaction(async (m) => {
    const created = await m.save(
      m.create(Job, {
        title: b.title,
        description: b.description,
        category: b.category,
        siteType: b.siteType ?? null,
        cadence: b.cadence,
        cadenceNote: b.cadenceNote ?? null,
        preferredStart: b.preferredStart,
        preferredEnd: b.preferredEnd,
        maxBids: b.maxBids,
        budgetMin: b.budgetMin,
        budgetMax: b.budgetMax,
        address: b.address || undefined,
        area: b.area || undefined,
        city: b.city || undefined,
        pincode: b.pincode || undefined,
        lat: b.lat,
        lng: b.lng,
        photoUrls: [],
        status: JobStatus.OPEN,
        homeownerId: req.user!.id,
      })
    );
    const uploads = await storeUploads(
      filesOf(req, "photos"),
      { kind: UploadKind.JOB_PHOTO, ownerUserId: req.user!.id, jobId: created.id, allowPdf: true },
      m
    );
    stored = uploads.map((u) => fileRef(u.name));
    if (uploads.length) {
      created.photoUrls = stored;
      await m.update(Job, { id: created.id }, { photoUrls: created.photoUrls });
    }
    return created;
  }).catch(async (err) => {
    await discardFiles(stored);
    throw err;
  });

  await invalidateOpenJobsCache();
  try {
    await notifyHomeownerMatchHints(job);
  } catch (err) {
    logger.warn({ err }, "match hints failed");
  }
  return res.status(201).json({ job: toJob(job, "private") });
}

export async function getJob(req: Request, res: Response) {
  const ctx = await loadJobContext(req.valid.params.id);
  const access = await assertJobAccess(ctx, viewer(req));
  return res.json({ job: toJob(ctx.job, access === "private" ? "private" : "listing"), access });
}

export async function updateJob(req: Request, res: Response) {
  const ctx = await loadJobContext(req.valid.params.id);
  assertOwner(ctx, viewer(req));
  const job = ctx.job;
  if (job.status !== JobStatus.OPEN) throw conflict("Only open jobs can be edited", "JOB_NOT_OPEN");

  const b = req.valid.body;
  const patch: Partial<Job> = {};
  const editable = [
    "title", "description", "category", "siteType", "cadence", "cadenceNote", "preferredStart",
    "preferredEnd", "maxBids", "budgetMin", "budgetMax", "address", "area", "city", "pincode", "lat", "lng",
  ] as const;
  for (const key of editable) {
    if (b[key] !== undefined) (patch as Record<string, unknown>)[key] = b[key];
  }
  const nextMin = patch.budgetMin !== undefined ? patch.budgetMin : job.budgetMin;
  const nextMax = patch.budgetMax !== undefined ? patch.budgetMax : job.budgetMax;
  if (nextMin != null && nextMax != null && Number(nextMin) > Number(nextMax)) {
    throw badRequest("Minimum budget can't be above the maximum", "VALIDATION");
  }

  const removed: string[] = (b.removePhotoUrls || []).filter((r: string) => job.photoUrls.includes(r));
  const remaining = job.photoUrls.filter((u) => !removed.includes(u));
  const incoming = filesOf(req, "photos");
  if (remaining.length + incoming.length > 10) throw badRequest("A job can have at most 10 photos", "TOO_MANY_FILES");

  let stored: string[] = [];
  try {
    await AppDataSource.transaction(async (m) => {
      const uploads = await storeUploads(
        incoming,
        { kind: UploadKind.JOB_PHOTO, ownerUserId: req.user!.id, jobId: job.id, allowPdf: true },
        m
      );
      stored = uploads.map((u) => fileRef(u.name));
      patch.photoUrls = [...remaining, ...stored];
      const rows = await m
        .createQueryBuilder()
        .update(Job)
        .set(patch)
        .where(`"id" = :id AND "status" = :open`, { id: job.id, open: JobStatus.OPEN })
        .execute();
      if (!rows.affected) throw conflict("Only open jobs can be edited", "JOB_NOT_OPEN");
    });
  } catch (err) {
    await discardFiles(stored);
    throw err;
  }
  for (const ref of removed) await deleteUploadByRef(ref);
  await invalidateOpenJobsCache();
  const fresh = await jobRepo().findOneOrFail({ where: { id: job.id } });
  return res.json({ job: toJob(fresh, "private") });
}

/** Client cancels an open job; active bids are closed and bidders told. */
export async function cancelJob(req: Request, res: Response) {
  const ctx = await loadJobContext(req.valid.params.id);
  assertOwner(ctx, viewer(req));
  const bidders = await AppDataSource.transaction(async (m) => {
    await transitionJob(m, ctx.job.id, "cancel");
    const active = await m.find(Bid, { where: { jobId: ctx.job.id, status: BidStatus.ACTIVE } });
    if (active.length) {
      await m.update(Bid, { id: In(active.map((b) => b.id)) }, { status: BidStatus.REJECTED });
    }
    return active.map((b) => b.tradespersonId);
  });
  await createNotifications(
    bidders.map((userId) => ({
      userId,
      type: NotificationType.BID_REJECTED,
      title: "Job cancelled",
      body: `The client cancelled "${ctx.job.title}". Your bid was closed.`,
      link: "/professional",
      meta: { jobId: ctx.job.id, jobCancelled: true },
    }))
  );
  await invalidateOpenJobsCache();
  await revokeThreadStreams(ctx.job.id, null);
  const fresh = await jobRepo().findOneOrFail({ where: { id: ctx.job.id } });
  return res.json({ job: toJob(fresh, "private") });
}

export async function setPhotoConsent(req: Request, res: Response) {
  const ctx = await loadJobContext(req.valid.params.id);
  assertOwner(ctx, viewer(req));
  await jobRepo().update({ id: ctx.job.id }, { photoConsent: req.valid.body.consent });
  const fresh = await jobRepo().findOneOrFail({ where: { id: ctx.job.id } });
  return res.json({ job: toJob(fresh, "private") });
}
