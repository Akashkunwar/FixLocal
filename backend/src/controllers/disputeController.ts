import type { NextFunction, Request, Response } from "express";
import { AppDataSource } from "../data-source";
import { Dispute, DisputeResolution, DisputeStatus } from "../entities/Dispute";
import { Job, JobStatus } from "../entities/Job";
import { User, UserRole } from "../entities/User";
import { NotificationType } from "../entities/Notification";
import { UploadKind } from "../entities/Upload";
import { AuditAction, writeAudit } from "../utils/audit";
import { createNotifications } from "../utils/notifications";
import { toDispute, toJob } from "../serializers";
import { assertPrivateAccess, isAwardedPro, isOwner, loadJobContext, type JobContext } from "../policies/jobPolicy";
import { restoreJobStatus, transitionJob } from "../domain/jobStateMachine";
import { refundMilestones, releaseRemaining } from "../domain/escrow";
import { viewer } from "./jobController";
import { filesOf } from "../middleware/upload";
import { discardFiles, fileRef, storeUploads } from "../services/files";
import { badRequest, conflict, forbidden, notFound } from "../http/errors";

export const DISPUTE_WINDOW_DAYS = 14;

function assertCanDispute(ctx: JobContext, req: Request) {
  const v = viewer(req);
  if (!isOwner(ctx, v) && !isAwardedPro(ctx, v)) {
    throw forbidden("Only the client or the hired professional can open a dispute");
  }
  const s = ctx.job.status;
  if (s === JobStatus.DISPUTED) throw conflict("An open dispute already exists for this job", "DISPUTE_OPEN");
  if (![JobStatus.AWARDED, JobStatus.IN_PROGRESS, JobStatus.PENDING_CONFIRMATION, JobStatus.COMPLETED].includes(s)) {
    throw conflict("Disputes can only be opened on awarded, in-progress or completed jobs", "INVALID_STATUS");
  }
  if (s === JobStatus.COMPLETED && ctx.job.completedAt) {
    const age = Date.now() - new Date(ctx.job.completedAt).getTime();
    if (age > DISPUTE_WINDOW_DAYS * 86400_000) {
      throw conflict(`Disputes must be opened within ${DISPUTE_WINDOW_DAYS} days of completion`, "DISPUTE_WINDOW_CLOSED");
    }
  }
}

/** Runs before multer: nobody else can write evidence files. */
export async function authorizeDispute(req: Request, _res: Response, next: NextFunction) {
  assertCanDispute(await loadJobContext(req.valid.params.id), req);
  next();
}

export async function createDispute(req: Request, res: Response) {
  const jobId: string = req.valid.params.id ?? req.valid.body.jobId;
  const ctx = await loadJobContext(jobId);
  assertCanDispute(ctx, req);
  const files = filesOf(req, "evidence");
  let stored: string[] = [];
  const dispute = await AppDataSource.transaction(async (m) => {
    const previous = await transitionJob(m, jobId, "dispute");
    const uploads = await storeUploads(files, { kind: UploadKind.EVIDENCE, ownerUserId: req.user!.id, jobId, allowPdf: true }, m);
    stored = uploads.map((u) => fileRef(u.name));
    return m.save(
      m.create(Dispute, {
        jobId,
        raisedByUserId: req.user!.id,
        reason: req.valid.body.reason,
        evidenceUrls: stored,
        previousJobStatus: previous,
        status: DisputeStatus.OPEN,
      })
    );
  }).catch(async (err) => {
    await discardFiles(stored);
    throw err;
  });

  const admins = await AppDataSource.getRepository(User).find({ where: { role: UserRole.ADMIN }, select: { id: true } });
  const others = [ctx.job.homeownerId, ctx.acceptedProId].filter((id): id is string => !!id && id !== req.user!.id);
  await createNotifications([
    ...admins.map((a) => ({
      userId: a.id,
      type: NotificationType.DISPUTE,
      title: "New dispute opened",
      body: `Dispute on "${ctx.job.title}"${stored.length ? ` · ${stored.length} evidence file(s)` : ""}`,
      link: "/admin/disputes",
      meta: { jobId, disputeId: dispute.id },
    })),
    ...others.map((userId) => ({
      userId,
      type: NotificationType.DISPUTE,
      title: "Dispute opened on your job",
      body: `A dispute was opened on "${ctx.job.title}". An admin will review it.`,
      link: userId === ctx.job.homeownerId ? `/client/jobs/${jobId}` : `/professional/jobs/${jobId}`,
      meta: { jobId, disputeId: dispute.id },
    })),
  ]);
  const job = await AppDataSource.getRepository(Job).findOneOrFail({ where: { id: jobId } });
  return res.status(201).json({ dispute: toDispute(dispute), job: toJob(job, "private") });
}

export async function listDisputes(req: Request, res: Response) {
  const { role, id: userId } = req.user!;
  const q = req.valid.query;
  const qb = AppDataSource.getRepository(Dispute)
    .createQueryBuilder("d")
    .leftJoinAndSelect("d.job", "job")
    .leftJoinAndSelect("d.raisedBy", "raisedBy")
    .orderBy("d.createdAt", "DESC")
    .take(q.limit ?? 50)
    .skip(((q.page ?? 1) - 1) * (q.limit ?? 50));
  if (role !== UserRole.ADMIN) {
    qb.leftJoin("bids", "accepted", `accepted."id" = job."acceptedBidId"`).andWhere(
      `(job."homeownerId" = :userId OR accepted."tradespersonId" = :userId)`,
      { userId }
    );
  }
  if (q.status) qb.andWhere("d.status = :status", { status: q.status });
  if (q.jobId) qb.andWhere("d.jobId = :jobId", { jobId: q.jobId });
  const disputes = await qb.getMany();
  return res.json({ disputes: disputes.map(toDispute) });
}

