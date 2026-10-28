/**
 * API client.
 * - The access token lives only in memory (never localStorage), so XSS can't read a long-lived credential.
 * - The refresh token is an httpOnly cookie; a 401 triggers one shared refresh and a single retry.
 * - In development Vite proxies /api to the backend, so requests are same-origin by default.
 */
import { runExclusiveRefresh } from "./refreshLock";

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
  phoneVerified?: boolean;
  smsOptIn?: boolean;
  whatsappOptIn?: boolean;
  language?: "en" | "hi";
  /** Optional business details printed on payment summaries. */
  businessName?: string | null;
  gstin?: string | null;
  avatarUrl?: string | null;
  emailVerified?: boolean;
  /** False until the user accepts the current Terms of Service / Privacy Policy. */
  termsAccepted?: boolean;
  emailNotifications?: boolean;
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
  if (token) setSessionHint(true);
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
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...options, headers, credentials: "include" });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError("Can't reach FixLocal right now. Check your connection and try again.", 0, "NETWORK_ERROR");
  }
  return { res, sentToken };
}

/** Thrown when the refresh endpoint can't be reached (network, 429, 5xx) after retries: not a logout. */
export class SessionUnavailableError extends ApiError {
  constructor(status = 0) {
    super("Can't reach FixLocal right now. Check your connection and try again.", status, "NETWORK_ERROR");
  }
}

/** Waits between refresh attempts on a transient failure (fe-logic MED 9). Tests shorten it. */
let refreshBackoffMs = [400, 1200, 3000];
export function setRefreshBackoffForTests(ms: number[]) {
  refreshBackoffMs = ms;
}

const SESSION_HINT_KEY = "fixlocal:session";
/** Remembers (not secret) whether this browser had a session, so a logged-out page load skips the
 * refresh call instead of logging a 401 (ux LOW 12). Unknown (first visit after upgrade) still tries. */
function setSessionHint(on: boolean) {
  try {
    localStorage.setItem(SESSION_HINT_KEY, on ? "1" : "0");
  } catch {
    /* storage unavailable */
  }
}
function sessionHint(): "1" | "0" | null {
  try {
    const v = localStorage.getItem(SESSION_HINT_KEY);
    return v === "1" || v === "0" ? v : null;
  } catch {
    return null;
  }
}
export function forgetSessionHint() {
  setSessionHint(false);
}

type RefreshOutcome = { kind: "ok"; session: SessionResponse } | { kind: "lost" } | { kind: "unavailable"; status: number };

async function refreshOnce(): Promise<RefreshOutcome> {
  let last = 0;
  for (let attempt = 0; attempt <= refreshBackoffMs.length; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, refreshBackoffMs[attempt - 1]));
    }
    try {
      const res = await fetch(`${API_URL}/api/auth/refresh`, { method: "POST", credentials: "include" });
      // 204: no refresh cookie, i.e. simply not signed in (a quiet answer, not an error).
      if (res.status === 204) return { kind: "lost" };
      if (res.ok) return { kind: "ok", session: (await res.json()) as SessionResponse };
      // Only a real "no / bad session" answer ends the session. Rate limits, server errors and a
      // 409 REFRESH_IN_PROGRESS (another tab is rotating the same cookie right now) retry.
      if (res.status === 409 || res.status === 429 || res.status >= 500) {
        last = res.status;
        continue;
      }
      return { kind: "lost" };
    } catch {
      last = 0; // network error: retry
    }
  }
  return { kind: "unavailable", status: last };
}

/**
 * Exchange the refresh cookie for a new access token. Concurrent callers in this tab share one
 * request, and other tabs wait for (and reuse) it through the cross-tab lock.
 * Resolves null when the session is gone; throws SessionUnavailableError on a transient failure.
 */
export function refreshSession(): Promise<SessionResponse | null> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const outcome = await runExclusiveRefresh(refreshOnce);
        if (outcome.kind === "ok") {
          setAccessToken(outcome.session.token);
          return outcome.session;
        }
        if (outcome.kind === "lost") {
          accessToken = null;
          setSessionHint(false);
          return null;
        }
        throw new SessionUnavailableError(outcome.status);
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

/** Page-load restore: skips the network when this browser is known to be logged out. */
export function restoreSession(): Promise<SessionResponse | null> {
  if (sessionHint() === "0") return Promise.resolve(null);
  return refreshSession();
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
  setAccessToken(r.token);
  return r;
}

export async function register(
  email: string,
  password: string,
  role: "HOMEOWNER" | "TRADESPERSON",
  extras?: { name?: string; phone?: string; referralCode?: string; language?: "en" | "hi" }
) {
  // Sign-up never starts a session: the same "check your inbox" answer comes back whether or not
  // the address already has an account. The user confirms their email, then logs in.
  return api<{ ok: boolean; message: string }>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, role, ...extras, acceptTerms: true }),
  });
}

export function resendConfirmation(email: string) {
  return api<{ ok: boolean; message: string }>("/api/auth/resend-confirmation", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function logout() {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } finally {
    accessToken = null;
    setSessionHint(false);
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
  language?: "en" | "hi";
  smsOptIn?: boolean;
  whatsappOptIn?: boolean;
  businessName?: string | null;
  gstin?: string | null;
}) {
  return api<{ user: User }>("/api/auth/me", { method: "PATCH", body: JSON.stringify(body) });
}

export type MessagingSettings = {
  enabled: boolean;
  phone: string | null;
  phoneVerified: boolean;
  smsOptIn: boolean;
  whatsappOptIn: boolean;
  quietHours: { from: string; to: string; timeZone: string };
  events: string[];
};

export function getMessagingSettings() {
  return api<{ messaging: MessagingSettings }>("/api/auth/me/messaging");
}

export function sendPhoneCode(phone?: string) {
  return api<{ ok: boolean; sentTo: string }>("/api/auth/me/phone/send-code", {
    method: "POST",
    body: JSON.stringify(phone ? { phone } : {}),
  });
}

export function verifyPhoneCode(code: string) {
  return api<{ user: User }>("/api/auth/me/phone/verify", { method: "POST", body: JSON.stringify({ code }) });
}

export async function changePassword(currentPassword: string, newPassword: string) {
  const r = await api<SessionResponse>("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  setAccessToken(r.token);
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

export function acceptTerms() {
  return api<{ user: User }>("/api/auth/accept-terms", { method: "POST" });
}

/** Everything FixLocal holds about the signed-in user, as a JSON download. */
export async function downloadMyData() {
  const data = await api<Record<string, unknown>>("/api/auth/me/export");
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `fixlocal-data-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type BlockedUser = { userId: string; name: string; role: Role; createdAt: string };

export function listBlocks() {
  return api<{ blocks: BlockedUser[] }>("/api/blocks");
}

export function blockUser(userId: string) {
  return api<{ blocked: true }>("/api/blocks", { method: "POST", body: JSON.stringify({ userId }) });
}

export function unblockUser(userId: string) {
  return api<{ blocked: false }>(`/api/blocks/${userId}`, { method: "DELETE" });
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
