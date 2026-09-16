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

  const bids = await AppDataSource.getRepository(Bid)
    .createQueryBuilder("b")
    .leftJoinAndSelect("b.job", "job")
    .where("b.tradespersonId IN (:...ids)", { ids: proIds })
    .orderBy("b.createdAt", "DESC")
    .take(Math.min(proIds.length * takePerPro, 2000))
    .getMany();

  const counts: Record<string, number> = {};
  for (const bid of bids) {
    const uid = bid.tradespersonId;
    counts[uid] = (counts[uid] || 0) + 1;
    if (counts[uid] > takePerPro) continue;
    const h = hoursBetween(bid.job?.createdAt, bid.createdAt);
    if (h == null) continue;
    out[uid].push({ hours: h, at: bid.createdAt });
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
