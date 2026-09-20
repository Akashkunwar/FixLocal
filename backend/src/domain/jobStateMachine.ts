import type { EntityManager } from "typeorm";
import { Job, JobStatus } from "../entities/Job";
import { conflict } from "../http/errors";

export type JobAction =
  | "award"
  | "start"
  | "mark_done"
  | "confirm"
  | "auto_confirm"
  | "cancel"
  | "force_cancel"
  | "dispute"
  | "resolve_cancel"
  | "resolve_complete";

const S = JobStatus;

/** Every allowed status change. Anything not listed is rejected with 409. */
export const TRANSITIONS: Record<JobAction, { from: JobStatus[]; to: JobStatus }> = {
  award: { from: [S.OPEN], to: S.AWARDED },
  start: { from: [S.AWARDED], to: S.IN_PROGRESS },
  mark_done: { from: [S.IN_PROGRESS], to: S.PENDING_CONFIRMATION },
  confirm: { from: [S.AWARDED, S.IN_PROGRESS, S.PENDING_CONFIRMATION], to: S.COMPLETED },
  auto_confirm: { from: [S.PENDING_CONFIRMATION], to: S.COMPLETED },
  cancel: { from: [S.OPEN], to: S.CANCELLED },
  force_cancel: {
    from: [S.OPEN, S.BIDDING_CLOSED, S.AWARDED, S.IN_PROGRESS, S.PENDING_CONFIRMATION, S.DISPUTED],
    to: S.CANCELLED,
  },
  dispute: { from: [S.AWARDED, S.IN_PROGRESS, S.PENDING_CONFIRMATION, S.COMPLETED], to: S.DISPUTED },
  resolve_cancel: { from: [S.DISPUTED], to: S.CANCELLED },
  resolve_complete: { from: [S.DISPUTED], to: S.COMPLETED },
};

/** Statuses a "no action" dispute resolution may restore. */
export const RESTORABLE: JobStatus[] = [S.AWARDED, S.IN_PROGRESS, S.PENDING_CONFIRMATION, S.COMPLETED];

export function canTransition(from: JobStatus, action: JobAction): boolean {
  return TRANSITIONS[action].from.includes(from);
}

const MESSAGES: Record<JobAction, string> = {
  award: "Bids can only be accepted while the job is open",
  start: "Work can only be started on an awarded job",
  mark_done: "Only work in progress can be marked done",
  confirm: "This job can't be marked complete in its current status",
  auto_confirm: "Job is not awaiting confirmation",
  cancel: "Only open jobs can be cancelled",
  force_cancel: "Job is already closed",
  dispute: "Disputes can only be opened on awarded, in-progress, awaiting-confirmation or completed jobs",
  resolve_cancel: "Job is not in dispute",
  resolve_complete: "Job is not in dispute",
};

export function assertTransition(job: Pick<Job, "status">, action: JobAction) {
  if (!canTransition(job.status, action)) {
    throw conflict(MESSAGES[action], "INVALID_STATUS", { status: job.status });
  }
}

/**
 * Atomic status change: only succeeds if the row is still in an allowed status.
 * Returns the previous status.
 */
export async function transitionJob(
  manager: EntityManager,
  jobId: string,
  action: JobAction,
  patch: Partial<Job> = {}
): Promise<JobStatus> {
  const rule = TRANSITIONS[action];
  const rows: { status: JobStatus }[] = await manager.query(
    `SELECT "status" FROM "jobs" WHERE "id" = $1 FOR UPDATE`,
    [jobId]
  );
  const current = rows[0]?.status;
  if (!current || !rule.from.includes(current)) {
    throw conflict(MESSAGES[action], "INVALID_STATUS", { status: current ?? null });
  }
  await manager.update(Job, { id: jobId }, { ...patch, status: rule.to });
  return current;
}

/** Restore a specific status (dispute "no action"). */
export async function restoreJobStatus(manager: EntityManager, jobId: string, status: JobStatus) {
  const target = RESTORABLE.includes(status) ? status : S.IN_PROGRESS;
  const rows: { status: JobStatus }[] = await manager.query(
    `SELECT "status" FROM "jobs" WHERE "id" = $1 FOR UPDATE`,
    [jobId]
  );
  if (rows[0]?.status !== S.DISPUTED) {
    throw conflict("Job is not in dispute", "INVALID_STATUS", { status: rows[0]?.status ?? null });
  }
  await manager.update(Job, { id: jobId }, { status: target });
  return target;
}
