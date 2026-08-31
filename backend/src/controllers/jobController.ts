import { Request, Response } from "express";
import { AppDataSource } from "../data-source";
import { Job, JobCategory, JobStatus } from "../entities/Job";
import { UserRole } from "../entities/User";
import {
  cacheGetJson,
  cacheSetJson,
  invalidateOpenJobsCache,
  openJobsCacheKey,
} from "../utils/cache";

const jobRepo = () => AppDataSource.getRepository(Job);

const CATEGORIES = Object.values(JobCategory);

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
    status,
    from,
    to,
    dateField = "created",
    page = "1",
    limit = "10",
    sort = "newest",
    scope,
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

  switch (String(sort)) {
    case "budget_desc":
      qb.orderBy("job.budgetMax", "DESC", "NULLS LAST");
      break;
    case "budget_asc":
      qb.orderBy("job.budgetMax", "ASC", "NULLS LAST");
      break;
    case "preferred_date":
      qb.orderBy("job.preferredStart", "ASC", "NULLS LAST");
      break;
    case "newest":
    default:
      qb.orderBy("job.createdAt", "DESC");
      break;
  }

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

  const [jobs, total] = await qb.skip(skip).take(limitNum).getManyAndCount();

  const payload = {
    jobs,
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
    preferredStart,
    preferredEnd,
    maxBids,
    budgetMin,
    budgetMax,
    address,
    area,
    pincode,
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

  const job = jobRepo().create({
    title: String(title).trim(),
    description: String(description).trim(),
    category,
    preferredStart: preferredStart ? new Date(preferredStart) : undefined,
    preferredEnd: preferredEnd ? new Date(preferredEnd) : undefined,
    maxBids: parseOptionalNumber(maxBids) ?? 5,
    budgetMin: parseOptionalNumber(budgetMin),
    budgetMax: parseOptionalNumber(budgetMax),
    address: address ? String(address) : undefined,
    area: area ? String(area) : undefined,
    pincode: pincode ? String(pincode) : undefined,
    photoUrls: photoPaths(req.files as Express.Multer.File[] | undefined),
    status: JobStatus.OPEN,
    homeownerId: req.user!.id,
  });

  await jobRepo().save(job);
  await invalidateOpenJobsCache();
  return res.status(201).json({ job });
}

export async function getJob(req: Request, res: Response) {
  const job = await jobRepo().findOne({ where: { id: req.params.id } });
  if (!job) {
    return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });
  }

  const { role, id: userId } = req.user!;
  const isOwner = job.homeownerId === userId;
  const isAdmin = role === UserRole.ADMIN;

  // Owners and admin always; others only while open (browse later)
  if (!isOwner && !isAdmin && job.status !== JobStatus.OPEN) {
    return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
  }
  if (!isOwner && !isAdmin && role === UserRole.HOMEOWNER) {
    return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
  }

  return res.json({ job });
}

export async function updateJob(req: Request, res: Response) {
  const job = await findOwnedJob(req.params.id, req.user!.id);
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
  if (body.pincode !== undefined) job.pincode = body.pincode ? String(body.pincode) : undefined;

  const newPhotos = photoPaths(req.files as Express.Multer.File[] | undefined);
  if (newPhotos.length) {
    job.photoUrls = [...(job.photoUrls || []), ...newPhotos];
  }

  await jobRepo().save(job);
  return res.json({ job });
}

export async function cancelJob(req: Request, res: Response) {
  const job = await findOwnedJob(req.params.id, req.user!.id);
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
