import { Request, Response } from "express";
import { param } from "../utils/params";
import { AppDataSource } from "../data-source";
import { Notification } from "../entities/Notification";
import { sseInit, sseSubscribe } from "../utils/sse";

export async function listNotifications(req: Request, res: Response) {
  const unreadOnly = String(req.query.unread || "") === "1";
  const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || "30"), 10) || 30));

  const qb = AppDataSource.getRepository(Notification)
    .createQueryBuilder("n")
    .where("n.userId = :userId", { userId: req.user!.id })
    .orderBy("n.createdAt", "DESC")
    .take(limit);

  if (unreadOnly) qb.andWhere("n.read = false");

  const [notifications, total] = await qb.getManyAndCount();
  const unreadCount = await AppDataSource.getRepository(Notification).count({
    where: { userId: req.user!.id, read: false },
  });

  return res.json({ notifications, unreadCount, total });
}

export async function markNotificationRead(req: Request, res: Response) {
  const repo = AppDataSource.getRepository(Notification);
  const n = await repo.findOne({ where: { id: param(req, "id"), userId: req.user!.id } });
  if (!n) return res.status(404).json({ message: "Not found", code: "NOT_FOUND" });
  n.read = true;
  await repo.save(n);
  return res.json({ notification: n });
}

export async function markAllNotificationsRead(req: Request, res: Response) {
  await AppDataSource.getRepository(Notification)
    .createQueryBuilder()
    .update(Notification)
    .set({ read: true })
    .where("userId = :userId AND read = false", { userId: req.user!.id })
    .execute();
  return res.json({ ok: true });
}

/** SSE stream for the notification bell. Auth via Bearer or ?token=. */
export async function streamNotifications(req: Request, res: Response) {
  sseInit(res);
  sseSubscribe(res, req.user!.id);
  // Keep request open; heartbeat handled in sseSubscribe
}
