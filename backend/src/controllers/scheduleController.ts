import type { Request, Response } from "express";
import { AppDataSource } from "../data-source";
import { Job, JobStatus, ScheduleStatus } from "../entities/Job";
import { UserRole } from "../entities/User";
import { NotificationType } from "../entities/Notification";
import { createNotification } from "../utils/notifications";
import { toJob } from "../serializers";
import {
  assertJobAccess,
  assertPrivateAccess,
  loadJobContext,
  type JobContext,
} from "../policies/jobPolicy";
import { viewer } from "./jobController";
import { badRequest, conflict } from "../http/errors";

const SCHEDULABLE: JobStatus[] = [JobStatus.AWARDED, JobStatus.IN_PROGRESS];

function otherParty(ctx: JobContext, actorId: string): string | null {
  if (actorId === ctx.job.homeownerId) return ctx.acceptedProId;
  return ctx.job.homeownerId;
}

function linkFor(ctx: JobContext, userId: string) {
  return userId === ctx.job.homeownerId ? `/client/jobs/${ctx.job.id}` : `/professional/jobs/${ctx.job.id}`;
}

export async function proposeSchedule(req: Request, res: Response) {
  const ctx = await loadJobContext(req.valid.params.id);
  assertPrivateAccess(ctx, viewer(req));
  if (ctx.job.status === JobStatus.OPEN) {
    throw badRequest("Propose a visit window in your bid, or after the job is awarded", "JOB_STILL_OPEN");
  }
  if (!SCHEDULABLE.includes(ctx.job.status)) {
    throw conflict("Visits can only be scheduled on awarded or in-progress jobs", "INVALID_STATUS");
  }
  const { start, end, note } = req.valid.body;
  const endDate = end ?? new Date(start.getTime() + 2 * 3600_000);
  await AppDataSource.getRepository(Job).update(
    { id: ctx.job.id },
    {
      scheduledStart: start,
      scheduledEnd: endDate,
      scheduleStatus: ScheduleStatus.PROPOSED,
      scheduleProposedByUserId: req.user!.id,
      scheduleNote: note || undefined,
    }
  );
  const notifyId = otherParty(ctx, req.user!.id);
  if (notifyId) {
    await createNotification({
      userId: notifyId,
      type: NotificationType.JOB_STATUS,
      title: "Visit time proposed",
      body: `A visit window was proposed for "${ctx.job.title}".`,
      link: linkFor(ctx, notifyId),
      meta: { jobId: ctx.job.id, scheduledStart: start.toISOString() },
    });
  }
  const job = await AppDataSource.getRepository(Job).findOneOrFail({ where: { id: ctx.job.id } });
  return res.json({ job: toJob(job, "private") });
}

export async function acceptSchedule(req: Request, res: Response) {
  const ctx = await loadJobContext(req.valid.params.id);
  assertPrivateAccess(ctx, viewer(req));
  if (!SCHEDULABLE.includes(ctx.job.status)) {
    throw conflict("Visits can only be confirmed on awarded or in-progress jobs", "INVALID_STATUS");
  }
  if (ctx.job.scheduleStatus !== ScheduleStatus.PROPOSED || !ctx.job.scheduledStart) {
    throw badRequest("There is no proposed visit to accept", "NO_PROPOSAL");
  }
  if (ctx.job.scheduleProposedByUserId === req.user!.id && req.user!.role !== UserRole.ADMIN) {
    throw badRequest("The other party must accept your proposal", "CANNOT_SELF_ACCEPT");
  }
  const updated = await AppDataSource.getRepository(Job).update(
    { id: ctx.job.id, scheduleStatus: ScheduleStatus.PROPOSED },
    { scheduleStatus: ScheduleStatus.CONFIRMED }
  );
  if (!updated.affected) throw conflict("The proposal changed; reload and try again", "STALE_PROPOSAL");
  const notifyId = otherParty(ctx, req.user!.id);
  if (notifyId) {
    await createNotification({
      userId: notifyId,
      type: NotificationType.JOB_STATUS,
      title: "Visit time confirmed",
      body: `Visit window confirmed for "${ctx.job.title}".`,
      link: linkFor(ctx, notifyId),
      meta: { jobId: ctx.job.id },
    });
  }
  const job = await AppDataSource.getRepository(Job).findOneOrFail({ where: { id: ctx.job.id } });
  return res.json({ job: toJob(job, "private") });
}

/** Parties see the agreed visit; pros who can see the listing only see the client's preferred window. */
export async function getSchedule(req: Request, res: Response) {
  const ctx = await loadJobContext(req.valid.params.id);
  const access = await assertJobAccess(ctx, viewer(req));
  const job = ctx.job;
  const preferred = { preferredStart: job.preferredStart || null, preferredEnd: job.preferredEnd || null };
  if (access !== "private") {
    return res.json({ schedule: { status: null, scheduledStart: null, scheduledEnd: null, proposedByUserId: null, note: null, ...preferred } });
  }
  return res.json({
    schedule: {
      status: job.scheduleStatus,
      scheduledStart: job.scheduledStart || null,
      scheduledEnd: job.scheduledEnd || null,
      proposedByUserId: job.scheduleProposedByUserId || null,
      note: job.scheduleNote || null,
      ...preferred,
    },
  });
}
