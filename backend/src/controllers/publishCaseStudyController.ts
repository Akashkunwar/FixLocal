import type { Request, Response } from "express";
import { AppDataSource } from "../data-source";
import { JobStatus } from "../entities/Job";
import { TradespersonProfile } from "../entities/TradespersonProfile";
import { UploadKind } from "../entities/Upload";
import { assertAwardedProOrAdmin, loadJobContext } from "../policies/jobPolicy";
import { viewer } from "./jobController";
import { copyUploadAs, deleteUploadByRef } from "../services/files";
import { badRequest, conflict, forbidden } from "../http/errors";
import { toProfile } from "../serializers";

/**
 * Publish a completed job's photos to the pro's public portfolio.
 * Needs the client's consent; photos are copied so the job's private files stay private.
 */
export async function publishCaseStudyFromJob(req: Request, res: Response) {
  const ctx = await loadJobContext(req.valid.params.id);
  assertAwardedProOrAdmin(ctx, viewer(req), "Only the hired professional can publish a case study from this job");
  const job = ctx.job;
  if (job.status !== JobStatus.COMPLETED) {
    throw conflict("Case studies can only be published from completed jobs", "INVALID_STATUS");
  }
  if (!job.photoConsent) {
    throw forbidden("The client hasn't allowed these photos to be published", "PHOTO_CONSENT_REQUIRED");
  }
  if (!ctx.acceptedProId) throw badRequest("Job has no hired professional", "NO_AWARDED_PRO");
  const before = job.beforePhotoUrls || [];
  const after = job.afterPhotoUrls || [];
  if (!before.length && !after.length) {
    throw badRequest("Add at least one before or after completion photo first", "NO_PHOTOS");
  }
  const b = req.valid.body;
  const pick = (wanted: string | undefined, pool: string[]) => (wanted && pool.includes(wanted) ? wanted : pool[0]);
  const proId = ctx.acceptedProId;

  const repo = AppDataSource.getRepository(TradespersonProfile);
  const profile = (await repo.findOne({ where: { userId: proId }, relations: ["user"] })) ||
    (await repo.save(repo.create({ userId: proId, galleryUrls: [], caseStudies: [] })));
  const existing = Array.isArray(profile.caseStudies) ? profile.caseStudies : [];
  const caseId = b.id || `case-job-${job.id.slice(0, 8)}`;
  const replaced = existing.filter((c) => c.id === caseId || (c as { sourceJobId?: string }).sourceJobId === job.id);
  if (!replaced.length && existing.length >= 12) {
    throw badRequest("A portfolio can have at most 12 case studies; remove one first", "TOO_MANY_CASE_STUDIES");
  }

  const beforeSrc = pick(b.beforeUrl, before);
  const afterSrc = pick(b.afterUrl, after);
  const beforeUrl = beforeSrc ? await copyUploadAs(beforeSrc, UploadKind.CASE_STUDY, proId) : null;
  const afterUrl = afterSrc ? await copyUploadAs(afterSrc, UploadKind.CASE_STUDY, proId) : null;

  const study = {
    id: caseId,
    title: b.title || job.title.slice(0, 120) || "Completed job",
    ...(b.notes ? { notes: b.notes } : {}),
    beforeUrl,
    afterUrl,
    category: job.category,
    sourceJobId: job.id,
  };
  profile.caseStudies = [...existing.filter((c) => !replaced.includes(c)), study];
  await repo.save(profile);
  for (const old of replaced) {
    for (const ref of [old.beforeUrl, old.afterUrl]) if (ref) await deleteUploadByRef(ref);
  }
  const serialized = toProfile(profile, profile.user, "public");
  return res.json({
    caseStudy: serialized.caseStudies.find((c) => c.id === caseId),
    profile: { id: profile.id, caseStudies: serialized.caseStudies },
    message: "Case study published to your portfolio",
  });
}
