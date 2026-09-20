import { NotificationType } from "../entities/Notification";

/** Every notification category a user can toggle (single list shared with the frontend). */
export const NOTIFICATION_TYPE_VALUES = Object.values(NotificationType) as string[];

export function isNotificationType(key: string): key is NotificationType {
  return NOTIFICATION_TYPE_VALUES.includes(key);
}
