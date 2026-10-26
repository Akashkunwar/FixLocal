import type { Request, Response } from "express";
import { AppDataSource } from "../data-source";
import { JobAlert } from "../entities/JobAlert";
import { badRequest, conflict, notFound } from "../http/errors";
import { MAX_ALERTS_PER_PRO, previewMatches } from "../utils/jobAlerts";

const repo = () => AppDataSource.getRepository(JobAlert);

export function toJobAlert(a: JobAlert) {
  return {
    id: a.id,
    name: a.name,
    categories: a.categories || [],
    city: a.city ?? null,
    area: a.area ?? null,
    lat: a.lat ?? null,
    lng: a.lng ?? null,
    radiusKm: a.radiusKm ?? null,
    minBudget: a.minBudget ?? null,
    siteType: a.siteType ?? null,
    active: a.active,
    matchCount: a.matchCount,
    lastMatchedAt: a.lastMatchedAt ?? null,
    createdAt: a.createdAt,
  };
}

async function mine(req: Request) {
  const a = await repo().findOne({ where: { id: req.valid.params.id, userId: req.user!.id } });
  if (!a) throw notFound("Job alert not found");
  return a;
}

export async function listJobAlerts(req: Request, res: Response) {
  const rows = await repo().find({ where: { userId: req.user!.id }, order: { createdAt: "DESC" } });
  return res.json({ alerts: rows.map(toJobAlert), max: MAX_ALERTS_PER_PRO });
}

export async function createJobAlert(req: Request, res: Response) {
  const body = req.valid.body;
  // Serialise per pro so two quick clicks can't both pass the cap.
  const saved = await AppDataSource.transaction(async (m) => {
    await m.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`job-alerts:${req.user!.id}`]);
    const count = await m.count(JobAlert, { where: { userId: req.user!.id } });
    if (count >= MAX_ALERTS_PER_PRO) {
      throw conflict(`You can keep up to ${MAX_ALERTS_PER_PRO} job alerts. Delete one first.`, "ALERT_LIMIT");
    }
    return m.save(m.create(JobAlert, { ...body, categories: body.categories ?? [], userId: req.user!.id }));
  });
  return res.status(201).json({ alert: toJobAlert(saved) });
}

export async function updateJobAlert(req: Request, res: Response) {
  const a = await mine(req);
  Object.assign(a, Object.fromEntries(Object.entries(req.valid.body).filter(([, v]) => v !== undefined)));
  if (a.radiusKm != null && (a.lat == null || a.lng == null)) {
    throw badRequest("A radius needs a map location (lat and lng)", "VALIDATION_ERROR");
  }
  return res.json({ alert: toJobAlert(await repo().save(a)) });
}

export async function deleteJobAlert(req: Request, res: Response) {
  const a = await mine(req);
  await repo().delete({ id: a.id });
  return res.json({ ok: true });
}

export async function previewJobAlert(req: Request, res: Response) {
  const body = req.valid.body;
  return res.json(await previewMatches({ ...body, categories: body.categories ?? [] }, req.user!.id));
}
