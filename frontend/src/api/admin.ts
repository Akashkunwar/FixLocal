import { api } from "./client";
import type { Dispute, Job } from "./jobs";

export type AdminStats = {
  totalUsers: number;
  homeowners: number;
  tradespeople: number;
  openJobs: number;
  openDisputes: number;
  pendingVerifications: number;
};

export type AdminTradesperson = {
  id: string;
  userId: string;
  email?: string;
  skills?: string | null;
  serviceAreas?: string | null;
  verificationStatus: string;
  verifiedAt?: string | null;
  createdAt: string;
};

export function getAdminStats() {
  return api<{ stats: AdminStats }>("/api/admin/stats");
}

export function listTradespeople(status?: string) {
  const q = status ? `?status=${encodeURIComponent(status)}` : "";
  return api<{ tradespeople: AdminTradesperson[] }>(`/api/admin/tradespeople${q}`);
}

export function verifyTradesperson(
  userId: string,
  status: "verified" | "rejected" | "suspended" | "pending"
) {
  return api<{ profile: { userId: string; verificationStatus: string } }>(
    `/api/admin/tradespeople/${userId}/verify`,
    {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }
  );
}

export function listDisputes(status?: string) {
  const q = status ? `?status=${encodeURIComponent(status)}` : "";
  return api<{ disputes: (Dispute & { job?: Job; reason: string; resolutionNotes?: string })[] }>(
    `/api/disputes${q}`
  );
}

export function resolveDispute(
  id: string,
  body: {
    resolution: "favor_homeowner" | "favor_tradesperson" | "no_action";
    resolutionNotes?: string;
    jobStatus?: string;
  }
) {
  return api<{ dispute: Dispute; job: Job }>(`/api/disputes/${id}/resolve`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function forceCancelJob(jobId: string) {
  return api<{ job: Job }>(`/api/admin/jobs/${jobId}/force-cancel`, {
    method: "POST",
  });
}
