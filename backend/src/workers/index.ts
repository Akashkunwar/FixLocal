import { grantReferralRewards } from "../domain/credits";
import { LessThan } from "typeorm";
import { AppDataSource } from "../data-source";
import { config } from "../config";
import { Job, JobStatus } from "../entities/Job";
import { Bid, BidStatus } from "../entities/Bid";
import { User } from "../entities/User";
import { NotificationType } from "../entities/Notification";
import { IdempotencyKey } from "../entities/IdempotencyKey";
import { RefreshToken } from "../entities/RefreshToken";
import { EmailToken } from "../entities/EmailToken";
import { AuditAction, SYSTEM_ACTOR_ID, writeAudit } from "../utils/audit";
import { createNotifications } from "../utils/notifications";
import { transitionJob } from "../domain/jobStateMachine";
import { releaseRemaining } from "../domain/escrow";
import { viewedNoReplyState } from "../controllers/bidController";
import { logger } from "../logger";
import { sendJobAlertDigests } from "../utils/jobAlertDigest";
import { flushOutbound } from "../utils/outbound";
import { JobAlertDigest } from "../entities/JobAlertDigest";
import { HttpError } from "../http/errors";
import { expireOpenJobs, warnExpiringJobs } from "./jobExpiry";
import { quoteViewNudgeHours } from "../utils/availabilityHeat";

const LOCK_KEY = 7_140_291;

/** Client didn't respond after the pro marked the work done: confirm and release. */
export async function autoConfirmJobs(now = new Date()) {
  const cutoff = new Date(now.getTime() - config().autoConfirmDays * 86400_000);
  const due = await AppDataSource.getRepository(Job).find({
    where: { status: JobStatus.PENDING_CONFIRMATION, pendingConfirmationAt: LessThan(cutoff) },
    take: 100,
  });
  let confirmed = 0;
  for (const job of due) {
    try {
      const result = await AppDataSource.transaction(async (m) => {
        // Re-check under the row lock: a dispute ruled "no action" may have restarted the window
        // (or the client confirmed) after the list above was read.
        const [locked]: { status: JobStatus; pendingConfirmationAt: Date | null }[] = await m.query(
          `SELECT "status", "pendingConfirmationAt" FROM "jobs" WHERE "id" = $1 FOR UPDATE`,
          [job.id]
        );
        if (
          !locked ||
          locked.status !== JobStatus.PENDING_CONFIRMATION ||
          !locked.pendingConfirmationAt ||
          new Date(locked.pendingConfirmationAt) >= cutoff
        ) {
          return null;
        }
        await transitionJob(m, job.id, "auto_confirm", { completedAt: now });
        const fresh = await m.findOneOrFail(Job, { where: { id: job.id } });
        const released = await releaseRemaining(m, fresh, null);
        const rewards = await grantReferralRewards(m, job.id, now);
        await writeAudit(
          {
            actorUserId: SYSTEM_ACTOR_ID,
            actorEmail: "system",
            action: AuditAction.AUTO_CONFIRM,
            targetType: "job",
            targetId: job.id,
            summary: `Auto-confirmed "${job.title}" after ${config().autoConfirmDays} days without a response`,
            meta: { released: released.released.length },
          },
          m
        );
        return { ...released, rewards };
      });
      if (!result) continue;
      if (result.rewards.length) await createNotifications(result.rewards);
      confirmed += 1;
      const accepted = job.acceptedBidId ? await AppDataSource.getRepository(Bid).findOne({ where: { id: job.acceptedBidId } }) : null;
      const total = result.released.reduce((s, m) => s + Number(m.amount), 0);
      await createNotifications(
        [
          {
            userId: job.homeownerId,
            type: NotificationType.JOB_STATUS,
            title: "Job confirmed automatically",
            body: `"${job.title}" was confirmed complete because there was no response within ${config().autoConfirmDays} days.`,
            link: `/client/jobs/${job.id}`,
            meta: { jobId: job.id, autoConfirmed: true },
          },
          ...(accepted
            ? [
                {
                  userId: accepted.tradespersonId,
                  type: NotificationType.JOB_STATUS,
                  title: "Job confirmed",
                  body: `"${job.title}" was confirmed automatically${total ? ` and ₹${total.toFixed(0)} was released` : ""}.`,
                  link: `/professional/jobs/${job.id}`,
                  meta: { jobId: job.id, autoConfirmed: true },
                  text: total > 0,
                },
              ]
            : []),
        ]
      );
    } catch (err) {
      if (!(err instanceof HttpError)) logger.warn({ err, jobId: job.id }, "auto-confirm failed");
    }
  }
  return confirmed;
}

