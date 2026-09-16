import { Request, Response } from "express";
import { AppDataSource } from "../data-source";
import { Favorite, FavoriteTargetType } from "../entities/Favorite";
import { Job } from "../entities/Job";
import { User, UserRole } from "../entities/User";
import { TradespersonProfile } from "../entities/TradespersonProfile";
import { slaMapForPros } from "../utils/proSlaBatch";

function normalizeTags(raw: unknown): string[] | null {
  if (raw == null) return null;
  let arr: string[] = [];
  if (Array.isArray(raw)) {
    arr = raw.map((t) => String(t));
  } else if (typeof raw === "string") {
    arr = raw.split(/[,#]/);
  } else {
    return null;
  }
  const cleaned = [
    ...new Set(
      arr
        .map((t) => t.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 32))
        .filter((t) => t.length > 0)
    ),
  ].slice(0, 12);
  return cleaned;
}

function serializeFavorite(
  f: Favorite,
  jobs: Record<string, unknown>,
  pros: Record<string, unknown>
) {
  return {
    id: f.id,
    targetType: f.targetType,
    targetId: f.targetId,
    notes: f.notes || null,
    tags: f.tags || [],
    createdAt: f.createdAt,
    job: f.targetType === FavoriteTargetType.JOB ? jobs[f.targetId] || null : undefined,
    pro: f.targetType === FavoriteTargetType.PRO ? pros[f.targetId] || null : undefined,
  };
}

export async function listFavorites(req: Request, res: Response) {
  const type = req.query.type ? String(req.query.type) : undefined;
  const qb = AppDataSource.getRepository(Favorite)
    .createQueryBuilder("f")
    .where("f.userId = :userId", { userId: req.user!.id })
    .orderBy("f.createdAt", "DESC");

  if (type === FavoriteTargetType.JOB || type === FavoriteTargetType.PRO) {
    qb.andWhere("f.targetType = :type", { type });
  }

  const favorites = await qb.getMany();
  const jobs: Record<string, unknown> = {};
  const pros: Record<string, unknown> = {};

  const jobIds = favorites.filter((f) => f.targetType === FavoriteTargetType.JOB).map((f) => f.targetId);
  const proIds = favorites.filter((f) => f.targetType === FavoriteTargetType.PRO).map((f) => f.targetId);

  if (jobIds.length) {
    const list = await AppDataSource.getRepository(Job)
      .createQueryBuilder("j")
      .where("j.id IN (:...ids)", { ids: jobIds })
      .getMany();
    for (const j of list) jobs[j.id] = j;
  }
  if (proIds.length) {
    const all = await AppDataSource.getRepository(TradespersonProfile)
      .createQueryBuilder("p")
      .leftJoinAndSelect("p.user", "user")
      .where("p.userId IN (:...ids)", { ids: proIds })
      .getMany();
    const slaMap = await slaMapForPros(proIds);
    for (const p of all) {
      pros[p.userId] = {
        userId: p.userId,
        name: p.user?.name,
        email: p.user?.email,
        skills: p.skills,
        city: p.city,
        averageRating: p.averageRating,
        reviewCount: p.reviewCount,
        verificationStatus: p.verificationStatus,
        bio: p.bio,
        hourlyRateMin: p.hourlyRateMin,
        hourlyRateMax: p.hourlyRateMax,
        responseSla: slaMap[p.userId] || null,
      };
    }
  }

  return res.json({
    favorites: favorites.map((f) => serializeFavorite(f, jobs, pros)),
  });
}

export async function addFavorite(req: Request, res: Response) {
  const { targetType, targetId, notes, tags } = req.body ?? {};
  if (
    targetType !== FavoriteTargetType.JOB &&
    targetType !== FavoriteTargetType.PRO
  ) {
    return res.status(400).json({ message: "targetType must be job or pro" });
  }
  if (!targetId) return res.status(400).json({ message: "targetId is required" });

  if (targetType === FavoriteTargetType.JOB) {
    const job = await AppDataSource.getRepository(Job).findOne({ where: { id: targetId } });
    if (!job) return res.status(404).json({ message: "Job not found" });
  } else {
    const user = await AppDataSource.getRepository(User).findOne({
      where: { id: targetId, role: UserRole.TRADESPERSON },
    });
    if (!user) return res.status(404).json({ message: "Tradesperson not found" });
  }

  const repo = AppDataSource.getRepository(Favorite);
  let fav = await repo.findOne({
    where: { userId: req.user!.id, targetType, targetId },
  });
  const tagList = normalizeTags(tags);
  const noteStr =
    notes != null ? String(notes).trim().slice(0, 500) || null : undefined;

  if (!fav) {
    fav = await repo.save(
      repo.create({
        userId: req.user!.id,
        targetType,
        targetId,
        notes: noteStr ?? null,
        tags: tagList ?? [],
      })
    );
  } else {
    if (noteStr !== undefined) fav.notes = noteStr;
    if (tagList !== null) fav.tags = tagList;
    fav = await repo.save(fav);
  }
  return res.status(201).json({ favorite: fav });
}

export async function updateFavorite(req: Request, res: Response) {
  const { targetType, targetId, notes, tags } = req.body ?? {};
  if (
    targetType !== FavoriteTargetType.JOB &&
    targetType !== FavoriteTargetType.PRO
  ) {
    return res.status(400).json({ message: "targetType must be job or pro" });
  }
  if (!targetId) return res.status(400).json({ message: "targetId is required" });

  const repo = AppDataSource.getRepository(Favorite);
  const fav = await repo.findOne({
    where: { userId: req.user!.id, targetType, targetId },
  });
  if (!fav) return res.status(404).json({ message: "Favorite not found", code: "NOT_FOUND" });

  if (notes !== undefined) {
    fav.notes = notes == null ? null : String(notes).trim().slice(0, 500) || null;
  }
  if (tags !== undefined) {
    fav.tags = normalizeTags(tags) || [];
  }
  await repo.save(fav);
  return res.json({ favorite: fav });
}

export async function removeFavorite(req: Request, res: Response) {
  const { targetType, targetId } = req.query;
  if (!targetType || !targetId) {
    return res.status(400).json({ message: "targetType and targetId required" });
  }
  await AppDataSource.getRepository(Favorite).delete({
    userId: req.user!.id,
    targetType: String(targetType) as FavoriteTargetType,
    targetId: String(targetId),
  });
  return res.json({ ok: true });
}
