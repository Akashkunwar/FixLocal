const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

const TOKEN_KEY = "fixlocal_token";
const USER_KEY = "fixlocal_user";

export type Role = "ADMIN" | "HOMEOWNER" | "TRADESPERSON";

export type User = {
  id: string;
  email: string;
  role: Role;
  name?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  notificationPrefs?: Record<string, boolean> | null;
  inviteTemplates?: { id: string; label: string; body: string; createdAt?: string }[] | null;
  counterTemplates?: { id: string; label: string; body: string; createdAt?: string }[] | null;
  homeownerCounterTemplates?: { id: string; label: string; body: string; createdAt?: string }[] | null;
  introTemplates?: { id: string; label: string; body: string; createdAt?: string }[] | null;
  namedJobTemplates?: {
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
  }[] | null;
  quoteViewNudgeHours?: number | null;
  createdAt?: string;
};

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): User | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function saveSession(token: string, user: User) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: Record<string, unknown>;

  constructor(
    message: string,
    status: number,
    code?: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(
      data.message || res.statusText || "Request failed",
      res.status,
      data.code,
      data && typeof data === "object" ? (data as Record<string, unknown>) : undefined
    );
  }
  return data as T;
}

export function login(email: string, password: string) {
  return api<{ token: string; user: User }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function register(
  email: string,
  password: string,
  role: "HOMEOWNER" | "TRADESPERSON",
  extras?: { name?: string; phone?: string }
) {
  return api<{ token: string; user: User }>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, role, ...extras }),
  });
}

export function me() {
  return api<{ user: User }>("/api/auth/me");
}

export function updateMe(body: {
  name?: string;
  phone?: string;
  avatarUrl?: string;
  notificationPrefs?: Record<string, boolean>;
  inviteTemplates?: { id: string; label: string; body: string; createdAt?: string }[];
  counterTemplates?: { id: string; label: string; body: string; createdAt?: string }[];
  homeownerCounterTemplates?: { id: string; label: string; body: string; createdAt?: string }[];
  introTemplates?: { id: string; label: string; body: string; createdAt?: string }[];
  namedJobTemplates?: {
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
  }[];
  quoteViewNudgeHours?: number | null;
}) {
  return api<{ user: User }>("/api/auth/me", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function dashboardPath(role: Role): string {
  if (role === "ADMIN") return "/admin";
  if (role === "HOMEOWNER") return "/client";
  return "/professional";
}

export { API_URL };