/** One-time "client viewed your revised quote but you haven't followed up" nudge. */
export async function sendQuoteViewNudges(now = new Date()) {
  // Only rows already due, oldest view first: rows that aren't due yet (or were revised since the
  // view) can't fill the batch and starve the rest. The pro's own threshold (1-168 h) applies.
  const bids = await AppDataSource.getRepository(Bid)
    .createQueryBuilder("b")
    .innerJoinAndSelect("b.job", "job")
    .innerJoinAndSelect("b.tradesperson", "pro")
    .where("b.status = :active", { active: BidStatus.ACTIVE })
    .andWhere("job.status = :open", { open: JobStatus.OPEN })
    .andWhere("b.quoteViewedAt IS NOT NULL AND b.quoteViewedNudgeSentAt IS NULL")
    .andWhere(`jsonb_array_length(COALESCE(b."quoteHistory", '[]'::jsonb)) >= 1`)
    .andWhere(`jsonb_array_length(COALESCE(b."quoteHistory", '[]'::jsonb)) <= COALESCE(b."quoteViewedRevisionCount", 0)`)
    .andWhere(
      `b."quoteViewedAt" <= :now::timestamptz - make_interval(hours => CASE WHEN pro."quoteViewNudgeHours" BETWEEN 1 AND 168 THEN pro."quoteViewNudgeHours" ELSE :fallback END)`,
      { now, fallback: Math.round(quoteViewNudgeHours()) }
    )
    .orderBy("b.quoteViewedAt", "ASC")
    .take(200)
    .getMany();
  let sent = 0;
  for (const bid of bids) {
    const state = viewedNoReplyState(bid, (bid.tradesperson as User).quoteViewNudgeHours, now.getTime());
    if (!state.due) continue;
    const claimed = await AppDataSource.getRepository(Bid)
      .createQueryBuilder()
      .update()
      .set({ quoteViewedNudgeSentAt: now })
      .where(`"id" = :id AND "quoteViewedNudgeSentAt" IS NULL`, { id: bid.id })
      .execute();
    if (!claimed.affected) continue;
    await createNotifications([
      {
        userId: bid.tradespersonId,
        type: NotificationType.SYSTEM,
        title: "Viewed but no reply",
        body: `The client viewed your revised quote on "${bid.job.title}" ~${Math.floor(state.hoursSinceView ?? 0)}h ago. Consider following up.`,
        link: `/professional/jobs/${bid.jobId}?nudge=viewed#bid-form`,
        meta: { jobId: bid.jobId, bidId: bid.id, viewedNoReply: true, thresholdHours: state.thresholdHours },
      },
    ]);
    sent += 1;
  }
  return sent;
}

export async function cleanupExpired(now = new Date()) {
  const day = 86400_000;
  await AppDataSource.getRepository(IdempotencyKey).delete({ createdAt: LessThan(new Date(now.getTime() - day)) });
  await AppDataSource.getRepository(RefreshToken).delete({ expiresAt: LessThan(new Date(now.getTime() - 7 * day)) });
  await AppDataSource.getRepository(EmailToken).delete({ expiresAt: LessThan(new Date(now.getTime() - 7 * day)) });
  await AppDataSource.getRepository(JobAlertDigest).delete({ createdAt: LessThan(new Date(now.getTime() - 60 * day)) });
  await AppDataSource.query(`DELETE FROM "outbound_messages" WHERE "status" IN ('sent', 'failed', 'skipped') AND "createdAt" < $1`, [
    new Date(now.getTime() - 30 * day),
  ]);
}

/** Only one API instance runs the jobs at a time (session-level advisory lock on a dedicated connection). */
export async function runWorkersOnce(now = new Date()) {
  const runner = AppDataSource.createQueryRunner();
  await runner.connect();
  try {
    const [{ locked }] = await runner.query(`SELECT pg_try_advisory_lock($1) AS locked`, [LOCK_KEY]);
    if (!locked) return { skipped: true };
    try {
      // Each step on its own: one failing (a bad row, a provider outage) must not skip the others.
      const failed: string[] = [];
      const step = async <T>(name: string, run: () => Promise<T>, fallback: T): Promise<T> => {
        try {
          return await run();
        } catch (err) {
          failed.push(name);
          logger.error({ err, step: name }, "background worker step failed");
          return fallback;
        }
      };
      const autoConfirmed = await step("autoConfirm", () => autoConfirmJobs(now), 0);
      const nudges = await step("quoteViewNudges", () => sendQuoteViewNudges(now), 0);
      const digests = await step("jobAlertDigests", () => sendJobAlertDigests(now), 0);
      const expiryWarnings = await step("expiryWarnings", () => warnExpiringJobs(now), 0);
      const expired = await step("expireJobs", () => expireOpenJobs(now), 0);
      const texts = await step("texts", () => flushOutbound(now), 0);
      await step("cleanup", () => cleanupExpired(now), undefined);
      return { skipped: false, autoConfirmed, nudges, digests, expiryWarnings, expired, texts, failed };
    } finally {
      await runner.query(`SELECT pg_advisory_unlock($1)`, [LOCK_KEY]);
    }
  } finally {
    await runner.release();
  }
}

let timer: NodeJS.Timeout | null = null;
let running: Promise<unknown> | null = null;

export function startWorkers() {
  if (!config().workersEnabled || timer) return;
  const tick = () => {
    if (running) return; // the previous run is still going
    running = runWorkersOnce()
      .catch((err) => logger.error({ err }, "background worker failed"))
      .finally(() => {
        running = null;
      });
  };
  timer = setInterval(tick, config().workerIntervalSec * 1000);
  timer.unref();
  tick();
}

/** Stop scheduling and wait for a run in progress, so shutdown doesn't close the database under it. */
export async function stopWorkers() {
  if (timer) clearInterval(timer);
  timer = null;
  if (running) await running;
}
