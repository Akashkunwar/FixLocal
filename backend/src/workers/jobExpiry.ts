import { In } from "typeorm";
import { AppDataSource } from "../data-source";
import { config } from "../config";
import { Job, JobStatus } from "../entities/Job";
import { Bid, BidStatus } from "../entities/Bid";
import { NotificationType } from "../entities/Notification";
import { transitionJob } from "../domain/jobStateMachine";
import { createNotifications } from "../utils/notifications";
import { invalidateOpenJobsCache } from "../utils/cache";
import { revokeThreadStreams } from "../utils/sse";
import { AuditAction, SYSTEM_ACTOR_ID, writeAudit } from "../utils/audit";
import { HttpError } from "../http/errors";
import { logger } from "../logger";

/** Days before closing that the client hears "your job closes soon". */
export const EXPIRY_WARNING_DAYS = 3;
const DAY = 86400_000;

/** One "closing soon" reminder per expiry window; claimed with a conditional update so reruns don't repeat it. */
export async function warnExpiringJobs(now = new Date()) {
  const soon = new Date(now.getTime() + EXPIRY_WARNING_DAYS * DAY);
  const due = await AppDataSource.getRepository(Job)
    .createQueryBuilder("j")
    .where(`j.status = :open AND j."expiresAt" IS NOT NULL AND j."expiresAt" > :now AND j."expiresAt" <= :soon AND j."expiryWarnedAt" IS NULL`, {
      open: JobStatus.OPEN,
      now,
      soon,
    })
    .take(200)
    .getMany();
  let sent = 0;
  for (const job of due) {
    const claimed = await AppDataSource.getRepository(Job)
      .createQueryBuilder()
      .update()
      .set({ expiryWarnedAt: now })
      .where(`"id" = :id AND "expiryWarnedAt" IS NULL AND "status" = :open`, { id: job.id, open: JobStatus.OPEN })
      .execute();
    if (!claimed.affected) continue;
    const days = Math.max(1, Math.ceil((new Date(job.expiresAt!).getTime() - now.getTime()) / DAY));
    await createNotifications([
      {
        userId: job.homeownerId,
        type: NotificationType.JOB_STATUS,
        title: "Your job closes soon",
        body: `"${job.title}" closes in ${days} day${days === 1 ? "" : "s"} because nobody has been hired. Hire a professional or keep it open.`,
        link: `/client/jobs/${job.id}`,
        meta: { jobId: job.id, expiresAt: job.expiresAt },
      },
    ]);
    sent += 1;
  }
  return sent;
}

/** Open jobs past expiresAt are closed: bids rejected, client and bidders told. */
export async function expireOpenJobs(now = new Date()) {
  const due = await AppDataSource.getRepository(Job)
    .createQueryBuilder("j")
    .where(`j.status = :open AND j."expiresAt" IS NOT NULL AND j."expiresAt" <= :now`, { open: JobStatus.OPEN, now })
    .take(100)
    .getMany();
  let expired = 0;
  for (const job of due) {
    try {
      const bidders = await AppDataSource.transaction(async (m) => {
        await transitionJob(m, job.id, "cancel", {
          cancelledBy: "system",
          cancellationReason: `Closed automatically: nobody was hired within ${config().jobExpiryDays} days.`,
        });
        const active = await m.find(Bid, { where: { jobId: job.id, status: BidStatus.ACTIVE } });
        if (active.length) await m.update(Bid, { id: In(active.map((b) => b.id)) }, { status: BidStatus.REJECTED });
        await writeAudit(
          {
            actorUserId: SYSTEM_ACTOR_ID,
            actorEmail: "system",
            action: AuditAction.JOB_EXPIRE,
            targetType: "job",
            targetId: job.id,
            summary: `Closed "${job.title}" after ${config().jobExpiryDays} days with no hire`,
            meta: { bidsClosed: active.length },
          },
          m
        );
        return active.map((b) => b.tradespersonId);
      });
      expired += 1;
      await createNotifications([
        {
          userId: job.homeownerId,
          type: NotificationType.JOB_STATUS,
          title: "Job closed",
          body: `"${job.title}" was closed because nobody was hired within ${config().jobExpiryDays} days. You can repost it any time.`,
          link: `/client/jobs/${job.id}`,
          meta: { jobId: job.id, expired: true },
        },
        ...bidders.map((userId) => ({
          userId,
          type: NotificationType.BID_REJECTED,
          title: "Job closed",
          body: `"${job.title}" closed without a hire. Your bid was closed.`,
          link: "/professional",
          meta: { jobId: job.id, expired: true },
        })),
      ]);
      await revokeThreadStreams(job.id, null);
    } catch (err) {
      // Raced with a hire or a manual cancel: the state machine refuses, which is fine.
      if (!(err instanceof HttpError)) logger.warn({ err, jobId: job.id }, "job expiry failed");
    }
  }
  if (expired) await invalidateOpenJobsCache();
  return expired;
}
