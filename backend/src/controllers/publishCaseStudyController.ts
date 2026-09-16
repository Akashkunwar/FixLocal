import { Request, Response } from "express";
import { param } from "../utils/params";
import { AppDataSource } from "../data-source";
import { Bid } from "../entities/Bid";
import { Job, JobStatus } from "../entities/Job";
import { TradespersonProfile } from "../entities/TradespersonProfile";
import { UserRole } from "../entities/User";

const jobRepo = () => AppDataSource.getRepository(Job);
const bidRepo = () => AppDataSource.getRepository(Bid);
const profileRepo = () => AppDataSource.getRepository(TradespersonProfile);

const PUBLISHABLE = [
  JobStatus.AWARDED,
  JobStatus.IN_PROGRESS,
  JobStatus.COMPLETED,
  JobStatus.DISPUTED,
];

/**
 * One-click: publish a past-work case study from this job's before/after photos
 * onto the awarded professional's portfolio.
 */
export async function publishCaseStudyFromJob(req: Request, res: Response) {
  const job = await jobRepo().findOne({ where: { id: param(req, "id") } });
  if (!job) {
    return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });
  }
  if (!PUBLISHABLE.includes(job.status)) {
    return res.status(400).json({
      message: "Case studies can be published from awarded, in-progress, completed, or disputed jobs",
      code: "INVALID_STATUS",
    });
  }

  if (!job.acceptedBidId) {
    return res.status(400).json({
      message: "Job has no awarded professional",
      code: "NO_AWARDED_PRO",
    });
  }

  const accepted = await bidRepo().findOne({ where: { id: job.acceptedBidId } });
  if (!accepted) {
    return res.status(400).json({
      message: "Accepted bid not found",
      code: "NO_AWARDED_PRO",
    });
  }

  const isPro = accepted.tradespersonId === req.user!.id;
  const isAdmin = req.user!.role === UserRole.ADMIN;
  if (!isPro && !isAdmin) {
    return res.status(403).json({
      message: "Only the awarded professional can publish a case study from this job",
      code: "FORBIDDEN",
    });
  }

  const before = job.beforePhotoUrls || [];
  const after = job.afterPhotoUrls || [];
  if (before.length === 0 && after.length === 0) {
    return res.status(400).json({
      message: "Add at least one before or after completion photo first",
      code: "NO_PHOTOS",
    });
  }

  const body = req.body ?? {};
  const title =
    String(body.title || "").trim().slice(0, 120) ||
    `${job.title}`.slice(0, 120) ||
    "Completed job";
  const notes =
    body.notes != null && String(body.notes).trim()
      ? String(body.notes).trim().slice(0, 800)
      : undefined;

  // Prefer explicit URLs when they belong to this job; else first of each gallery.
  const pickUrl = (raw: unknown, pool: string[]) => {
    const s = raw != null ? String(raw).trim() : "";
    if (s && pool.includes(s)) return s.slice(0, 500);
    return pool[0] ? pool[0].slice(0, 500) : undefined;
  };
  const beforeUrl = pickUrl(body.beforeUrl, before);
  const afterUrl = pickUrl(body.afterUrl, after);

  let profile = await profileRepo().findOne({
    where: { userId: accepted.tradespersonId },
  });
  if (!profile) {
    profile = await profileRepo().save(
      profileRepo().create({
        userId: accepted.tradespersonId,
        galleryUrls: [],
        caseStudies: [],
      })
    );
  }

  const existing = Array.isArray(profile.caseStudies) ? [...profile.caseStudies] : [];
  const caseId =
    String(body.id || "").trim().slice(0, 64) ||
    `case-job-${job.id.slice(0, 8)}-${Date.now().toString(36)}`;

  // Replace prior study from this job (or same id) — soft idempotent re-publish
  const filtered = existing.filter(
    (c) => c.id !== caseId && String((c as any).sourceJobId || "") !== job.id
  );

  const study: {
    id: string;
    title: string;
    notes?: string;
    beforeUrl?: string | null;
    afterUrl?: string | null;
    category?: string | null;
    sourceJobId?: string;
  } = {
    id: caseId,
    title,
    ...(notes ? { notes } : {}),
    ...(beforeUrl ? { beforeUrl } : {}),
    ...(afterUrl ? { afterUrl } : {}),
    category: String(job.category || "").slice(0, 40) || undefined,
    sourceJobId: job.id,
  };

  // Keep max 12 like profile normalize
  profile.caseStudies = [...filtered, study].slice(-12) as any;
  await profileRepo().save(profile);

  return res.json({
    caseStudy: study,
    profile: {
      id: profile.id,
      caseStudies: profile.caseStudies,
    },
    message: "Case study published to portfolio",
  });
}
