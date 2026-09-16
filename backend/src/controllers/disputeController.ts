import { Request, Response } from "express";
import { param } from "../utils/params";
import { AppDataSource } from "../data-source";
import { NotificationType } from "../entities/Notification";
import { createNotification } from "../utils/notifications";
import { writeAudit, AuditAction } from "../utils/audit";
import {
  Dispute,
  DisputeResolution,
  DisputeStatus,
} from "../entities/Dispute";
import { Bid } from "../entities/Bid";
import { Job, JobStatus, PaymentStatus } from "../entities/Job";
import { refundMilestonesForJob } from "./paymentController";
import { User, UserRole } from "../entities/User";

const disputeRepo = () => AppDataSource.getRepository(Dispute);
const jobRepo = () => AppDataSource.getRepository(Job);
const bidRepo = () => AppDataSource.getRepository(Bid);

const RESOLUTIONS = Object.values(DisputeResolution);

async function isPartyToJob(job: Job, userId: string): Promise<boolean> {
  if (job.homeownerId === userId) return true;
  if (!job.acceptedBidId) return false;
  const accepted = await bidRepo().findOne({ where: { id: job.acceptedBidId } });
  return !!accepted && accepted.tradespersonId === userId;
}

function serializeDispute(d: Dispute) {
  return {
    id: d.id,
    jobId: d.jobId,
    raisedByUserId: d.raisedByUserId,
    reason: d.reason,
    evidenceUrls: d.evidenceUrls || [],
    status: d.status,
    resolution: d.resolution,
    resolutionNotes: d.resolutionNotes,
    refundMeta: d.refundMeta || null,
    resolvedAt: d.resolvedAt,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    job: d.job
      ? {
          id: d.job.id,
          title: d.job.title,
          status: d.job.status,
          homeownerId: d.job.homeownerId,
          category: d.job.category,
        }
      : undefined,
    raisedBy: d.raisedBy
      ? {
          id: d.raisedBy.id,
          email: d.raisedBy.email,
          name: d.raisedBy.name,
          role: d.raisedBy.role,
        }
      : undefined,
  };
}

