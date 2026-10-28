/** Batch job→bid response hours / SLA for many pros (browse, bid compare, notify). */

import { AppDataSource } from "../data-source";
import { Bid } from "../entities/Bid";
import {
  buildResponseSla,
  buildSlaTrends,
  hoursBetween,
  ResponseSlaBadge,
  SlaTrends,
} from "./responseSla";

export type ProSlaSample = { hours: number; at: Date };

export async function loadJobToBidSamples(
  proIds: string[],
  takePerPro = 80
): Promise<Record<string, ProSlaSample[]>> {
  const out: Record<string, ProSlaSample[]> = {};
  if (!proIds.length) return out;
  for (const id of proIds) out[id] = [];

  // Each pro's latest bids, ranked per pro: a busy pro can't crowd quieter pros out of a shared LIMIT.
  const rows: { tradespersonId: string; bidAt: Date; jobAt: Date | null }[] = await AppDataSource.query(
    `SELECT r."tradespersonId", r."bidAt", r."jobAt" FROM (
       SELECT b."tradespersonId", b."createdAt" AS "bidAt", j."createdAt" AS "jobAt",
              ROW_NUMBER() OVER (PARTITION BY b."tradespersonId" ORDER BY b."createdAt" DESC) AS n
         FROM "bids" b LEFT JOIN "jobs" j ON j."id" = b."jobId"
        WHERE b."tradespersonId" = ANY($1)) r
      WHERE r.n <= $2
      ORDER BY r."bidAt" DESC`,
    [proIds, takePerPro]
  );
  for (const r of rows) {
    const bidAt = new Date(r.bidAt);
    const h = hoursBetween(r.jobAt ? new Date(r.jobAt) : null, bidAt);
    if (h == null) continue;
    out[r.tradespersonId].push({ hours: h, at: bidAt });
  }
  return out;
}

export async function slaMapForPros(
  proIds: string[]
): Promise<Record<string, ResponseSlaBadge>> {
  const samples = await loadJobToBidSamples(proIds);
  const map: Record<string, ResponseSlaBadge> = {};
  for (const id of proIds) {
    map[id] = buildResponseSla({ jobHours: (samples[id] || []).map((s) => s.hours) });
  }
  return map;
}

export async function slaTrendsForPros(
  proIds: string[]
): Promise<Record<string, SlaTrends>> {
  const samples = await loadJobToBidSamples(proIds);
  const map: Record<string, SlaTrends> = {};
  for (const id of proIds) {
    map[id] = buildSlaTrends(samples[id] || []);
  }
  return map;
}

/** Overall SLA badge for one pro from job→bid history (optionally excluding a bid id). */
export async function computeProOverallSla(
  proUserId: string,
  excludeBidId?: string
): Promise<ResponseSlaBadge> {
  const qb = AppDataSource.getRepository(Bid)
    .createQueryBuilder("b")
    .leftJoinAndSelect("b.job", "job")
    .where("b.tradespersonId = :uid", { uid: proUserId })
    .orderBy("b.createdAt", "DESC")
    .take(80);
  if (excludeBidId) qb.andWhere("b.id != :ex", { ex: excludeBidId });
  const bids = await qb.getMany();
  const hours: number[] = [];
  for (const bid of bids) {
    const h = hoursBetween(bid.job?.createdAt, bid.createdAt);
    if (h != null) hours.push(h);
  }
  return buildResponseSla({ jobHours: hours });
}
