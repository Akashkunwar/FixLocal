import { AppDataSource } from "../data-source";
import { Job, JobStatus } from "../entities/Job";
import { JobAlert } from "../entities/JobAlert";
import { JobAlertMatch } from "../entities/JobAlertMatch";
import { NotificationType } from "../entities/Notification";
import { normalizeText, containsPhrase } from "../domain/categories";
import { haversineKm } from "./geo";
import { createNotifications } from "./notifications";

export const MAX_ALERTS_PER_PRO = 10;

type AlertCriteria = Pick<JobAlert, "categories" | "city" | "area" | "lat" | "lng" | "radiusKm" | "minBudget" | "siteType">;
type JobFacts = Pick<Job, "category" | "city" | "area" | "address" | "lat" | "lng" | "budgetMin" | "budgetMax" | "siteType">;

const sameText = (a?: string | null, b?: string | null) => normalizeText(a) === normalizeText(b);

/**
 * Does this job match the alert? Pure, so it is unit-tested directly.
 * - categories: empty means any.
 * - location: a pin + radius wins when both sides have coordinates; otherwise city / area text.
 * - budget: jobs without a budget still match (the pro can ask).
 */
export function alertMatchesJob(alert: AlertCriteria, job: JobFacts): boolean {
  if (alert.categories?.length && !alert.categories.includes(job.category)) return false;
  if (alert.siteType && job.siteType && alert.siteType !== job.siteType) return false;
  if (alert.minBudget != null) {
    const top = job.budgetMax ?? job.budgetMin;
    if (top != null && Number(top) < alert.minBudget) return false;
  }
  const distance =
    alert.radiusKm != null ? haversineKm(alert.lat ?? null, alert.lng ?? null, job.lat ?? null, job.lng ?? null) : null;
  if (distance != null) return distance <= alert.radiusKm!;
  if (alert.city && !sameText(alert.city, job.city)) return false;
  if (alert.area) {
    const hay = normalizeText(`${job.area || ""} ${job.address || ""}`);
    if (!containsPhrase(hay, alert.area)) return false;
  }
  return true;
}

function budgetText(job: JobFacts) {
  const fmt = (n: number | string) => `₹${Number(n).toLocaleString("en-IN")}`;
  if (job.budgetMin != null && job.budgetMax != null) return ` · budget ${fmt(job.budgetMin)}–${fmt(job.budgetMax)}`;
  if (job.budgetMax != null) return ` · budget up to ${fmt(job.budgetMax)}`;
  return "";
}

/**
 * Alert every verified, active professional whose job alerts match a newly posted job.
 * One notification per professional per job, however many of their alerts match.
 * Blocked pairs and the job's own client are skipped. Returns the number of pros notified.
 */
export async function notifyJobAlerts(job: Job): Promise<number> {
  if (job.status !== JobStatus.OPEN) return 0;
  const candidates: (JobAlert & { proName?: string })[] = await AppDataSource.getRepository(JobAlert)
    .createQueryBuilder("a")
    .innerJoin("a.user", "u")
    .innerJoin("tradesperson_profiles", "p", `p."userId" = a."userId"`)
    .where("a.active = true")
    .andWhere(`(a.categories = '[]'::jsonb OR a.categories ? :cat)`, { cat: job.category })
    .andWhere(`u."deletedAt" IS NULL AND u."isSuspended" = false`)
    .andWhere(`p."verificationStatus" = 'verified'`)
    .andWhere(`a."userId" <> :owner`, { owner: job.homeownerId })
    .andWhere(
      `NOT EXISTS (SELECT 1 FROM "user_blocks" b WHERE (b."blockerId" = a."userId" AND b."blockedId" = :owner) OR (b."blockerId" = :owner AND b."blockedId" = a."userId"))`,
      { owner: job.homeownerId }
    )
    .getMany();

  // Per pro: an instant alert wins (notify now); otherwise the job waits for the daily digest.
  const firstMatchPerPro = new Map<string, JobAlert>();
  const digestPerPro = new Map<string, JobAlert>();
  const matchedAlertIds: string[] = [];
  for (const a of candidates) {
    if (!alertMatchesJob(a, job)) continue;
    matchedAlertIds.push(a.id);
    if (a.frequency === "instant") {
      if (!firstMatchPerPro.has(a.userId)) firstMatchPerPro.set(a.userId, a);
    } else if (!digestPerPro.has(a.userId)) {
      digestPerPro.set(a.userId, a);
    }
  }
  for (const id of firstMatchPerPro.keys()) digestPerPro.delete(id);
  if (!matchedAlertIds.length) return 0;

  if (matchedAlertIds.length) {
    await AppDataSource.getRepository(JobAlert)
      .createQueryBuilder()
      .update()
      .set({ matchCount: () => `"matchCount" + 1`, lastMatchedAt: () => "now()" })
      .whereInIds(matchedAlertIds)
      .execute();
  }

  if (digestPerPro.size) {
    await AppDataSource.createQueryBuilder()
      .insert()
      .into(JobAlertMatch)
      .values([...digestPerPro.values()].map((a) => ({ userId: a.userId, jobId: job.id, alertName: a.name })))
      .orIgnore()
      .execute();
  }
  if (!firstMatchPerPro.size) return 0;

  const where = [job.area, job.city].filter(Boolean).join(", ");
  const sent = await createNotifications(
    [...firstMatchPerPro.values()].map((a) => ({
      userId: a.userId,
      type: NotificationType.JOB_ALERT,
      title: `New job: ${job.title}`,
      body: `${job.category.replace(/_/g, " ")}${where ? ` in ${where}` : ""}${budgetText(job)}. Matches your alert "${a.name}".`,
      link: `/professional/jobs/${job.id}`,
      meta: { jobId: job.id, alertId: a.id },
      text: true,
    }))
  );
  return sent.size;
}

/** Open jobs from the last 30 days that would match these criteria (for the "N jobs match now" preview). */
export async function previewMatches(criteria: AlertCriteria, proUserId: string, limit = 5) {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const qb = AppDataSource.getRepository(Job)
    .createQueryBuilder("j")
    .where("j.status = :open", { open: JobStatus.OPEN })
    .andWhere("j.createdAt >= :since", { since })
    .andWhere(`j."homeownerId" <> :me`, { me: proUserId })
    .orderBy("j.createdAt", "DESC")
    .take(500);
  if (criteria.categories?.length) qb.andWhere("j.category IN (:...cats)", { cats: criteria.categories });
  const jobs = (await qb.getMany()).filter((j) => alertMatchesJob(criteria, j));
  return {
    count: jobs.length,
    jobs: jobs.slice(0, limit).map((j) => ({ id: j.id, title: j.title, category: j.category, area: j.area ?? null, city: j.city ?? null, createdAt: j.createdAt })),
  };
}
