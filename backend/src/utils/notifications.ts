import { AppDataSource } from "../data-source";
import { Notification, NotificationType } from "../entities/Notification";
import { User } from "../entities/User";
import { publishNotification } from "./sse";

const DEFAULT_PREFS: Record<string, boolean> = {
  [NotificationType.NEW_BID]: true,
  [NotificationType.BID_ACCEPTED]: true,
  [NotificationType.BID_REJECTED]: true,
  [NotificationType.JOB_STATUS]: true,
  [NotificationType.DISPUTE]: true,
  [NotificationType.MESSAGE]: true,
  [NotificationType.REVIEW]: true,
  [NotificationType.SYSTEM]: true,
  [NotificationType.PRO_AVAILABLE]: true,
  [NotificationType.MATCH]: true,
};

export function isNotificationEnabled(
  prefs: Record<string, boolean> | null | undefined,
  type: NotificationType | string
): boolean {
  if (!prefs) return true;
  if (Object.prototype.hasOwnProperty.call(prefs, type)) {
    return prefs[type] !== false;
  }
  return DEFAULT_PREFS[type] !== false;
}

export async function createNotification(input: {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
  meta?: Record<string, unknown>;
}) {
  const user = await AppDataSource.getRepository(User).findOne({
    where: { id: input.userId },
  });
  if (user && !isNotificationEnabled(user.notificationPrefs || undefined, input.type)) {
    return null;
  }

  const repo = AppDataSource.getRepository(Notification);
  const n = repo.create({
    userId: input.userId,
    type: input.type,
    title: input.title,
    body: input.body,
    link: input.link,
    meta: input.meta,
    read: false,
  });
  const saved = await repo.save(n);
  try {
    publishNotification(input.userId, {
      notification: saved,
      unreadBump: true,
    });
  } catch {
    /* SSE optional */
  }
  return saved;
}

export { DEFAULT_PREFS };
