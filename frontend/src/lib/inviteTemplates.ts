/** Job-level + user-level invite message templates (localStorage + optional User sync). */

export type InviteTemplate = {
  id: string;
  label: string;
  body: string;
  createdAt: string;
};

const USER_KEY = "fixlocal_invite_templates";
const jobKey = (jobId: string) => `fixlocal_invite_templates_job_${jobId}`;

function safeParse(raw: string | null): InviteTemplate[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((t: any, i: number) => ({
        id: String(t?.id || `tpl-${i}`),
        label: String(t?.label || "Template").slice(0, 80),
        body: String(t?.body || "").slice(0, 500),
        createdAt: String(t?.createdAt || new Date().toISOString()),
      }))
      .filter((t: InviteTemplate) => t.body.trim().length > 0)
      .slice(0, 20);
  } catch {
    return [];
  }
}

export function loadUserInviteTemplates(): InviteTemplate[] {
  return safeParse(localStorage.getItem(USER_KEY));
}

export function saveUserInviteTemplates(list: InviteTemplate[]) {
  localStorage.setItem(USER_KEY, JSON.stringify(list.slice(0, 20)));
}

export function loadJobInviteTemplates(jobId: string): InviteTemplate[] {
  return safeParse(localStorage.getItem(jobKey(jobId)));
}

export function saveJobInviteTemplates(jobId: string, list: InviteTemplate[]) {
  localStorage.setItem(jobKey(jobId), JSON.stringify(list.slice(0, 20)));
}

/** Merge job-specific first, then user-level (dedupe by id). */
export function loadMergedInviteTemplates(jobId?: string | null): InviteTemplate[] {
  const job = jobId ? loadJobInviteTemplates(jobId) : [];
  const user = loadUserInviteTemplates();
  const seen = new Set(job.map((t) => t.id));
  return [...job, ...user.filter((t) => !seen.has(t.id))].slice(0, 20);
}

export function upsertInviteTemplate(
  tpl: Omit<InviteTemplate, "createdAt"> & { createdAt?: string },
  scope: { jobId?: string | null; userLevel?: boolean } = { userLevel: true }
): InviteTemplate[] {
  const entry: InviteTemplate = {
    id: tpl.id || `tpl-${Date.now()}`,
    label: (tpl.label || "Template").trim().slice(0, 80) || "Template",
    body: (tpl.body || "").trim().slice(0, 500),
    createdAt: tpl.createdAt || new Date().toISOString(),
  };
  if (!entry.body) {
    return scope.jobId
      ? loadMergedInviteTemplates(scope.jobId)
      : loadUserInviteTemplates();
  }
  if (scope.jobId) {
    const list = loadJobInviteTemplates(scope.jobId).filter((t) => t.id !== entry.id);
    list.unshift(entry);
    saveJobInviteTemplates(scope.jobId, list);
  }
  if (scope.userLevel !== false) {
    const list = loadUserInviteTemplates().filter((t) => t.id !== entry.id);
    list.unshift(entry);
    saveUserInviteTemplates(list);
  }
  return loadMergedInviteTemplates(scope.jobId);
}

export function deleteInviteTemplate(id: string, jobId?: string | null) {
  saveUserInviteTemplates(loadUserInviteTemplates().filter((t) => t.id !== id));
  if (jobId) {
    saveJobInviteTemplates(
      jobId,
      loadJobInviteTemplates(jobId).filter((t) => t.id !== id)
    );
  }
}

export const DEFAULT_INVITE_STARTERS: InviteTemplate[] = [
  {
    id: "starter-flexible",
    label: "Flexible timing",
    body: "Flexible on timing — need someone reliable this week. Happy to discuss scope.",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "starter-quote",
    label: "Need a quote",
    body: "Could you take a look and share a structured quote? Photos are on the job.",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "starter-urgent",
    label: "Fairly urgent",
    body: "This is fairly urgent. If you’re available soon, please bid with an ETA.",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

export function mergeInviteTemplates(
  server?: { id: string; label: string; body: string; createdAt?: string }[] | null
): InviteTemplate[] {
  const local = loadUserInviteTemplates();
  const fromServer = Array.isArray(server)
    ? server.map((x) => ({
        id: x.id,
        label: x.label,
        body: x.body,
        createdAt: x.createdAt || new Date().toISOString(),
      }))
    : [];
  if (local.length) return local;
  if (fromServer.length) {
    saveUserInviteTemplates(fromServer);
    return fromServer;
  }
  return DEFAULT_INVITE_STARTERS;
}