/**
 * Resolve a dispute. Each outcome maps to a specific money movement:
 * - favor_homeowner: job cancelled, everything not yet released is refunded
 * - favor_tradesperson: job completed, everything left is released
 * - no_action: job returns to where it was; money untouched
 * `refundMilestoneIds` refunds specific unreleased milestones first (partial outcomes).
 */
export async function resolveDispute(req: Request, res: Response) {
  const { resolution, resolutionNotes, refundMilestoneIds, jobStatus } = req.valid.body;
  const disputeId = req.valid.params.id;
  const existing = await AppDataSource.getRepository(Dispute).findOne({ where: { id: disputeId } });
  if (!existing) throw notFound("Dispute not found");
  const ctx = await loadJobContext(existing.jobId);
  assertPrivateAccess(ctx, viewer(req));

  const outcome =
    jobStatus ??
    (resolution === DisputeResolution.FAVOR_HOMEOWNER
      ? "cancelled"
      : resolution === DisputeResolution.FAVOR_TRADESPERSON
        ? "completed"
        : "restore");

  const result = await AppDataSource.transaction(async (m) => {
    const claimed = await m.update(
      Dispute,
      { id: disputeId, status: DisputeStatus.OPEN },
      { status: DisputeStatus.RESOLVED, resolution, resolutionNotes: resolutionNotes || undefined, resolvedAt: new Date() }
    );
    if (!claimed.affected) throw conflict("This dispute is already resolved", "ALREADY_RESOLVED");
    const job = await m.findOneOrFail(Job, { where: { id: ctx.job.id } });
    const note = resolutionNotes || `Dispute ${disputeId} resolution`;
    let refunded: Awaited<ReturnType<typeof refundMilestones>> | null = null;
    if (refundMilestoneIds?.length) {
      refunded = await refundMilestones(m, job, refundMilestoneIds, req.user!.id, note);
    }
    let released: Awaited<ReturnType<typeof releaseRemaining>> | null = null;
    let finalStatus: JobStatus;
    if (outcome === "cancelled") {
      await transitionJob(m, job.id, "resolve_cancel");
      const all = await refundMilestones(m, job, "all_unreleased", req.user!.id, note);
      refunded = refunded
        ? { ...all, refunded: [...refunded.refunded, ...all.refunded], totalRefunded: refunded.totalRefunded + all.totalRefunded }
        : all;
      finalStatus = JobStatus.CANCELLED;
    } else if (outcome === "completed") {
      await transitionJob(m, job.id, "resolve_complete", { completedAt: job.completedAt ?? new Date() });
      released = await releaseRemaining(m, job, req.user!.id);
      finalStatus = JobStatus.COMPLETED;
    } else {
      const previous = (existing.previousJobStatus as JobStatus) || JobStatus.IN_PROGRESS;
      finalStatus = await restoreJobStatus(m, job.id, previous);
    }
    const refundMeta = {
      milestoneIds: refunded?.refunded.map((x) => x.id) ?? [],
      totalRefunded: Math.round((refunded?.totalRefunded ?? 0) * 100) / 100,
      labels: refunded?.refunded.map((x) => x.label) ?? [],
      notRefundable: refunded?.notRefundable ?? [],
      releasedMilestoneIds: released?.released.map((x) => x.id) ?? [],
      totalReleased: Math.round((released?.released.reduce((s, x) => s + Number(x.amount), 0) ?? 0) * 100) / 100,
    };
    await m.update(Dispute, { id: disputeId }, { refundMeta });
    await writeAudit(
      {
        actorUserId: req.user!.id,
        actorEmail: req.user!.email,
        action: AuditAction.DISPUTE_RESOLVE,
        targetType: "job",
        targetId: job.id,
        summary: `Resolved dispute on "${job.title}": ${resolution} → job ${finalStatus}`,
        meta: { disputeId, resolution, outcome, jobStatus: finalStatus, note: resolutionNotes || null, refundMeta },
      },
      m
    );
    return { finalStatus, refundMeta };
  });

  const recipients = new Set([existing.raisedByUserId, ctx.job.homeownerId, ctx.acceptedProId].filter(Boolean) as string[]);
  const money = [
    result.refundMeta.totalRefunded ? `₹${result.refundMeta.totalRefunded.toFixed(0)} refunded to the client` : null,
    result.refundMeta.totalReleased ? `₹${result.refundMeta.totalReleased.toFixed(0)} released to the professional` : null,
  ].filter(Boolean);
  await createNotifications(
    [...recipients].map((userId) => ({
      userId,
      type: NotificationType.DISPUTE,
      title: "Dispute resolved",
      body: `Dispute on "${ctx.job.title}" resolved: ${String(resolution).replace(/_/g, " ")}${money.length ? ` · ${money.join(" · ")} (simulated)` : ""}`,
      link: userId === ctx.job.homeownerId ? `/client/jobs/${ctx.job.id}` : `/professional/jobs/${ctx.job.id}`,
      meta: { jobId: ctx.job.id, disputeId, resolution },
    }))
  );
  const dispute = await AppDataSource.getRepository(Dispute).findOneOrFail({ where: { id: disputeId }, relations: ["job", "raisedBy"] });
  const job = await AppDataSource.getRepository(Job).findOneOrFail({ where: { id: ctx.job.id } });
  return res.json({ dispute: toDispute(dispute), job: toJob(job, "private") });
}

export function rejectLegacyMultipart(req: Request, _res: Response, next: NextFunction) {
  if (String(req.headers["content-type"] || "").includes("multipart/form-data")) {
    return next(badRequest("Send evidence files to POST /api/jobs/:id/disputes", "USE_JOB_DISPUTE_ROUTE"));
  }
  next();
}