export async function createDispute(req: Request, res: Response) {
  const body = req.body ?? {};
  const jobId = body.jobId;
  const reason = body.reason;
  let evidenceUrls: string[] = [];

  if (Array.isArray(body.evidenceUrls)) {
    evidenceUrls = body.evidenceUrls.map(String);
  } else if (typeof body.evidenceUrls === "string" && body.evidenceUrls.trim()) {
    try {
      const parsed = JSON.parse(body.evidenceUrls);
      if (Array.isArray(parsed)) evidenceUrls = parsed.map(String);
    } catch {
      evidenceUrls = [body.evidenceUrls];
    }
  }

  const files = req.files as Express.Multer.File[] | undefined;
  if (files?.length) {
    evidenceUrls = [...evidenceUrls, ...files.map((f) => `/uploads/${f.filename}`)];
  }
  evidenceUrls = evidenceUrls.slice(0, 8);

  if (!jobId || !reason) {
    return res.status(400).json({ message: "jobId and reason are required" });
  }

  const job = await jobRepo().findOne({ where: { id: jobId } });
  if (!job) {
    return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });
  }

  const allowedStatuses = [
    JobStatus.AWARDED,
    JobStatus.IN_PROGRESS,
    JobStatus.COMPLETED,
    JobStatus.DISPUTED,
  ];
  if (!allowedStatuses.includes(job.status)) {
    return res.status(400).json({
      message: "Disputes can only be opened on awarded, in-progress, or completed jobs",
      code: "INVALID_STATUS",
    });
  }

  if (!(await isPartyToJob(job, req.user!.id))) {
    return res.status(403).json({
      message: "Only the homeowner or awarded tradesperson can open a dispute",
      code: "FORBIDDEN",
    });
  }

  const openExisting = await disputeRepo().findOne({
    where: { jobId: job.id, status: DisputeStatus.OPEN },
  });
  if (openExisting) {
    return res.status(409).json({
      message: "An open dispute already exists for this job",
      code: "DISPUTE_OPEN",
    });
  }

  const dispute = disputeRepo().create({
    jobId: job.id,
    raisedByUserId: req.user!.id,
    reason: String(reason).trim(),
    evidenceUrls,
    status: DisputeStatus.OPEN,
  });
  await disputeRepo().save(dispute);

  if (job.status !== JobStatus.DISPUTED) {
    job.status = JobStatus.DISPUTED;
    await jobRepo().save(job);
  }

  const admins = await AppDataSource.getRepository(User).find({ where: { role: UserRole.ADMIN } });
  for (const admin of admins) {
    await createNotification({
      userId: admin.id,
      type: NotificationType.DISPUTE,
      title: "New dispute opened",
      body: `Dispute on "${job.title}"${evidenceUrls.length ? ` · ${evidenceUrls.length} evidence file(s)` : ""}`,
      link: "/admin/disputes",
      meta: { jobId: job.id, disputeId: dispute.id },
    });
  }

  // Notify the other party
  const otherIds = new Set<string>();
  if (job.homeownerId !== req.user!.id) otherIds.add(job.homeownerId);
  if (job.acceptedBidId) {
    const accepted = await bidRepo().findOne({ where: { id: job.acceptedBidId } });
    if (accepted && accepted.tradespersonId !== req.user!.id) {
      otherIds.add(accepted.tradespersonId);
    }
  }
  for (const userId of otherIds) {
    await createNotification({
      userId,
      type: NotificationType.DISPUTE,
      title: "Dispute opened on your job",
      body: `A dispute was opened on "${job.title}"`,
      link:
        job.homeownerId === userId
          ? `/homeowner/jobs/${job.id}`
          : `/tradesperson/jobs/${job.id}`,
      meta: { jobId: job.id, disputeId: dispute.id },
    });
  }

  return res.status(201).json({ dispute: serializeDispute(dispute), job });
}

export async function listDisputes(req: Request, res: Response) {
  const { role, id: userId } = req.user!;
  const qb = disputeRepo()
    .createQueryBuilder("d")
    .leftJoinAndSelect("d.job", "job")
    .leftJoinAndSelect("d.raisedBy", "raisedBy")
    .orderBy("d.createdAt", "DESC");

  if (role !== UserRole.ADMIN) {
    const myAcceptedBids = await bidRepo().find({
      where: { tradespersonId: userId },
      select: ["id"],
    });
    const acceptedIds = myAcceptedBids.map((b) => b.id);

    if (acceptedIds.length) {
      qb.andWhere(
        "(d.raisedByUserId = :userId OR job.homeownerId = :userId OR job.acceptedBidId IN (:...acceptedIds))",
        { userId, acceptedIds }
      );
    } else {
      qb.andWhere("(d.raisedByUserId = :userId OR job.homeownerId = :userId)", {
        userId,
      });
    }
  }

  if (req.query.status) {
    qb.andWhere("d.status = :status", { status: String(req.query.status) });
  }

  const disputes = await qb.getMany();
  return res.json({ disputes: disputes.map(serializeDispute) });
}

