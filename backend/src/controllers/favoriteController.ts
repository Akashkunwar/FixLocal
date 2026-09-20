import type { Request, Response } from "express";
import { In } from "typeorm";
import { AppDataSource } from "../data-source";
import { Favorite, FavoriteTargetType } from "../entities/Favorite";
import { Job } from "../entities/Job";
import { User, UserRole } from "../entities/User";
import { TradespersonProfile } from "../entities/TradespersonProfile";
import { slaMapForPros } from "../utils/proSlaBatch";
import { jobAccess, loadJobContext, withAcceptedPro } from "../policies/jobPolicy";
import { viewer } from "./jobController";
import { toJob } from "../serializers";
import { forbidden, notFound } from "../http/errors";

const repo = () => AppDataSource.getRepository(Favorite);

function serialize(f: Favorite, extra: { job?: unknown; pro?: unknown }) {
  return {
    id: f.id,
    targetType: f.targetType,
    targetId: f.targetId,
    notes: f.notes || null,
    tags: f.tags || [],
    createdAt: f.createdAt,
    ...extra,
  };
}

export async function listFavorites(req: Request, res: Response) {
  const v = viewer(req);
  const type = req.valid.query.type as FavoriteTargetType | undefined;
  const favorites = await repo().find({
    where: type ? { userId: v.id, targetType: type } : { userId: v.id },
    order: { createdAt: "DESC" },
  });
  const jobIds = favorites.filter((f) => f.targetType === FavoriteTargetType.JOB).map((f) => f.targetId);
  const proIds = favorites.filter((f) => f.targetType === FavoriteTargetType.PRO).map((f) => f.targetId);

  const jobs = new Map<string, unknown>();
  if (jobIds.length) {
    for (const job of await AppDataSource.getRepository(Job).find({ where: { id: In(jobIds) } })) {
      const access = await jobAccess(await withAcceptedPro(job), v);
      jobs.set(job.id, access === "none" ? { id: job.id, title: job.title, status: job.status, unavailable: true } : toJob(job, access));
    }
  }
  const pros = new Map<string, unknown>();
  if (proIds.length) {
    const profiles = await AppDataSource.getRepository(TradespersonProfile).find({
      where: { userId: In(proIds) },
      relations: ["user"],
    });
    const sla = await slaMapForPros(proIds);
    for (const p of profiles) {
      if (p.user?.deletedAt) continue;
      pros.set(p.userId, {
        userId: p.userId,
        name: p.user?.name ?? null,
        skills: p.skills ?? null,
        city: p.city ?? null,
        averageRating: Number(p.averageRating || 0),
        reviewCount: p.reviewCount || 0,
        verificationStatus: p.verificationStatus,
        bio: p.bio ?? null,
        hourlyRateMin: p.hourlyRateMin ?? null,
        hourlyRateMax: p.hourlyRateMax ?? null,
        responseSla: sla[p.userId] || null,
      });
    }
  }
  return res.json({
    favorites: favorites.map((f) =>
      f.targetType === FavoriteTargetType.JOB
        ? serialize(f, { job: jobs.get(f.targetId) ?? null })
        : serialize(f, { pro: pros.get(f.targetId) ?? null })
    ),
  });
}

async function assertTarget(req: Request, targetType: FavoriteTargetType, targetId: string) {
  if (targetType === FavoriteTargetType.JOB) {
    const ctx = await loadJobContext(targetId);
    if ((await jobAccess(ctx, viewer(req))) === "none") throw notFound("Job not found");
    return;
  }
  const pro = await AppDataSource.getRepository(User).findOne({ where: { id: targetId, role: UserRole.TRADESPERSON } });
  if (!pro || pro.deletedAt) throw notFound("Professional not found");
  if (targetId === req.user!.id) throw forbidden("You can't save yourself");
}

export async function addFavorite(req: Request, res: Response) {
  const { targetType, targetId, notes, tags } = req.valid.body;
  await assertTarget(req, targetType, targetId);
  await repo()
    .createQueryBuilder()
    .insert()
    .into(Favorite)
    .values({ userId: req.user!.id, targetType, targetId, notes: notes ?? null, tags: tags ?? [] })
    .orIgnore()
    .execute();
  const fav = await repo().findOneOrFail({ where: { userId: req.user!.id, targetType, targetId } });
  if (notes !== undefined) fav.notes = notes;
  if (tags !== undefined) fav.tags = tags;
  await repo().save(fav);
  return res.status(201).json({ favorite: serialize(fav, {}) });
}

export async function updateFavorite(req: Request, res: Response) {
  const { targetType, targetId, notes, tags } = req.valid.body;
  const fav = await repo().findOne({ where: { userId: req.user!.id, targetType, targetId } });
  if (!fav) throw notFound("Favorite not found");
  if (notes !== undefined) fav.notes = notes;
  if (tags !== undefined) fav.tags = tags;
  await repo().save(fav);
  return res.json({ favorite: serialize(fav, {}) });
}

export async function removeFavorite(req: Request, res: Response) {
  const { targetType, targetId } = req.valid.query;
  await repo().delete({ userId: req.user!.id, targetType, targetId });
  return res.json({ ok: true });
}
