import { api } from "./client";

// ---- job alerts (professionals) ----
export type JobAlertCriteria = {
  categories: string[];
  city: string | null;
  area: string | null;
  lat: number | null;
  lng: number | null;
  radiusKm: number | null;
  minBudget: number | null;
  siteType: "residential" | "office" | null;
};

export type JobAlert = JobAlertCriteria & {
  id: string;
  name: string;
  active: boolean;
  matchCount: number;
  lastMatchedAt: string | null;
  createdAt: string;
};

export type AlertPreview = {
  count: number;
  jobs: { id: string; title: string; category: string; area: string | null; city: string | null; createdAt: string }[];
};

export function listJobAlerts() {
  return api<{ alerts: JobAlert[]; max: number }>("/api/job-alerts");
}

export function createJobAlert(body: JobAlertCriteria & { name: string }) {
  return api<{ alert: JobAlert }>("/api/job-alerts", { method: "POST", body: JSON.stringify(body) });
}

export function updateJobAlert(id: string, body: Partial<JobAlertCriteria & { name: string; active: boolean }>) {
  return api<{ alert: JobAlert }>(`/api/job-alerts/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function deleteJobAlert(id: string) {
  return api<{ ok: true }>(`/api/job-alerts/${id}`, { method: "DELETE" });
}

export function previewJobAlert(body: JobAlertCriteria, signal?: AbortSignal) {
  return api<AlertPreview>("/api/job-alerts/preview", { method: "POST", body: JSON.stringify(body), signal });
}
