import { AppDataSource } from "../data-source";
import { Favorite, FavoriteTargetType } from "../entities/Favorite";
import { Job } from "../entities/Job";
import { TradespersonProfile } from "../entities/TradespersonProfile";
import { User } from "../entities/User";
import { NotificationType } from "../entities/Notification";
import { createNotification } from "./notifications";

function skillMatchesCategory(skills: string | undefined | null, category: string): boolean {
  if (!skills) return false;
  const s = skills.toLowerCase();
  const c = category.toLowerCase();
  if (s.includes(c)) return true;
  const aliases: Record<string, string[]> = {
    plumbing: ["plumb", "pipe", "tap", "leak"],
    electrical: ["electric", "wiring", "fan", "light"],
    carpentry: ["carpenter", "wood", "furniture"],
    painting: ["paint", "wall"],
    appliance: ["appliance", "ac ", "fridge", "washer"],
    cleaning: ["clean", "housekeep", "janitor"],
    construction: ["construct", "mason", "tiling", "weld"],
    office_facilities: ["office", "facilit", "pantry"],
    tech_services: ["cctv", "network", "amc", "wifi", "camera"],
    moving: ["moving", "mover", "driver", "helper", "pack"],
  };
  return (aliases[c] || []).some((a) => s.includes(a));
}

function areaOverlap(
  jobArea: string | undefined | null,
  jobCity: string | undefined | null,
  serviceAreas: string | undefined | null,
  proCity: string | undefined | null
): boolean {
  const hay = `${serviceAreas || ""} ${proCity || ""}`.toLowerCase();
  if (!hay.trim()) return false;
  if (jobCity && hay.includes(jobCity.toLowerCase())) return true;
  if (jobArea && hay.includes(jobArea.toLowerCase())) return true;
  if (proCity && jobCity && proCity.toLowerCase() === jobCity.toLowerCase()) return true;
  return false;
}

/** Notify homeowners who favorited this pro that availability may have changed. */
export async function notifyFavoritersProAvailable(proUserId: string, reason: string) {
  const favs = await AppDataSource.getRepository(Favorite).find({
    where: { targetType: FavoriteTargetType.PRO, targetId: proUserId },
  });
  if (!favs.length) return 0;

  const pro = await AppDataSource.getRepository(User).findOne({ where: { id: proUserId } });
  const name = pro?.name || pro?.email || "A saved pro";
  let n = 0;
  for (const f of favs) {
    const created = await createNotification({
      userId: f.userId,
      type: NotificationType.PRO_AVAILABLE,
      title: "Saved pro update",
      body: `${name} ${reason}`,
      link: `/pros/${proUserId}`,
      meta: { proUserId, reason },
    });
    if (created) n++;
  }
  return n;
}

/**
 * When a homeowner posts a job, tip them if a favorited pro looks like a match.
 * Also notify homeowners who favorited similar open jobs (category + area/city).
 */
export async function notifyHomeownerMatchHints(job: Job) {
  const homeownerId = job.homeownerId;
  let sent = 0;

  const favPros = await AppDataSource.getRepository(Favorite).find({
    where: { userId: homeownerId, targetType: FavoriteTargetType.PRO },
  });
  if (favPros.length) {
    const profiles = await AppDataSource.getRepository(TradespersonProfile)
      .createQueryBuilder("p")
      .leftJoinAndSelect("p.user", "user")
      .where("p.userId IN (:...ids)", { ids: favPros.map((f) => f.targetId) })
      .getMany();

    for (const p of profiles) {
      const skillOk = skillMatchesCategory(p.skills, job.category);
      const areaOk = areaOverlap(job.area, job.city, p.serviceAreas, p.city);
      if (!skillOk && !areaOk) continue;
      const name = p.user?.name || p.user?.email || "Saved pro";
      const bits = [
        skillOk ? `skills fit ${job.category}` : null,
        areaOk ? "covers this area" : null,
      ].filter(Boolean);
      const created = await createNotification({
        userId: homeownerId,
        type: NotificationType.MATCH,
        title: "Favorite pro may match",
        body: `${name} ${bits.join(" · ")} for "${job.title}"`,
        link: `/homeowner/jobs/${job.id}`,
        meta: { jobId: job.id, proUserId: p.userId },
      });
      if (created) sent++;
    }
  }

  // Other homeowners who favorited similar jobs get a "new matching job" nudge
  const similarFavs = await AppDataSource.getRepository(Favorite)
    .createQueryBuilder("f")
    .where("f.targetType = :t", { t: FavoriteTargetType.JOB })
    .andWhere("f.userId != :uid", { uid: homeownerId })
    .getMany();

  if (similarFavs.length) {
    const jobIds = [...new Set(similarFavs.map((f) => f.targetId))];
    const jobs = await AppDataSource.getRepository(Job)
      .createQueryBuilder("j")
      .where("j.id IN (:...ids)", { ids: jobIds })
      .getMany();
    const byId = Object.fromEntries(jobs.map((j) => [j.id, j]));
    const notified = new Set<string>();
    for (const f of similarFavs) {
      if (notified.has(f.userId)) continue;
      const ref = byId[f.targetId];
      if (!ref) continue;
      const catMatch = ref.category === job.category;
      const areaMatch =
        (job.area && ref.area && job.area.toLowerCase() === ref.area.toLowerCase()) ||
        (job.city && ref.city && job.city.toLowerCase() === ref.city.toLowerCase()) ||
        (job.area && ref.area && job.area.toLowerCase().includes(ref.area.toLowerCase()));
      if (!catMatch && !areaMatch) continue;
      notified.add(f.userId);
      const created = await createNotification({
        userId: f.userId,
        type: NotificationType.MATCH,
        title: "New matching job nearby",
        body: `Similar to a job you saved: "${job.title}" (${job.category}${job.area ? ` · ${job.area}` : ""})`,
        link: `/homeowner`,
        meta: { jobId: job.id, likedJobId: ref.id },
      });
      if (created) sent++;
    }
  }

  return sent;
}
