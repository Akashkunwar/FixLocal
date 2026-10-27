import { In, type EntityManager } from "typeorm";
import { AppDataSource } from "../data-source";
import { Notification, NotificationType } from "../entities/Notification";
import { User } from "../entities/User";
import { publishNotification } from "./sse";
import { toNotification } from "../serializers";
import { logger } from "../logger";
import { appLink, sendMail } from "../services/mailer";

/** Notification types that also go out by email (when the user hasn't turned email off). */
export const EMAIL_NOTIFICATION_TYPES: ReadonlySet<string> = new Set([
  NotificationType.NEW_BID,
  NotificationType.BID_ACCEPTED,
  NotificationType.JOB_STATUS,
  NotificationType.DISPUTE,
]);

/** The account-level email switch lives in notificationPrefs under this key (default on). */
export const EMAIL_PREF_KEY = "email";

export function wantsEmail(prefs: Record<string, boolean> | null | undefined) {
  return prefs?.[EMAIL_PREF_KEY] !== false;
}

export type NotificationInput = {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
  meta?: Record<string, unknown>;
};

export function isNotificationEnabled(
  prefs: Record<string, boolean> | null | undefined,
  type: NotificationType | string
): boolean {
  if (!prefs || !Object.hasOwn(prefs, type)) return true;
  return prefs[type] !== false;
}

/**
 * Insert many notifications with one preferences query and one insert.
 * Returns the saved rows keyed by userId (missing when the user turned that type off).
 */
export async function createNotifications(
  inputs: NotificationInput[],
  manager: EntityManager = AppDataSource.manager
): Promise<Map<string, Notification>> {
  const out = new Map<string, Notification>();
  if (!inputs.length) return out;
  const userIds = [...new Set(inputs.map((i) => i.userId))];
  const users = await manager.find(User, {
    where: { id: In(userIds) },
    select: { id: true, notificationPrefs: true, deletedAt: true, email: true, emailVerifiedAt: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  const rows = inputs
    .filter((i) => {
      const u = byId.get(i.userId);
      return u && !u.deletedAt && isNotificationEnabled(u.notificationPrefs, i.type);
    })
    .map((i) =>
      manager.create(Notification, {
        userId: i.userId,
        type: i.type,
        title: i.title.slice(0, 255),
        body: i.body,
        link: i.link,
        meta: i.meta,
        read: false,
      })
    );
  if (!rows.length) return out;
  // One multi-row INSERT is atomic on its own; skip TypeORM's extra BEGIN/COMMIT round trips.
  const saved = await manager.save(rows, { transaction: false });
  for (const n of saved) {
    out.set(n.userId, n);
    const u = byId.get(n.userId);
    if (u?.emailVerifiedAt && EMAIL_NOTIFICATION_TYPES.has(n.type) && wantsEmail(u.notificationPrefs)) {
      void sendMail({
        to: u.email,
        subject: `FixLocal: ${n.title}`.slice(0, 200),
        text: `${n.body}\n\n${n.link ? `Open FixLocal: ${appLink(n.link)}\n\n` : ""}You can turn these emails off in Settings: ${appLink("/settings")}`,
      });
    }
    try {
      await publishNotification(n.userId, { notification: toNotification(n), unreadBump: true });
    } catch (err) {
      logger.warn({ err }, "notification push failed");
    }
  }
  return out;
}

export async function createNotification(input: NotificationInput, manager?: EntityManager) {
  const map = await createNotifications([input], manager);
  return map.get(input.userId) ?? null;
}
