import { AppDataSource } from "../data-source";
import { JobAlertDigest } from "../entities/JobAlertDigest";
import { JobStatus } from "../entities/Job";
import { NotificationType } from "../entities/Notification";
import { User } from "../entities/User";
import { istParts } from "../domain/time";
import { asLang, emails } from "../domain/i18n";
import { appLink, sendMail } from "../services/mailer";
import { createNotifications, isNotificationEnabled, wantsEmail } from "./notifications";
import { logger } from "../logger";

/** Digests go out on the first worker run at or after this hour (IST), once per IST day. */
export const DIGEST_HOUR_IST = 8;
const DAY_MS = 24 * 3600_000;

type PendingRow = { userId: string };
type ClaimedMatch = { jobId: string; alertName: string; title: string; city: string | null; area: string | null; status: string };

/** Unsent matches older than this are dropped (the job is stale by then). */
const KEEP_UNSENT_MS = 3 * DAY_MS;

/**
 * Send each professional one digest of every daily-alert match not yet sent (from the last 3 days):
 * a match that lands just after today's digest goes in tomorrow's, whatever time the worker runs.
 * Idempotent: the (userId, IST day) digest row is claimed with INSERT … ON CONFLICT DO NOTHING
 * before anything is sent, and each match is stamped with the digest that carried it.
 */
export async function sendJobAlertDigests(now = new Date()): Promise<number> {
  const ist = istParts(now);
  if (ist.hour < DIGEST_HOUR_IST) return 0;
  const since = new Date(now.getTime() - KEEP_UNSENT_MS);
  const pending: PendingRow[] = await AppDataSource.query(
    `SELECT DISTINCT m."userId" FROM "job_alert_matches" m
      WHERE m."digestId" IS NULL AND m."createdAt" >= $1
        AND NOT EXISTS (SELECT 1 FROM "job_alert_digests" d WHERE d."userId" = m."userId" AND d."digestDate" = $2)
      LIMIT 500`,
    [since, ist.date]
  );
  let sent = 0;
  for (const { userId } of pending) {
    try {
      if (await sendOne(userId, ist.date, since)) sent += 1;
    } catch (err) {
      logger.warn({ err, userId }, "job alert digest failed");
    }
  }
  // Matches never sent within 3 days are dropped.
  await AppDataSource.query(`DELETE FROM "job_alert_matches" WHERE "digestId" IS NULL AND "createdAt" < $1`, [since]);
  return sent;
}

async function sendOne(userId: string, day: string, since: Date): Promise<boolean> {
  const claim = await AppDataSource.createQueryBuilder()
    .insert()
    .into(JobAlertDigest)
    .values({ userId, digestDate: day, jobCount: 0 })
    .orIgnore()
    .returning(["id"])
    .execute();
  const digestId: string | undefined = claim.raw?.[0]?.id;
  if (!digestId) return false; // another run already sent today's digest

  const claimed: ClaimedMatch[] = await AppDataSource.query(
    `WITH taken AS (
       UPDATE "job_alert_matches" SET "digestId" = $1
        WHERE "userId" = $2 AND "digestId" IS NULL AND "createdAt" >= $3
        RETURNING "jobId", "alertName")
     SELECT t."jobId", t."alertName", j."title", j."city", j."area", j."status"
       FROM taken t JOIN "jobs" j ON j."id" = t."jobId"
      ORDER BY j."createdAt" DESC`,
    [digestId, userId, since]
  );
  const open = claimed.filter((c) => c.status === JobStatus.OPEN);
  await AppDataSource.getRepository(JobAlertDigest).update({ id: digestId }, { jobCount: open.length });
  if (!open.length) return false;

  const user = await AppDataSource.getRepository(User).findOne({
    where: { id: userId },
    select: { id: true, email: true, emailVerifiedAt: true, notificationPrefs: true, deletedAt: true, language: true },
  });
  if (!user || user.deletedAt || !isNotificationEnabled(user.notificationPrefs, NotificationType.JOB_ALERT)) return false;

  const items = open.map((c) => ({
    title: c.title,
    where: [c.area, c.city].filter(Boolean).join(", "),
    link: appLink(`/professional/jobs/${c.jobId}`),
    alertName: c.alertName,
  }));
  const shown = open.slice(0, 3).map((c) => `"${c.title}"`).join(", ");
  await createNotifications([
    {
      userId,
      type: NotificationType.JOB_ALERT,
      title: "New jobs match your alerts",
      body: `${open.length} job${open.length === 1 ? "" : "s"} from the last 24 hours: ${shown}${open.length > 3 ? ` and ${open.length - 3} more` : ""}.`,
      link: open.length === 1 ? `/professional/jobs/${open[0].jobId}` : "/professional",
      meta: { digestId, jobIds: open.map((c) => c.jobId) },
      email: false, // the digest email below lists every job with its link
      text: true,
    },
  ]);
  if (user.emailVerifiedAt && wantsEmail(user.notificationPrefs)) {
    void sendMail({
      to: user.email,
      ...emails.digest(asLang(user.language), { items, alerts: appLink("/professional/alerts"), settings: appLink("/settings") }),
    });
  }
  return true;
}
