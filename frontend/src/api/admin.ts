import { api } from "./client";
import type { Dispute, Job } from "./jobs";

export type AdminStats = {
  totalUsers: number;
  homeowners: number;
  tradespeople: number;
  openJobs: number;
  awardedJobs?: number;
  inProgressJobs?: number;
  completedJobs?: number;
  cancelledJobs?: number;
  disputedJobs?: number;
  openDisputes: number;
  pendingVerifications: number;
  suspendedUsers?: number;
  activeBids?: number;
  totalReviews?: number;
  simulatedGMV?: number;
  pendingConfirmationJobs?: number;
  openReports?: number;
  escrowReleased?: number;
  escrowRefunded?: number;
  escrowOutstanding?: number;
};

export type AdminTradesperson = {
  id: string;
  userId: string;
  email?: string;
  name?: string | null;
  skills?: string | null;
  serviceAreas?: string | null;
  city?: string | null;
  averageRating?: number;
  reviewCount?: number;
  verificationStatus: string;
  verifiedAt?: string | null;
  isSuspended?: boolean;
  emailVerified?: boolean;
  phone?: string | null;
  yearsExperience?: number | null;
  /** Signed link to the uploaded licence / ID document, if any. */
  licenseDocUrl?: string | null;
  createdAt: string;
};

export type AdminUser = {
  id: string;
  email: string;
  name?: string | null;
  phone?: string | null;
  role: string;
  isSuspended: boolean;
  createdAt: string;
  verificationStatus?: string | null;
};

export function getAdminStats() {
  return api<{ stats: AdminStats }>("/api/admin/stats");
}

export function listUsers(params: { role?: string; q?: string; suspended?: boolean } = {}) {
  const qs = new URLSearchParams();
  if (params.role) qs.set("role", params.role);
  if (params.q) qs.set("q", params.q);
  if (params.suspended) qs.set("suspended", "1");
  const q = qs.toString();
  return api<{ users: AdminUser[] }>(`/api/admin/users${q ? `?${q}` : ""}`);
}

export function setUserSuspended(userId: string, suspended: boolean) {
  return api<{ user: AdminUser }>(`/api/admin/users/${userId}/suspend`, {
    method: "PATCH",
    body: JSON.stringify({ suspended }),
  });
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
  return api<{ disputes: Dispute[] }>(`/api/disputes${q}`);
}

