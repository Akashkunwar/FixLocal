import { Request, Response } from "express";
import { AppDataSource } from "../data-source";
import { Bid } from "../entities/Bid";
import { Job, JobStatus } from "../entities/Job";
import { UserRole } from "../entities/User";

const jobRepo = () => AppDataSource.getRepository(Job);
const bidRepo = () => AppDataSource.getRepository(Bid);

export async function startJob(req: Request, res: Response) {
  const job = await jobRepo().findOne({ where: { id: req.params.id } });
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
  return res.json({ job });
}

export async function completeJob(req: Request, res: Response) {
  const job = await jobRepo().findOne({ where: { id: req.params.id } });
  if (!job) {
    return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });
  }

  const { role, id: userId } = req.user!;
  const isOwner = job.homeownerId === userId;
  const isAdmin = role === UserRole.ADMIN;

  let isAwardedPro = false;
  if (job.acceptedBidId) {
    const accepted = await bidRepo().findOne({ where: { id: job.acceptedBidId } });
    isAwardedPro = !!accepted && accepted.tradespersonId === userId;
  }

  if (!isOwner && !isAdmin && !isAwardedPro) {
    return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
  }

  // Homeowner confirmation is source of truth; awarded pro may propose from in_progress
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
  await jobRepo().save(job);
  return res.json({ job });
}
