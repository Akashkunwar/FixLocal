import { In } from "typeorm";
import { AppDataSource } from "../data-source";
import { Favorite, FavoriteTargetType } from "../entities/Favorite";
import { Job } from "../entities/Job";
import { TradespersonProfile, VerificationStatus } from "../entities/TradespersonProfile";
import { User } from "../entities/User";
import { NotificationType } from "../entities/Notification";
import { createNotifications } from "./notifications";
import { textMatchesCategory, normalizeText, containsPhrase } from "../domain/categories";

function areaOverlap(job: Pick<Job, "area" | "city">, serviceAreas?: string | null, proCity?: string | null) {
  const hay = normalizeText(`${serviceAreas || ""} ${proCity || ""}`);
  if (!hay.trim()) return false;
  return (!!job.city && containsPhrase(hay, job.city)) || (!!job.area && containsPhrase(hay, job.area));
}

/** Tell clients who saved this pro that they're now available (no email addresses in the text). */
export async function notifyFavoritersProAvailable(proUserId: string, reason: string) {
  const favs = await AppDataSource.getRepository(Favorite).find({
    where: { targetType: FavoriteTargetType.PRO, targetId: proUserId },
  });
  if (!favs.length) return 0;
  const pro = await AppDataSource.getRepository(User).findOne({ where: { id: proUserId } });
  const sent = await createNotifications(
    favs.map((f) => ({
      userId: f.userId,
      type: NotificationType.PRO_AVAILABLE,
      title: "Saved professional update",
      body: `${pro?.name || "A saved professional"} ${reason}`,
      link: `/pros/${proUserId}`,
      meta: { proUserId, reason },
    }))
  );
  return sent.size;
}

/** When a client posts a job, point out saved pros who look like a fit. */
export async function notifyHomeownerMatchHints(job: Job) {
  const favPros = await AppDataSource.getRepository(Favorite).find({
    where: { userId: job.homeownerId, targetType: FavoriteTargetType.PRO },
    take: 100,
  });
  if (!favPros.length) return 0;
  const profiles = await AppDataSource.getRepository(TradespersonProfile).find({
    where: { userId: In(favPros.map((f) => f.targetId)), verificationStatus: VerificationStatus.VERIFIED },
    relations: ["user"],
  });
  const hints = profiles
    .map((p) => {
      const skillOk = textMatchesCategory(p.skills, job.category);
      const areaOk = areaOverlap(job, p.serviceAreas, p.city);
      if (!skillOk && !areaOk) return null;
      const bits = [skillOk ? `skills fit ${job.category.replace(/_/g, " ")}` : null, areaOk ? "covers this area" : null].filter(Boolean);
      return {
        userId: job.homeownerId,
        type: NotificationType.MATCH,
        title: "A saved professional may be a fit",
        body: `${p.user?.name || "A saved professional"} ${bits.join(" · ")} for "${job.title}"`,
        link: `/client/jobs/${job.id}`,
        meta: { jobId: job.id, proUserId: p.userId, matchHint: true },
      };
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .slice(0, 5);
  // One notification per hint would all share the same userId; send them individually.
  let sent = 0;
  for (const hint of hints) sent += (await createNotifications([hint])).size;
  return sent;
}
