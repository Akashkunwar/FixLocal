import type { Request, Response } from "express";
import { AppDataSource } from "../data-source";
import { Notification } from "../entities/Notification";
import { JobInvite } from "../entities/JobInvite";
import { openStream } from "../utils/sse";
import { toNotification } from "../serializers";
import { notFound } from "../http/errors";

const repo = () => AppDataSource.getRepository(Notification);

export async function listNotifications(req: Request, res: Response) {
  const { unread, limit, before } = req.valid.query;
  const qb = repo()
    .createQueryBuilder("n")
    .where("n.userId = :userId", { userId: req.user!.id })
    .orderBy("n.createdAt", "DESC")
    .take(limit ?? 30);
  if (unread) qb.andWhere("n.read = false");
  if (before) qb.andWhere("n.createdAt < :before", { before });
  const [rows, total] = await qb.getManyAndCount();
  const unreadCount = await repo().count({ where: { userId: req.user!.id, read: false } });
  return res.json({ notifications: rows.map(toNotification), unreadCount, total });
}

export async function markNotificationRead(req: Request, res: Response) {
  const n = await repo().findOne({ where: { id: req.valid.params.id, userId: req.user!.id } });
  if (!n) throw notFound("Notification not found");
  if (!n.read) {
    await repo().update({ id: n.id }, { read: true });
    n.read = true;
    // Opening an invite notification counts as a click for invite analytics.
    const inviteId = typeof n.meta?.inviteId === "string" ? n.meta.inviteId : null;
    if (inviteId) {
      await AppDataSource.getRepository(JobInvite)
        .createQueryBuilder()
        .update()
        .set({ clickedAt: () => `COALESCE("clickedAt", now())`, openedAt: () => `COALESCE("openedAt", now())` })
        .where("id = :id AND tradespersonId = :uid", { id: inviteId, uid: req.user!.id })
        .execute();
    }
  }
  return res.json({ notification: toNotification(n) });
}

export async function markAllNotificationsRead(req: Request, res: Response) {
  await repo()
    .createQueryBuilder()
    .update(Notification)
    .set({ read: true })
    .where(`"userId" = :userId AND "read" = false`, { userId: req.user!.id })
    .execute();
  return res.json({ ok: true });
}

export async function streamNotifications(req: Request, res: Response) {
  openStream(res, req.user!.id);
}
