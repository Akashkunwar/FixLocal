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

export function listNotifications(unread?: boolean, signal?: AbortSignal) {
  const q = unread ? "?unread=1" : "";
  return api<{ notifications: Notification[]; unreadCount: number }>(`/api/notifications${q}`, { signal });
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
  threadTradespersonId: string;
  body: string;
  attachmentUrls?: string[];
  quote?: ChatQuote | null;
  createdAt: string;
  sender: { id: string; email?: string; name?: string | null; role: string };
};

export type ChatThread = {
  tradespersonId: string;
  name: string | null;
  hired: boolean;
  access: "write" | "read" | "none";
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unread: number;
  total: number;
};

const threadQuery = (proId?: string | null, extra: Record<string, string> = {}) => {
  const q = new URLSearchParams(extra);
  if (proId) q.set("pro", proId);
  const s = q.toString();
  return s ? `?${s}` : "";
};

export function listChatThreads(jobId: string) {
  return api<{ threads: ChatThread[] }>(`/api/messages/${jobId}/threads`);
}

export function listMessages(jobId: string, proId?: string | null, signal?: AbortSignal) {
  return api<{ messages: ChatMessage[]; threadTradespersonId: string; canSend: boolean; hasMore: boolean; nextBefore: string | null }>(
    `/api/messages/${jobId}${threadQuery(proId, { limit: "100" })}`,
    { signal }
  );
}

export function markThreadRead(jobId: string, proId?: string | null) {
  return api<{ ok: boolean }>(`/api/messages/${jobId}/read${threadQuery(proId)}`, { method: "POST" });
}

export function messageStreamPath(jobId: string, proId?: string | null) {
  return `/api/messages/${jobId}/stream${threadQuery(proId)}`;
}

export function sendMessage(
  jobId: string,
  body: string,
  files: File[] = [],
  quote?: { amount: number; notes?: string; attachment?: File | null },
  proId?: string | null
) {
  const url = `/api/messages/${jobId}${threadQuery(proId)}`;
  const needsForm = files.length > 0 || !!quote?.attachment || (quote && quote.amount > 0);
  if (needsForm) {
    const fd = new FormData();
    if (body) fd.append("body", body);
    files.slice(0, 4).forEach((f) => fd.append("attachments", f));
    if (quote && quote.amount > 0) {
      fd.append("quoteAmount", String(quote.amount));
      if (quote.notes) fd.append("quoteNotes", quote.notes);
      if (quote.attachment) fd.append("quoteAttachment", quote.attachment);
    }
    return api<{ message: ChatMessage }>(url, { method: "POST", body: fd });
  }
  return api<{ message: ChatMessage }>(url, { method: "POST", body: JSON.stringify({ body }) });
}

export function createReview(jobId: string, rating: number, comment?: string) {
  return api(`/api/reviews`, {
    method: "POST",
    body: JSON.stringify({ jobId, rating, comment }),
  });
}

export type JobReview = {
  id: string;
  rating: number;
  comment?: string | null;
  createdAt: string;
  direction: "client_to_pro" | "pro_to_client";
  reviewerName?: string;
};

export function getJobReview(jobId: string, signal?: AbortSignal) {
  return api<{ review: JobReview | null; proReview: JobReview | null }>(`/api/reviews/job/${jobId}`, { signal });
}

export function getClientReviews(userId: string) {
  return api<{ averageRating: number; reviewCount: number; reviews: JobReview[] }>(`/api/reviews/client/${userId}`);
}

export type FavoriteItem = {
  id: string;
  targetType: string;
  targetId: string;
  notes?: string | null;
  tags?: string[];
  createdAt?: string;
  /** `unavailable` jobs were awarded to someone else or closed; only the title and status remain visible. */
  job?: { id: string; title: string; status: string; unavailable?: boolean } | null;
  pro?: {
    userId?: string;
    name?: string | null;
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
