import { api } from "./client";

export type Notification = {
  id: string;
  type: string;
  title: string;
  body: string;
  link?: string | null;
  read: boolean;
  createdAt: string;
  meta?: Record<string, unknown> | null;
};

export function listNotifications(unread?: boolean) {
  const q = unread ? "?unread=1" : "";
  return api<{ notifications: Notification[]; unreadCount: number }>(
    `/api/notifications${q}`
  );
}

export function markNotificationRead(id: string) {
  return api(`/api/notifications/${id}/read`, { method: "PATCH" });
}

export function markAllNotificationsRead() {
  return api(`/api/notifications/read-all`, { method: "POST" });
}

export type ChatQuote = {
  amount: number;
  notes?: string;
  attachmentUrl?: string;
};

export type ChatMessage = {
  id: string;
  jobId: string;
  body: string;
  attachmentUrls?: string[];
  quote?: ChatQuote | null;
  createdAt: string;
  sender: { id: string; email: string; name?: string | null; role: string };
};

export function listMessages(jobId: string) {
  return api<{ messages: ChatMessage[] }>(`/api/messages/${jobId}`);
}

export function sendMessage(
  jobId: string,
  body: string,
  files: File[] = [],
  quote?: { amount: number; notes?: string; attachment?: File | null }
) {
  const needsForm =
    files.length > 0 || !!quote?.attachment || (quote && quote.amount > 0);
  if (needsForm) {
    const fd = new FormData();
    if (body) fd.append("body", body);
    files.slice(0, 4).forEach((f) => fd.append("attachments", f));
    if (quote && quote.amount > 0) {
      fd.append("quoteAmount", String(quote.amount));
      if (quote.notes) fd.append("quoteNotes", quote.notes);
      if (quote.attachment) fd.append("quoteAttachment", quote.attachment);
    }
    return api<{ message: ChatMessage }>(`/api/messages/${jobId}`, {
      method: "POST",
      body: fd,
    });
  }
  return api<{ message: ChatMessage }>(`/api/messages/${jobId}`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export function createReview(jobId: string, rating: number, comment?: string) {
  return api(`/api/reviews`, {
    method: "POST",
    body: JSON.stringify({ jobId, rating, comment }),
  });
}

export function getJobReview(jobId: string) {
  return api<{
    review: {
      id: string;
      rating: number;
      comment?: string;
      createdAt: string;
    } | null;
  }>(`/api/reviews/job/${jobId}`);
}

export type FavoriteItem = {
  id: string;
  targetType: string;
  targetId: string;
  notes?: string | null;
  tags?: string[];
  createdAt?: string;
  job?: unknown;
  pro?: {
    userId?: string;
    name?: string | null;
    email?: string;
    skills?: string | null;
    city?: string | null;
    averageRating?: number;
    reviewCount?: number;
    verificationStatus?: string;
    responseSla?: unknown;
  } | null;
};

export function listFavorites(type?: "job" | "pro") {
  const q = type ? `?type=${type}` : "";
  return api<{ favorites: FavoriteItem[] }>(`/api/favorites${q}`);
}

export function addFavorite(
  targetType: "job" | "pro",
  targetId: string,
  extra?: { notes?: string; tags?: string[] }
) {
  return api(`/api/favorites`, {
    method: "POST",
    body: JSON.stringify({ targetType, targetId, ...extra }),
  });
}

export function updateFavorite(
  targetType: "job" | "pro",
  targetId: string,
  body: { notes?: string | null; tags?: string[] }
) {
  return api<{ favorite: FavoriteItem }>(`/api/favorites`, {
    method: "PATCH",
    body: JSON.stringify({ targetType, targetId, ...body }),
  });
}

export function removeFavorite(targetType: "job" | "pro", targetId: string) {
  return api(
    `/api/favorites?targetType=${targetType}&targetId=${encodeURIComponent(targetId)}`,
    { method: "DELETE" }
  );
}
