import { In } from "typeorm";
import type { Request, Response } from "express";
import { AppDataSource } from "../data-source";
import { Report } from "../entities/Report";
import { Job } from "../entities/Job";
import { User, UserRole } from "../entities/User";
import { Message } from "../entities/Message";
import { NotificationType } from "../entities/Notification";
import { AuditAction, writeAudit } from "../utils/audit";
import { createNotifications } from "../utils/notifications";
import { conflict, notFound } from "../http/errors";

const reports = () => AppDataSource.getRepository(Report);

async function targetExists(type: string, id: string) {
  if (type === "job") return AppDataSource.getRepository(Job).exists({ where: { id } });
  if (type === "user") return AppDataSource.getRepository(User).exists({ where: { id } });
  return AppDataSource.getRepository(Message).exists({ where: { id } });
}

export async function createReport(req: Request, res: Response) {
  const { targetType, targetId, reason } = req.valid.body;
  if (!(await targetExists(targetType, targetId))) throw notFound("What you're reporting no longer exists");
  const duplicate = await reports().exists({
    where: { reporterId: req.user!.id, targetType, targetId, status: "open" },
  });
  if (duplicate) throw conflict("You already reported this; an admin will review it", "ALREADY_REPORTED");
  const report = await reports().save(reports().create({ reporterId: req.user!.id, targetType, targetId, reason }));
  const admins = await AppDataSource.getRepository(User).find({ where: { role: UserRole.ADMIN }, select: { id: true } });
  await createNotifications(
    admins.map((a) => ({
      userId: a.id,
      type: NotificationType.SYSTEM,
      title: "New report",
      body: `A ${targetType} was reported: ${reason.slice(0, 120)}`,
      link: "/admin/reports",
      meta: { reportId: report.id, targetType, targetId },
    }))
  );
  return res.status(201).json({ report: { id: report.id, status: report.status, createdAt: report.createdAt } });
}

export async function listReports(req: Request, res: Response) {
  const { status, page = 1, limit = 50 } = req.valid.query;
  const [rows, total] = await reports().findAndCount({
    where: status ? { status } : {},
    order: { createdAt: "DESC" },
    skip: (page - 1) * limit,
    take: limit,
  });
  const reporterIds = [...new Set(rows.map((r) => r.reporterId))];
  const people = reporterIds.length
    ? await AppDataSource.getRepository(User).find({ where: { id: In(reporterIds) } })
    : [];
  const byId = new Map(people.map((u) => [u.id, u]));
  return res.json({
    total,
    reports: rows.map((r) => ({
      ...r,
      reporter: byId.has(r.reporterId)
        ? { id: r.reporterId, name: byId.get(r.reporterId)!.name ?? null, email: byId.get(r.reporterId)!.email }
        : null,
    })),
  });
}

export async function resolveReport(req: Request, res: Response) {
  const { status, resolutionNote } = req.valid.body;
  const result = await reports().update(
    { id: req.valid.params.id, status: "open" },
    { status, resolutionNote: resolutionNote || null, resolvedByUserId: req.user!.id, resolvedAt: new Date() }
  );
  if (!result.affected) throw conflict("This report is already closed or doesn't exist", "ALREADY_RESOLVED");
  const report = await reports().findOneOrFail({ where: { id: req.valid.params.id } });
  await writeAudit({
    actorUserId: req.user!.id,
    actorEmail: req.user!.email,
    action: AuditAction.REPORT_RESOLVE,
    targetType: report.targetType,
    targetId: report.targetId,
    summary: `Report ${status}: ${report.reason.slice(0, 120)}`,
    meta: { reportId: report.id, note: resolutionNote || null },
  });
  return res.json({ report });
}
