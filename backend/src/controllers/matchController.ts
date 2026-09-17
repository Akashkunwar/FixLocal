import type { Request, Response } from "express";
import { In } from "typeorm";
import { AppDataSource } from "../data-source";
import { Job } from "../entities/Job";
import { Favorite, FavoriteTargetType } from "../entities/Favorite";
import { TradespersonProfile, VerificationStatus } from "../entities/TradespersonProfile";
import { scoreProForJob, type ScoreablePro } from "../utils/matchScore";
import { getMatchWeights, getHeatWeight, computeHeatBoost } from "../utils/matchWeights";
import { buildResponseSla } from "../utils/responseSla";
import { loadJobToBidSamples } from "../utils/proSlaBatch";
import {
  buildAvailabilityHeat,
  DEFAULT_SHORTLIST_INVITE_MIN_HEAT,
  shortlistInviteBlockedByHeat,
} from "../utils/availabilityHeat";
import { categoryKeywords, tagMatchesCategory } from "../domain/categories";
import { mean } from "../domain/analytics";
import { assertOwnerOrAdmin, loadJobContext } from "../policies/jobPolicy";
import { viewer } from "./jobController";

const CANDIDATE_LIMIT = 200;

function keywordRegex(category: string): string {
  const words = categoryKeywords(category).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"));
  return `\\m(${words.join("|")})\\M`;
}

/** Verified, active pros that plausibly fit the job, found in SQL rather than scanning everyone. */
export async function candidatePros(job: Job, limit = CANDIDATE_LIMIT): Promise<TradespersonProfile[]> {
  const qb = AppDataSource.getRepository(TradespersonProfile)
    .createQueryBuilder("p")
    .innerJoinAndSelect("p.user", "user")
    .where("p.verificationStatus = :verified", { verified: VerificationStatus.VERIFIED })
    .andWhere("user.isSuspended = false AND user.deletedAt IS NULL");
  const fit: string[] = ["p.skills ~* :kw"];
  qb.setParameter("kw", keywordRegex(job.category));
  if (job.city) {
    fit.push("p.city ILIKE :city", "p.serviceAreas ILIKE :cityLike");
    qb.setParameters({ city: job.city, cityLike: `%${job.city}%` });
  }
  if (job.lat != null && job.lng != null) {
    fit.push("(p.lat BETWEEN :minLat AND :maxLat AND p.lng BETWEEN :minLng AND :maxLng)");
    qb.setParameters({ minLat: job.lat - 0.45, maxLat: job.lat + 0.45, minLng: job.lng - 0.5, maxLng: job.lng + 0.5 });
  }
  qb.andWhere(`(${fit.join(" OR ")})`)
    .orderBy("p.averageRating", "DESC")
    .addOrderBy("p.reviewCount", "DESC")
    .take(limit);
  return qb.getMany();
}

async function responseHours(proIds: string[]) {
  const samples = await loadJobToBidSamples(proIds, 40);
  const hours = new Map<string, number[]>();
  for (const id of proIds) hours.set(id, (samples[id] || []).map((s) => s.hours));
  return hours;
}

function scoreable(p: TradespersonProfile, avgResponseHours: number | null): ScoreablePro {
  return {
    userId: p.userId,
    skills: p.skills,
    city: p.city,
    serviceAreas: p.serviceAreas,
    lat: p.lat,
    lng: p.lng,
    averageRating: Number(p.averageRating || 0),
    reviewCount: p.reviewCount || 0,
    avgResponseHours,
    name: p.user?.name || null,
  };
}

