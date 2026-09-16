import { Request, Response } from "express";
import { param } from "../utils/params";
import { AppDataSource } from "../data-source";
import { Bid } from "../entities/Bid";
import { Job, JobStatus, PaymentStatus } from "../entities/Job";
import { UserRole } from "../entities/User";
import { NotificationType } from "../entities/Notification";
import { createNotification } from "../utils/notifications";
import { autoReleaseRemainingEscrow } from "./paymentController";

const jobRepo = () => AppDataSource.getRepository(Job);
const bidRepo = () => AppDataSource.getRepository(Bid);

export async function startJob(req: Request, res: Response) {
  const job = await jobRepo().findOne({ where: { id: param(req, "id") } });
  if (!job) {
    return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });
  }
  if (job.status !== JobStatus.AWARDED) {
    return res.status(400).json({
      message: "Job must be awarded before starting work",
      code: "INVALID_STATUS",
    });
  }

  const accepted = job.acceptedBidId
    ? await bidRepo().findOne({ where: { id: job.acceptedBidId } })
    : null;
  if (!accepted || accepted.tradespersonId !== req.user!.id) {
    return res.status(403).json({
      message: "Only the awarded tradesperson can start this job",
      code: "FORBIDDEN",
    });
  }

  job.status = JobStatus.IN_PROGRESS;
  await jobRepo().save(job);

  await createNotification({
    userId: job.homeownerId,
    type: NotificationType.JOB_STATUS,
    title: "Work started",
    body: `The tradesperson started work on "${job.title}".`,
    link: `/homeowner/jobs/${job.id}`,
    meta: { jobId: job.id, status: job.status },
  });

  return res.json({ job });
}

export async function completeJob(req: Request, res: Response) {
  const job = await jobRepo().findOne({ where: { id: param(req, "id") } });
  if (!job) {
    return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });
  }

  const { role, id: userId } = req.user!;
  const isOwner = job.homeownerId === userId;
  const isAdmin = role === UserRole.ADMIN;

  let isAwardedPro = false;
  let awardedProId: string | undefined;
  if (job.acceptedBidId) {
    const accepted = await bidRepo().findOne({ where: { id: job.acceptedBidId } });
    isAwardedPro = !!accepted && accepted.tradespersonId === userId;
    awardedProId = accepted?.tradespersonId;
  }

  if (!isOwner && !isAdmin && !isAwardedPro) {
    return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
  }

  if (role === UserRole.TRADESPERSON && !isAdmin) {
    if (job.status !== JobStatus.IN_PROGRESS) {
      return res.status(400).json({
        message: "Tradesperson can only complete from in_progress",
        code: "INVALID_STATUS",
      });
    }
  } else {
    if (job.status !== JobStatus.AWARDED && job.status !== JobStatus.IN_PROGRESS) {
      return res.status(400).json({
        message: "Job must be awarded or in progress to complete",
        code: "INVALID_STATUS",
      });
    }
  }

  job.status = JobStatus.COMPLETED;
  job.completedAt = new Date();
  await jobRepo().save(job);

  let autoReleased: { count: number; paymentStatus?: PaymentStatus } | null = null;

  // Homeowner (or admin) confirming completion auto-releases any remaining escrow.
  if ((isOwner || isAdmin) && job.acceptedBidId) {
    const stillHeld = [
      PaymentStatus.HELD,
      PaymentStatus.PARTIALLY_RELEASED,
      PaymentStatus.SIMULATED_PAID,
      PaymentStatus.PENDING,
    ].includes(job.paymentStatus);
    if (stillHeld || job.paymentStatus !== PaymentStatus.RELEASED) {
      const result = await autoReleaseRemainingEscrow(job, userId);
      if (result.released.length > 0) {
        autoReleased = {
          count: result.released.length,
          paymentStatus: result.paymentStatus,
        };
        job.paymentStatus = result.paymentStatus;
      }
    }
  }

  if (isOwner || isAdmin) {
    if (awardedProId) {
      await createNotification({
        userId: awardedProId,
        type: NotificationType.JOB_STATUS,
        title: "Job completed",
        body: autoReleased
          ? `"${job.title}" was marked completed and remaining escrow was released. Great work!`
          : `"${job.title}" was marked completed. Great work!`,
        link: `/tradesperson/jobs/${job.id}`,
        meta: { jobId: job.id, status: job.status, autoReleased },
      });
    }
  } else if (isAwardedPro) {
    await createNotification({
      userId: job.homeownerId,
      type: NotificationType.JOB_STATUS,
      title: "Pro marked job complete",
      body: `Please confirm completion for "${job.title}" and leave a review.`,
      link: `/homeowner/jobs/${job.id}`,
      meta: { jobId: job.id, status: job.status },
    });
  }

  return res.json({ job, autoReleased });
}
