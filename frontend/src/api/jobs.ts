import { api } from "./client";

export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

export type Job = {
  id: string;
  title: string;
  description: string;
  category: string;
  preferredStart?: string | null;
  preferredEnd?: string | null;
  maxBids: number;
  budgetMin?: string | number | null;
  budgetMax?: string | number | null;
  address?: string | null;
  area?: string | null;
  pincode?: string | null;
  photoUrls: string[];
  status: string;
  paymentStatus?: string;
  homeownerId: string;
  acceptedBidId?: string | null;
  createdAt: string;
};

export type Bid = {
  id: string;
  jobId: string;
  tradespersonId: string;
  amount: string | number | null;
  message?: string | null;
  etaDays?: number | null;
  status: string;
  createdAt: string;
};

export type Dispute = {
  id: string;
  jobId: string;
  reason: string;
  status: string;
  resolution?: string | null;
  resolutionNotes?: string | null;
};

export function mediaUrl(path: string) {
  if (path.startsWith("http")) return path;
  return `${API_URL}${path}`;
}

export function listJobs(params: Record<string, string | undefined> = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v) qs.set(k, v);
  });
  const q = qs.toString();
  return api<{ jobs: Job[]; pagination: { total: number; page: number; totalPages: number } }>(
    `/api/jobs${q ? `?${q}` : ""}`
  );
}

export function getJob(id: string) {
  return api<{ job: Job }>(`/api/jobs/${id}`);
}

export function createJob(form: FormData) {
  return api<{ job: Job }>("/api/jobs", { method: "POST", body: form });
}

export function cancelJob(id: string) {
  return api<{ job: Job }>(`/api/jobs/${id}/cancel`, { method: "POST" });
}

export function completeJob(id: string) {
  return api<{ job: Job }>(`/api/jobs/${id}/complete`, { method: "POST" });
}

export function listBids(jobId: string) {
  return api<{ bids: Bid[] }>(`/api/jobs/${jobId}/bids`);
}

export function acceptBid(bidId: string) {
  return api<{ job: Job; bids: Bid[] }>(`/api/bids/${bidId}/accept`, {
    method: "POST",
  });
}

export function createDispute(jobId: string, reason: string) {
  return api<{ dispute: Dispute; job: Job }>("/api/disputes", {
    method: "POST",
    body: JSON.stringify({ jobId, reason }),
  });
}

export function placeBid(
  jobId: string,
  body: { amount: number; message?: string; etaDays?: number }
) {
  return api<{ bid: Bid }>(`/api/jobs/${jobId}/bids`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function withdrawBid(bidId: string) {
  return api<{ bid: Bid }>(`/api/bids/${bidId}`, { method: "DELETE" });
}

export function startJob(jobId: string) {
  return api<{ job: Job }>(`/api/jobs/${jobId}/start`, { method: "POST" });
}

export type TradespersonProfile = {
  id: string;
  userId: string;
  email?: string;
  skills?: string | null;
  serviceAreas?: string | null;
  verificationStatus: string;
  verifiedAt?: string | null;
  licenseDocUrl?: string | null;
};

export function getProfile() {
  return api<{ profile: TradespersonProfile }>("/api/profile");
}

export function updateProfile(body: { skills?: string; serviceAreas?: string }) {
  return api<{ profile: TradespersonProfile }>("/api/profile", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}
