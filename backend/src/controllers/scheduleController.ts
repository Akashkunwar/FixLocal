import { Request, Response } from "express";
import { param } from "../utils/params";
import { AppDataSource } from "../data-source";
import { Bid } from "../entities/Bid";
import { Job, JobStatus, ScheduleStatus } from "../entities/Job";
import { UserRole } from "../entities/User";
import { NotificationType } from "../entities/Notification";
import { createNotification } from "../utils/notifications";

const jobRepo = () => AppDataSource.getRepository(Job);
const bidRepo = () => AppDataSource.getRepository(Bid);

async function getAwardedProId(job: Job): Promise<string | undefined> {
  if (!job.acceptedBidId) return undefined;
  const accepted = await bidRepo().findOne({ where: { id: job.acceptedBidId } });
  return accepted?.tradespersonId;
}

async function isParty(job: Job, userId: string, role: UserRole) {
  if (role === UserRole.ADMIN) return true;
  if (job.homeownerId === userId) return true;
  const proId = await getAwardedProId(job);
  return proId === userId;
}

export async function proposeSchedule(req: Request, res: Response) {
  const job = await jobRepo().findOne({ where: { id: param(req, "id") } });
  if (!job) {
    return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });
  }

  const allowed = [JobStatus.AWARDED, JobStatus.IN_PROGRESS, JobStatus.OPEN];
  // For open jobs, only the bidding pro proposes via the bid itself;
  // after award both parties can propose/counter on the job.
  if (job.status === JobStatus.OPEN) {
    return res.status(400).json({
      message: "Propose a visit window when placing a bid, or after the job is awarded",
      code: "JOB_STILL_OPEN",
    });
  }
  if (!allowed.includes(job.status) && job.status !== JobStatus.AWARDED && job.status !== JobStatus.IN_PROGRESS) {
    return res.status(400).json({ message: "Cannot schedule in current status", code: "INVALID_STATUS" });
  }
  if (job.status !== JobStatus.AWARDED && job.status !== JobStatus.IN_PROGRESS) {
    return res.status(400).json({ message: "Job must be awarded or in progress", code: "INVALID_STATUS" });
  }

  if (!(await isParty(job, req.user!.id, req.user!.role))) {
    return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
  }

  const { start, end, note } = req.body ?? {};
  if (!start) {
    return res.status(400).json({ message: "start is required (ISO datetime)" });
  }
  const startDate = new Date(start);
  const endDate = end ? new Date(end) : new Date(startDate.getTime() + 2 * 60 * 60 * 1000);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return res.status(400).json({ message: "Invalid start/end datetime" });
  }
  if (endDate <= startDate) {
    return res.status(400).json({ message: "end must be after start" });
  }

  job.scheduledStart = startDate;
  job.scheduledEnd = endDate;
  job.scheduleStatus = ScheduleStatus.PROPOSED;
  job.scheduleProposedByUserId = req.user!.id;
  job.scheduleNote = note ? String(note).trim() : undefined;
  await jobRepo().save(job);

  const proId = await getAwardedProId(job);
  const notifyId =
    req.user!.id === job.homeownerId ? proId : job.homeownerId;
  if (notifyId) {
    await createNotification({
      userId: notifyId,
      type: NotificationType.JOB_STATUS,
      title: "Visit time proposed",
      body: `A visit window was proposed for "${job.title}".`,
      link:
        notifyId === job.homeownerId
          ? `/homeowner/jobs/${job.id}`
          : `/tradesperson/jobs/${job.id}`,
      meta: { jobId: job.id, scheduledStart: startDate.toISOString() },
    });
  }

  return res.json({ job });
}

export async function acceptSchedule(req: Request, res: Response) {
  const job = await jobRepo().findOne({ where: { id: param(req, "id") } });
  if (!job) {
    return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });
  }
  if (!(await isParty(job, req.user!.id, req.user!.role))) {
    return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
  }
  if (job.scheduleStatus !== ScheduleStatus.PROPOSED || !job.scheduledStart) {
    return res.status(400).json({
      message: "No proposed schedule to accept",
      code: "NO_PROPOSAL",
    });
  }
  if (job.scheduleProposedByUserId === req.user!.id && req.user!.role !== UserRole.ADMIN) {
    return res.status(400).json({
      message: "The other party must accept your proposal",
      code: "CANNOT_SELF_ACCEPT",
    });
  }

  job.scheduleStatus = ScheduleStatus.CONFIRMED;
  await jobRepo().save(job);

  const proId = await getAwardedProId(job);
  const notifyId =
    req.user!.id === job.homeownerId ? proId : job.homeownerId;
  if (notifyId) {
    await createNotification({
      userId: notifyId,
      type: NotificationType.JOB_STATUS,
      title: "Visit time confirmed",
      body: `Visit window confirmed for "${job.title}".`,
      link:
        notifyId === job.homeownerId
          ? `/homeowner/jobs/${job.id}`
          : `/tradesperson/jobs/${job.id}`,
      meta: { jobId: job.id },
    });
  }

  return res.json({ job });
}

export async function getSchedule(req: Request, res: Response) {
  const job = await jobRepo().findOne({ where: { id: param(req, "id") } });
  if (!job) {
    return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });
  }
  if (!(await isParty(job, req.user!.id, req.user!.role)) && job.status === JobStatus.OPEN) {
    // open job: any authenticated pro can see preferred times; owner always
    if (job.homeownerId !== req.user!.id && req.user!.role !== UserRole.ADMIN) {
      // still allow reading preferred window on open jobs for bidders
    }
  }

  return res.json({
    schedule: {
      status: job.scheduleStatus,
      scheduledStart: job.scheduledStart || null,
      scheduledEnd: job.scheduledEnd || null,
      proposedByUserId: job.scheduleProposedByUserId || null,
      note: job.scheduleNote || null,
      preferredStart: job.preferredStart || null,
      preferredEnd: job.preferredEnd || null,
    },
  });
}
