import { Request, Response } from "express";
import { param } from "../utils/params";
import { AppDataSource } from "../data-source";
import { Bid } from "../entities/Bid";
import { Job, JobStatus } from "../entities/Job";
import { UserRole } from "../entities/User";

const jobRepo = () => AppDataSource.getRepository(Job);
const bidRepo = () => AppDataSource.getRepository(Bid);

async function canEditCompletionPhotos(job: Job, userId: string, role: UserRole) {
  if (role === UserRole.ADMIN) return true;
  if (job.homeownerId === userId) return true;
  if (job.acceptedBidId) {
    const accepted = await bidRepo().findOne({ where: { id: job.acceptedBidId } });
    if (accepted && accepted.tradespersonId === userId) return true;
  }
  return false;
}

const EDITABLE = [
  JobStatus.AWARDED,
  JobStatus.IN_PROGRESS,
  JobStatus.COMPLETED,
  JobStatus.DISPUTED,
];

export async function uploadCompletionPhotos(req: Request, res: Response) {
  const job = await jobRepo().findOne({ where: { id: param(req, "id") } });
  if (!job) {
    return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });
  }
  if (!(await canEditCompletionPhotos(job, req.user!.id, req.user!.role))) {
    return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
  }
  if (!EDITABLE.includes(job.status)) {
    return res.status(400).json({
      message: "Completion photos can only be added on awarded, in-progress, completed, or disputed jobs",
      code: "INVALID_STATUS",
    });
  }

  const files = req.files as
    | { [fieldname: string]: Express.Multer.File[] }
    | undefined;

  const beforeFiles = files?.before || [];
  const afterFiles = files?.after || [];

  const beforeUrls = beforeFiles.map((f) => `/uploads/${f.filename}`);
  const afterUrls = afterFiles.map((f) => `/uploads/${f.filename}`);

  if (!beforeUrls.length && !afterUrls.length) {
    return res.status(400).json({
      message: "Attach at least one before or after image (fields: before, after)",
      code: "NO_FILES",
    });
  }

  job.beforePhotoUrls = [...(job.beforePhotoUrls || []), ...beforeUrls].slice(0, 8);
  job.afterPhotoUrls = [...(job.afterPhotoUrls || []), ...afterUrls].slice(0, 8);
  await jobRepo().save(job);

  return res.json({
    job,
    added: { before: beforeUrls, after: afterUrls },
  });
}

/** Remove a single completion photo by URL + kind. */
export async function removeCompletionPhoto(req: Request, res: Response) {
  const job = await jobRepo().findOne({ where: { id: param(req, "id") } });
  if (!job) {
    return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });
  }
  if (!(await canEditCompletionPhotos(job, req.user!.id, req.user!.role))) {
    return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
  }

  const url = String(req.body?.url || "").trim();
  const kind = String(req.body?.kind || "").toLowerCase();
  if (!url || (kind !== "before" && kind !== "after")) {
    return res.status(400).json({ message: "url and kind (before|after) are required" });
  }

  if (kind === "before") {
    job.beforePhotoUrls = (job.beforePhotoUrls || []).filter((u) => u !== url);
  } else {
    job.afterPhotoUrls = (job.afterPhotoUrls || []).filter((u) => u !== url);
  }
  await jobRepo().save(job);
  return res.json({ job });
}