export function resolveDispute(
  id: string,
  body: {
    resolution: "favor_homeowner" | "favor_tradesperson" | "no_action";
    resolutionNotes?: string;
    /** Override the default outcome: cancel the job, complete it, or restore its previous status. */
    jobStatus?: "cancelled" | "completed" | "restore";
    refundMilestoneIds?: string[];
  }
) {
  return api<{ dispute: Dispute; job: Job }>(`/api/disputes/${id}/resolve`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function forceCancelJob(jobId: string, reason?: string) {
  return api<{ job: Pick<Job, "id" | "title" | "status" | "paymentStatus">; previousStatus: string }>(
    `/api/admin/jobs/${jobId}/force-cancel`,
    { method: "POST", body: JSON.stringify({ reason }) }
  );
}

export type AdminReport = {
  id: string;
  reporterId: string;
  reporter: { id: string; name: string | null; email: string } | null;
  targetType: "job" | "user" | "message";
  targetId: string;
  reason: string;
  status: "open" | "resolved" | "dismissed";
  resolutionNote?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
};

export function listReports(status?: "open" | "resolved" | "dismissed") {
  const q = status ? `?status=${status}` : "";
  return api<{ reports: AdminReport[]; total: number }>(`/api/admin/reports${q}`);
}

export function resolveReport(id: string, status: "resolved" | "dismissed", resolutionNote?: string) {
  return api<{ report: AdminReport }>(`/api/admin/reports/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status, resolutionNote }),
  });
}


export type AuditLog = {
  id: string;
  actorUserId: string;
  actorEmail?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  summary?: string | null;
  meta?: Record<string, unknown> | null;
  createdAt: string;
};

export function listAuditLogs(params: { action?: string; limit?: number } = {}) {
  const qs = new URLSearchParams();
  if (params.action) qs.set("action", params.action);
  if (params.limit) qs.set("limit", String(params.limit));
  const q = qs.toString();
  return api<{ logs: AuditLog[] }>(`/api/admin/audit-logs${q ? `?${q}` : ""}`);
}


export type MatchScoreBreakdown = {
  skills: number;
  rating: number;
  response: number;
  distance: number;
  total: number;
  skillHits: string[];
  distanceKm: number | null;
  avgResponseHours: number | null;
};

export type MatchTopPro = {
  userId: string;
  name: string | null;
  score: number;
  heatBoost?: number;
  rankedScore?: number;
  breakdown: MatchScoreBreakdown;
  city?: string | null;
  averageRating?: number;
  reviewCount?: number;
  skills?: string | null;
};

export type MatchQualityRow = {
  jobId: string;
  title: string;
  category: string;
  city?: string | null;
  area?: string | null;
  lat?: number | null;
  lng?: number | null;
  createdAt: string;
  nearbyVerifiedPros: number;
  sameCityPros: number;
  bestMatchScore?: number;
  topPros?: MatchTopPro[];
  matchBand: "none" | "thin" | "ok" | "strong" | string;
};

export type MatchQualitySummary = {
  openJobs: number;
  verifiedPros: number;
  jobsWithNoNearby: number;
  jobsThin: number;
  jobsOk: number;
  jobsStrong: number;
  radiusKm: number;
  avgBestScore?: number;
};

export function getMatchQuality() {
  return api<{ summary: MatchQualitySummary; jobs: MatchQualityRow[] }>(
    "/api/admin/match-quality"
  );
}

export function createAdminNote(body: {
  note: string;
  summary?: string;
  targetType?: string;
  targetId?: string;
}) {
  return api<{ log: AuditLog }>("/api/admin/audit-notes", {
    method: "POST",
    body: JSON.stringify(body),
  });
}


export type MatchWeights = {
  skills: number;
  rating: number;
  response: number;
  distance: number;
};

export type MatchWeightPreset = {
  id: "balanced" | "speed" | "quality" | "availability" | string;
  label: string;
  description: string;
  weights: MatchWeights;
  heatWeight?: number;
};

export type BestValueBlend = {
  matchPct: number;
  pricePct: number;
  /** Optional third weight (0 = off): fold SLA + heat into best-value blend. */
  slaHeatPct?: number;
};

export type BestValueBlendPreset = {
  id: "match_heavy" | "price_heavy" | "balanced_sla" | string;
  label: string;
  description: string;
  blend: BestValueBlend;
};

export type BestValueBlendPreviewJob = {
  jobId: string;
  title: string;
  category?: string;
  city?: string;
  area?: string;
  bidCount: number;
  bestBidId: string | null;
  topBids: {
    bidId: string;
    name: string;
    valueScore: number;
    matchScore: number;
    hold: number;
    isBest: boolean;
  }[];
};

export function getMatchWeights() {
  return api<{
    weights: MatchWeights;
    defaults: MatchWeights;
    sum: number;
    preset?: string | null;
    presets?: MatchWeightPreset[];
    heatWeight?: number;
    defaultHeatWeight?: number;
    shortlistInviteMinHeat?: number;
    defaultShortlistInviteMinHeat?: number;
    bestValueBlend?: BestValueBlend;
    defaultBestValueBlend?: BestValueBlend;
    bestValueBlendPreset?: string | null;
    bestValueBlendPresets?: BestValueBlendPreset[];
  }>("/api/admin/match-weights");
}

export function updateMatchWeights(
  weights: Partial<MatchWeights>,
  opts?: {
    preset?: string;
    heatWeight?: number;
    shortlistInviteMinHeat?: number;
    bestValueBlend?: BestValueBlend;
    bestValueBlendPreset?: string;
  }
) {
  return api<{
    ok: boolean;
    weights: MatchWeights;
    defaults: MatchWeights;
    sum: number;
    preset?: string | null;
    presets?: MatchWeightPreset[];
    heatWeight?: number;
    defaultHeatWeight?: number;
    shortlistInviteMinHeat?: number;
    bestValueBlend?: BestValueBlend;
    defaultBestValueBlend?: BestValueBlend;
    bestValueBlendPreset?: string | null;
    bestValueBlendPresets?: BestValueBlendPreset[];
    message?: string;
  }>("/api/admin/match-weights", {
    method: "PUT",
    body: JSON.stringify(
      opts?.bestValueBlendPreset
        ? {
            bestValueBlendPreset: opts.bestValueBlendPreset,
            ...(opts.heatWeight != null ? { heatWeight: opts.heatWeight } : {}),
            ...(weights && Object.keys(weights).length ? { weights } : {}),
          }
        : opts?.preset
          ? {
              preset: opts.preset,
              ...(opts.heatWeight != null ? { heatWeight: opts.heatWeight } : {}),
              ...(opts.bestValueBlend ? { bestValueBlend: opts.bestValueBlend } : {}),
            }
          : {
              weights,
              ...(opts?.heatWeight != null ? { heatWeight: opts.heatWeight } : {}),
              ...(opts?.shortlistInviteMinHeat != null ? { shortlistInviteMinHeat: opts.shortlistInviteMinHeat } : {}),
              ...(opts?.bestValueBlend ? { bestValueBlend: opts.bestValueBlend } : {}),
            }
    ),
  });
}

export function rollbackMatchWeights(auditLogId: string) {
  return api<{
    ok: boolean;
    weights: MatchWeights;
    defaults: MatchWeights;
    sum: number;
    preset?: string | null;
    presets?: MatchWeightPreset[];
    heatWeight?: number;
    defaultHeatWeight?: number;
    bestValueBlend?: BestValueBlend;
    defaultBestValueBlend?: BestValueBlend;
    rolledBackFrom?: string;
    message?: string;
  }>("/api/admin/match-weights/rollback", {
    method: "POST",
    body: JSON.stringify({ auditLogId }),
  });
}

export function rollbackBestValueBlend(auditLogId: string) {
  return api<{
    ok: boolean;
    bestValueBlend?: BestValueBlend;
    defaultBestValueBlend?: BestValueBlend;
    bestValueBlendPreset?: string | null;
    bestValueBlendPresets?: BestValueBlendPreset[];
    weights?: MatchWeights;
    heatWeight?: number;
    rolledBackFrom?: string;
    message?: string;
  }>("/api/admin/best-value-blend/rollback", {
    method: "POST",
    body: JSON.stringify({ auditLogId }),
  });
}

export function previewBestValueBlend(opts?: {
  matchPct?: number;
  pricePct?: number;
  slaHeatPct?: number;
  limit?: number;
}) {
  const q = new URLSearchParams();
  if (opts?.matchPct != null) q.set("matchPct", String(opts.matchPct));
  if (opts?.pricePct != null) q.set("pricePct", String(opts.pricePct));
  if (opts?.slaHeatPct != null) q.set("slaHeatPct", String(opts.slaHeatPct));
  if (opts?.limit != null) q.set("limit", String(opts.limit));
  const qs = q.toString();
  return api<{
    blend: BestValueBlend;
    bestValueBlendPreset?: string | null;
    bestValueBlendPresets?: BestValueBlendPreset[];
    sampleSize: number;
    jobs: BestValueBlendPreviewJob[];
    message?: string;
  }>(`/api/admin/best-value-blend/preview${qs ? `?${qs}` : ""}`);
}