export async function resolveDispute(req: Request, res: Response) {
  const dispute = await disputeRepo().findOne({
    where: { id: param(req, "id") },
    relations: ["job", "raisedBy"],
  });
  if (!dispute) {
    return res.status(404).json({ message: "Dispute not found", code: "NOT_FOUND" });
  }
  if (dispute.status !== DisputeStatus.OPEN) {
    return res.status(400).json({ message: "Dispute is already resolved", code: "ALREADY_RESOLVED" });
  }

  const { resolution, resolutionNotes, jobStatus, refundMilestoneIds } = req.body ?? {};
  if (!resolution || !RESOLUTIONS.includes(resolution)) {
    return res.status(400).json({
      message: `resolution must be one of: ${RESOLUTIONS.join(", ")}`,
      code: "INVALID_RESOLUTION",
    });
  }

  dispute.status = DisputeStatus.RESOLVED;
  dispute.resolution = resolution;
  dispute.resolutionNotes = resolutionNotes ? String(resolutionNotes).trim() : undefined;
  dispute.resolvedAt = new Date();

  const job = await jobRepo().findOne({ where: { id: dispute.jobId } });
  if (job) {
    if (jobStatus === JobStatus.CANCELLED || jobStatus === "cancelled") {
      job.status = JobStatus.CANCELLED;
    } else if (jobStatus === JobStatus.COMPLETED || jobStatus === "completed") {
      job.status = JobStatus.COMPLETED;
      if (!job.completedAt) job.completedAt = new Date();
    } else if (jobStatus === JobStatus.IN_PROGRESS || jobStatus === "in_progress") {
      job.status = JobStatus.IN_PROGRESS;
    } else if (resolution === DisputeResolution.FAVOR_HOMEOWNER) {
      job.status = JobStatus.CANCELLED;
    } else if (resolution === DisputeResolution.FAVOR_TRADESPERSON) {
      job.status = JobStatus.COMPLETED;
      if (!job.completedAt) job.completedAt = new Date();
    } else {
      if (job.status === JobStatus.DISPUTED) {
        job.status = JobStatus.CANCELLED;
      }
    }
    await jobRepo().save(job);

    const ids = Array.isArray(refundMilestoneIds)
      ? refundMilestoneIds.map(String)
      : typeof refundMilestoneIds === "string" && refundMilestoneIds
        ? [refundMilestoneIds]
        : [];
    if (ids.length) {
      const result = await refundMilestonesForJob(
        job,
        ids,
        req.user!.id,
        dispute.resolutionNotes || `Dispute ${dispute.id} resolution refund`
      );
      dispute.refundMeta = {
        milestoneIds: result.refunded.map((m) => m.id),
        totalRefunded: result.totalRefunded,
        labels: result.refunded.map((m) => m.label),
      };
      // Prefer refunded payment status when all reverse
      if (result.paymentStatus === PaymentStatus.REFUNDED) {
        job.paymentStatus = PaymentStatus.REFUNDED;
      }
    }

    await disputeRepo().save(dispute);

    const notifyIds = new Set<string>([dispute.raisedByUserId, job.homeownerId]);
    if (job.acceptedBidId) {
      const accepted = await bidRepo().findOne({ where: { id: job.acceptedBidId } });
      if (accepted) notifyIds.add(accepted.tradespersonId);
    }
    for (const userId of notifyIds) {
      await createNotification({
        userId,
        type: NotificationType.DISPUTE,
        title: "Dispute resolved",
        body: `Dispute on "${job.title}" resolved: ${String(resolution).replace(/_/g, " ")}${
          dispute.refundMeta?.totalRefunded
            ? ` · ₹${Number(dispute.refundMeta.totalRefunded).toFixed(0)} escrow refunded (simulated)`
            : ""
        }`,
        link:
          userId === job.homeownerId
            ? `/homeowner/jobs/${job.id}`
            : `/tradesperson/jobs/${job.id}`,
        meta: { jobId: job.id, disputeId: dispute.id, resolution },
      });
    }
  }

  if (!job) {
    await disputeRepo().save(dispute);
  }

  await writeAudit({
    actorUserId: req.user!.id,
    actorEmail: req.user!.email,
    action: AuditAction.DISPUTE_RESOLVE,
    targetType: "dispute",
    targetId: dispute.id,
    summary: `Resolved dispute on job ${dispute.jobId}: ${resolution}`,
    meta: {
      resolution,
      jobId: dispute.jobId,
      jobStatus: job?.status,
      notes: dispute.resolutionNotes,
      refundMeta: dispute.refundMeta || null,
    },
  });

  return res.json({ dispute: serializeDispute(dispute), job });
}
