import type { NextFunction, Request, Response } from "express";
import { AppDataSource } from "../data-source";
import { Job, JobStatus } from "../entities/Job";
import { Upload, UploadKind } from "../entities/Upload";
import { UserRole } from "../entities/User";
import { toJob } from "../serializers";
import { assertPrivateAccess, loadJobContext } from "../policies/jobPolicy";
import { viewer } from "./jobController";
import { filesOf } from "../middleware/upload";
import { deleteUploadByRef, discardFiles, fileRef, nameFromRef, storeUploads } from "../services/files";
import { badRequest, conflict, forbidden } from "../http/errors";

const EDITABLE: JobStatus[] = [
  JobStatus.AWARDED,
  JobStatus.IN_PROGRESS,
  JobStatus.PENDING_CONFIRMATION,
  JobStatus.COMPLETED,
  JobStatus.DISPUTED,
];
const MAX_PER_SIDE = 8;

/** Runs before multer so nothing is written for people who can't upload here. */
export async function authorizeCompletionUpload(req: Request, _res: Response, next: NextFunction) {
  const ctx = await loadJobContext(req.valid.params.id);
  assertPrivateAccess(ctx, viewer(req));
  if (!EDITABLE.includes(ctx.job.status)) {
    throw conflict("Completion photos can only be added once the job is awarded", "INVALID_STATUS");
  }
  next();
}

export async function uploadCompletionPhotos(req: Request, res: Response) {
  const before = filesOf(req, "before");
  const after = filesOf(req, "after");
  if (!before.length && !after.length) {
    throw badRequest("Attach at least one before or after image (fields: before, after)", "NO_FILES");
  }
  const jobId = req.valid.params.id;
  let stored: string[] = [];
  const result = await AppDataSource.transaction(async (m) => {
    const current = await m.query(
      `SELECT "beforePhotoUrls", "afterPhotoUrls", "status" FROM "jobs" WHERE "id" = $1 FOR UPDATE`,
      [jobId]
    );
    const job = current[0] as { beforePhotoUrls: string[]; afterPhotoUrls: string[]; status: JobStatus };
    if (!EDITABLE.includes(job.status)) throw conflict("This job no longer accepts photos", "INVALID_STATUS");
    if (job.beforePhotoUrls.length + before.length > MAX_PER_SIDE || job.afterPhotoUrls.length + after.length > MAX_PER_SIDE) {
      throw badRequest(`Each side can have at most ${MAX_PER_SIDE} photos`, "TOO_MANY_FILES");
    }
    const ctx = { kind: UploadKind.COMPLETION, ownerUserId: req.user!.id, jobId };
    const b = (await storeUploads(before, ctx, m)).map((u) => fileRef(u.name));
    stored = [...b];
    const a = (await storeUploads(after, ctx, m)).map((u) => fileRef(u.name));
    stored.push(...a);
    await m.update(Job, { id: jobId }, {
      beforePhotoUrls: [...job.beforePhotoUrls, ...b],
      afterPhotoUrls: [...job.afterPhotoUrls, ...a],
    });
    return { before: b, after: a };
  }).catch(async (err) => {
    await discardFiles(stored);
    throw err;
  });
  const job = await AppDataSource.getRepository(Job).findOneOrFail({ where: { id: jobId } });
  return res.json({ job: toJob(job, "private"), added: result });
}

/** Photos are evidence: they can't be removed during a dispute, and only by whoever uploaded them. */
export async function removeCompletionPhoto(req: Request, res: Response) {
  const ctx = await loadJobContext(req.valid.params.id);
  assertPrivateAccess(ctx, viewer(req));
  const { url, kind } = req.valid.body;
  if (ctx.job.status === JobStatus.DISPUTED) {
    throw conflict("Photos can't be removed while the job is in dispute", "EVIDENCE_LOCKED");
  }
  const list = kind === "before" ? ctx.job.beforePhotoUrls : ctx.job.afterPhotoUrls;
  if (!list.includes(url)) throw badRequest("That photo isn't on this job", "NOT_ON_JOB");
  const upload = await AppDataSource.getRepository(Upload).findOne({ where: { name: nameFromRef(url)! } });
  if (upload && upload.ownerUserId !== req.user!.id && req.user!.role !== UserRole.ADMIN) {
    throw forbidden("Only the person who uploaded a photo can remove it", "NOT_UPLOADER");
  }
  const next = list.filter((u) => u !== url);
  await AppDataSource.getRepository(Job).update(
    { id: ctx.job.id },
    kind === "before" ? { beforePhotoUrls: next } : { afterPhotoUrls: next }
  );
  await deleteUploadByRef(url);
  const job = await AppDataSource.getRepository(Job).findOneOrFail({ where: { id: ctx.job.id } });
  return res.json({ job: toJob(job, "private") });
}