export async function suggestedProsForJob(req: Request, res: Response) {
  const ctx = await loadJobContext(req.valid.params.id);
  assertOwnerOrAdmin(ctx, viewer(req));
  const job = ctx.job;
  const limit = req.valid.query.limit ?? 5;
  const pros = await candidatePros(job);
  const jobCat = String(job.category).toLowerCase();
  const eligible = pros.filter(
    (p) => !(p.notInterestedCategories || []).map((c) => String(c).toLowerCase()).includes(jobCat)
  );
  const hours = await responseHours(eligible.map((p) => p.userId));
  const weights = await getMatchWeights();
  const heatWeight = await getHeatWeight();

  const scored = eligible.map((p) => {
    const h = hours.get(p.userId) || [];
    const breakdown = scoreProForJob(job, scoreable(p, mean(h)), weights);
    const availabilityHeat = buildAvailabilityHeat(p.weeklyAvailability, p.blockedDates, p.user?.timezone);
    const heatBoost = computeHeatBoost(availabilityHeat, heatWeight);
    return {
      userId: p.userId,
      name: p.user?.name || null,
      city: p.city || null,
      skills: p.skills || null,
      averageRating: Number(p.averageRating || 0),
      reviewCount: p.reviewCount || 0,
      score: breakdown.total,
      heatBoost,
      rankedScore: Math.round((breakdown.total + heatBoost) * 10) / 10,
      breakdown,
      responseSla: buildResponseSla({ jobHours: h }),
      availabilityHeat,
    };
  });
  scored.sort((a, b) => b.rankedScore - a.rankedScore || b.score - a.score);

  return res.json({
    jobId: job.id,
    category: job.category,
    suggestions: scored.slice(0, limit),
    skippedNotInterested: pros.length - eligible.length,
    weights,
    heatWeight,
    heatAware: true,
  });
}

export async function shortlistRankedForJob(req: Request, res: Response) {
  const ctx = await loadJobContext(req.valid.params.id);
  assertOwnerOrAdmin(ctx, viewer(req));
  const job = ctx.job;
  const weights = await getMatchWeights();
  const favs = await AppDataSource.getRepository(Favorite).find({
    where: { userId: job.homeownerId, targetType: FavoriteTargetType.PRO },
    order: { createdAt: "DESC" },
  });
  if (!favs.length) {
    return res.json({ jobId: job.id, category: job.category, shortlist: [], weights, shortlistInviteMinHeat: DEFAULT_SHORTLIST_INVITE_MIN_HEAT });
  }
  const proIds = favs.map((f) => f.targetId);
  const profiles = await AppDataSource.getRepository(TradespersonProfile).find({
    where: { userId: In(proIds) },
    relations: ["user"],
  });
  const byId = new Map(profiles.map((p) => [p.userId, p]));
  const hours = await responseHours(proIds);

  const ranked = favs.map((f) => {
    const p = byId.get(f.targetId);
    const tags = Array.isArray(f.tags) ? f.tags.map(String) : [];
    const tagHits = tags.filter((t) => tagMatchesCategory(t, job.category));
    const tagBoost = tagHits.length ? Math.min(12, 4 + tagHits.length * 3) : 0;
    const h = hours.get(f.targetId) || [];
    const breakdown = p
      ? { ...scoreProForJob(job, scoreable(p, mean(h)), weights), weights }
      : { skills: 0, rating: 0, response: 0, distance: 0, total: 0, skillHits: [], distanceKm: null, avgResponseHours: null, weights };
    const heat = p
      ? buildAvailabilityHeat(p.weeklyAvailability, p.blockedDates, p.user?.timezone)
      : { days: [], score: 0, totalHours: 0, clean: false };
    const gate = shortlistInviteBlockedByHeat(heat, DEFAULT_SHORTLIST_INVITE_MIN_HEAT);
    return {
      userId: f.targetId,
      name: p?.user?.name || null,
      city: p?.city || null,
      skills: p?.skills || null,
      averageRating: Number(p?.averageRating || 0),
      reviewCount: p?.reviewCount || 0,
      verificationStatus: p?.verificationStatus || null,
      notes: f.notes || null,
      tags,
      tagHits,
      tagBoost,
      score: breakdown.total,
      smartScore: Math.round((breakdown.total + tagBoost) * 10) / 10,
      breakdown,
      responseSla: buildResponseSla({ jobHours: h }),
      availabilityHeat: heat,
      shortlistInviteMinHeat: DEFAULT_SHORTLIST_INVITE_MIN_HEAT,
      inviteBlockedByHeat: gate.blocked,
      inviteHeatReason: gate.blocked ? gate.reason ?? null : null,
    };
  });
  ranked.sort((a, b) => b.smartScore - a.smartScore || b.score - a.score);
  return res.json({
    jobId: job.id,
    category: job.category,
    shortlist: ranked,
    weights,
    shortlistInviteMinHeat: DEFAULT_SHORTLIST_INVITE_MIN_HEAT,
  });
}
