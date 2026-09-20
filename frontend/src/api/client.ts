/**
 * API client.
 * - The access token lives only in memory (never localStorage), so XSS can't read a long-lived credential.
 * - The refresh token is an httpOnly cookie; a 401 triggers one shared refresh and a single retry.
 * - In development Vite proxies /api to the backend, so requests are same-origin by default.
 */
const API_URL = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

export type Role = "ADMIN" | "HOMEOWNER" | "TRADESPERSON";

export type TextTemplate = { id: string; label: string; body: string; createdAt?: string };
export type NamedJobTemplate = {
  id: string;
  name: string;
  title: string;
  description?: string;
  category?: string;
  siteType?: string;
  cadence?: string;
  cadenceNote?: string;
  budgetMin?: string;
  budgetMax?: string;
  address?: string;
  city?: string;
  area?: string;
  pincode?: string;
  lat?: string;
  lng?: string;
  sourceJobId?: string;
  createdAt?: string;
};

export type User = {
  id: string;
  email: string;
  role: Role;
  name?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  emailVerified?: boolean;
  timezone?: string;
  notificationPrefs?: Record<string, boolean> | null;
  quoteViewNudgeHours?: number | null;
  createdAt?: string;
  // Saved templates (loaded separately from /api/auth/me/templates and merged in by AuthContext)
  inviteTemplates?: TextTemplate[] | null;
  counterTemplates?: TextTemplate[] | null;
  homeownerCounterTemplates?: TextTemplate[] | null;
  introTemplates?: TextTemplate[] | null;
  namedJobTemplates?: NamedJobTemplate[] | null;
};

export type TemplateKind = "invite" | "counter" | "homeownerCounter" | "intro" | "namedJob";

type SessionResponse = { token: string; expiresIn: number; user: User };

let accessToken: string | null = null;
let refreshing: Promise<SessionResponse | null> | null = null;
let onSessionLost: (() => void) | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function hasAccessToken() {
  return !!accessToken;
}

/** AuthContext registers this so a failed refresh logs the user out everywhere in the UI. */
export function onUnauthenticated(handler: (() => void) | null) {
  onSessionLost = handler;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: Record<string, unknown>;

  constructor(message: string, status: number, code?: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function parse(res: Response) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 200) };
  }
}

async function rawFetch(path: string, options: RequestInit) {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const sentToken = accessToken;
  if (sentToken) headers.set("Authorization", `Bearer ${sentToken}`);
  const res = await fetch(`${API_URL}${path}`, { ...options, headers, credentials: "include" });
  return { res, sentToken };
}

/** Exchange the refresh cookie for a new access token. Concurrent callers share one request. */
export function refreshSession(): Promise<SessionResponse | null> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch(`${API_URL}/api/auth/refresh`, { method: "POST", credentials: "include" });
        if (!res.ok) {
          accessToken = null;
          return null;
        }
        const data = (await res.json()) as SessionResponse;
        accessToken = data.token;
        return data;
      } catch {
        return null;
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

const NO_RETRY = ["/api/auth/login", "/api/auth/register", "/api/auth/refresh", "/api/auth/logout"];

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const first = await rawFetch(path, options);
  let res = first.res;
  if (res.status === 401 && !NO_RETRY.includes(path)) {
    // Another request may already have refreshed while this one was in flight.
    const alreadyRefreshed = !!accessToken && accessToken !== first.sentToken;
    const session = alreadyRefreshed || (await refreshSession());
    if (session) {
      res = (await rawFetch(path, options)).res;
    } else {
      onSessionLost?.();
    }
  }
  const data = await parse(res);
  if (!res.ok) {
    if (res.status === 403 && data.code === "ACCOUNT_SUSPENDED") onSessionLost?.();
    throw new ApiError(
      data.message || res.statusText || "Request failed",
      res.status,
      data.code,
      data && typeof data === "object" ? (data as Record<string, unknown>) : undefined
    );
  }
  return data as T;
}

export const isAbort = (err: unknown) => err instanceof DOMException && err.name === "AbortError";

// ---- auth endpoints ----

export async function login(email: string, password: string) {
  const r = await api<SessionResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  accessToken = r.token;
  return r;
}

export async function register(
  email: string,
  password: string,
  role: "HOMEOWNER" | "TRADESPERSON",
  extras?: { name?: string; phone?: string }
) {
  const r = await api<SessionResponse>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, role, ...extras }),
  });
  accessToken = r.token;
  return r;
}

export async function logout() {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } finally {
    accessToken = null;
  }
}

export function logoutEverywhere() {
  return api<{ ok: boolean }>("/api/auth/logout-all", { method: "POST" });
}

export function me() {
  return api<{ user: User }>("/api/auth/me");
}

export function updateMe(body: {
  name?: string | null;
  phone?: string | null;
  timezone?: string;
  notificationPrefs?: Record<string, boolean>;
  quoteViewNudgeHours?: number | null;
}) {
  return api<{ user: User }>("/api/auth/me", { method: "PATCH", body: JSON.stringify(body) });
}

export function uploadAvatar(file: File) {
  const fd = new FormData();
  fd.append("file", file);
  return api<{ user: User }>("/api/auth/me/avatar", { method: "POST", body: fd });
}

export async function changePassword(currentPassword: string, newPassword: string) {
  const r = await api<SessionResponse>("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  accessToken = r.token;
  return r;
}

export function forgotPassword(email: string) {
  return api<{ ok: boolean; message: string }>("/api/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function resetPassword(token: string, password: string) {
  return api<{ ok: boolean; message: string }>("/api/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, password }),
  });
}

export function verifyEmail(token: string) {
  return api<{ ok: boolean; message: string }>("/api/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export function resendVerification() {
  return api<{ ok: boolean; message: string }>("/api/auth/resend-verification", { method: "POST" });
}

export function deleteAccount(password: string) {
  return api<{ ok: boolean }>("/api/auth/me", { method: "DELETE", body: JSON.stringify({ password }) });
}

export function getSseTicket() {
  return api<{ ticket: string; expiresIn: number }>("/api/auth/sse-ticket", { method: "POST" });
}

export type TemplateBundle = {
  invite: TextTemplate[];
  counter: TextTemplate[];
  homeownerCounter: TextTemplate[];
  intro: TextTemplate[];
  namedJob: NamedJobTemplate[];
};

export function listTemplates() {
  return api<{ templates: TemplateBundle }>("/api/auth/me/templates");
}

export function saveTemplates(kind: TemplateKind, items: unknown[]) {
  return api<{ kind: TemplateKind; items: unknown[] }>(`/api/auth/me/templates/${kind}`, {
    method: "PUT",
    body: JSON.stringify({ items }),
  });
}

export function createReport(targetType: "job" | "user" | "message", targetId: string, reason: string) {
  return api<{ report: { id: string } }>("/api/reports", {
    method: "POST",
    body: JSON.stringify({ targetType, targetId, reason }),
  });
}

export function dashboardPath(role: Role): string {
  if (role === "ADMIN") return "/admin";
  if (role === "HOMEOWNER") return "/client";
  return "/professional";
}

export { API_URL };
