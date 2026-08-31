import { Request, Response } from "express";
import { AppDataSource } from "../data-source";
import {
  Dispute,
  DisputeResolution,
  DisputeStatus,
} from "../entities/Dispute";
import { Bid } from "../entities/Bid";
import { Job, JobStatus } from "../entities/Job";
import { UserRole } from "../entities/User";

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

export async function createDispute(req: Request, res: Response) {
  const { jobId, reason, evidenceUrls } = req.body ?? {};
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
    evidenceUrls: Array.isArray(evidenceUrls) ? evidenceUrls.map(String) : [],
    status: DisputeStatus.OPEN,
  });
  await disputeRepo().save(dispute);

  if (job.status !== JobStatus.DISPUTED) {
    job.status = JobStatus.DISPUTED;
    await jobRepo().save(job);
  }

  return res.status(201).json({ dispute, job });
}

export async function listDisputes(req: Request, res: Response) {
  const { role, id: userId } = req.user!;
  const qb = disputeRepo()
    .createQueryBuilder("d")
    .leftJoinAndSelect("d.job", "job")
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
  return res.json({ disputes });
}

export async function resolveDispute(req: Request, res: Response) {
  const dispute = await disputeRepo().findOne({ where: { id: req.params.id } });
  if (!dispute) {
    return res.status(404).json({ message: "Dispute not found", code: "NOT_FOUND" });
  }
  if (dispute.status !== DisputeStatus.OPEN) {
    return res.status(400).json({ message: "Dispute is already resolved", code: "ALREADY_RESOLVED" });
  }

  const { resolution, resolutionNotes, jobStatus } = req.body ?? {};
  if (!resolution || !RESOLUTIONS.includes(resolution)) {
    return res.status(400).json({
      message: `resolution must be one of: ${RESOLUTIONS.join(", ")}`,
      code: "INVALID_RESOLUTION",
    });
  }

  dispute.status = DisputeStatus.RESOLVED;
  dispute.resolution = resolution;
  dispute.resolutionNotes = resolutionNotes ? String(resolutionNotes) : undefined;
  dispute.resolvedAt = new Date();
  await disputeRepo().save(dispute);

  const job = await jobRepo().findOne({ where: { id: dispute.jobId } });
  if (job) {
    // Terminal job status after resolution
    if (jobStatus === JobStatus.CANCELLED || jobStatus === "cancelled") {
      job.status = JobStatus.CANCELLED;
    } else if (jobStatus === JobStatus.COMPLETED || jobStatus === "completed") {
      job.status = JobStatus.COMPLETED;
    } else if (resolution === DisputeResolution.FAVOR_HOMEOWNER) {
      job.status = JobStatus.CANCELLED;
    } else if (resolution === DisputeResolution.FAVOR_TRADESPERSON) {
      job.status = JobStatus.COMPLETED;
    } else {
      // no_action: leave disputed or set completed if was completed path — keep cancelled safer
      if (job.status === JobStatus.DISPUTED) {
        job.status = JobStatus.CANCELLED;
      }
    }
    await jobRepo().save(job);
  }

  return res.json({ dispute, job });
}
