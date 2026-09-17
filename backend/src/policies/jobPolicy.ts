import { AppDataSource } from "../data-source";
import { Bid, BidStatus } from "../entities/Bid";
import { Job, JobStatus } from "../entities/Job";
import { Upload, UploadKind } from "../entities/Upload";
import { UserRole } from "../entities/User";
import { forbidden, notFound } from "../http/errors";
import { PUBLIC_KINDS } from "../services/files";
import { AppDataSource as DS } from "../data-source";
import { TradespersonProfile } from "../entities/TradespersonProfile";

export type Viewer = {
  id: string;
  role: UserRole;
  proVerified?: boolean;
};

export type JobContext = {
  job: Job;
  acceptedProId: string | null;
};

/** Job statuses in which the awarded professional still has a working relationship. */
export const AWARDED_STATUSES: JobStatus[] = [
  JobStatus.AWARDED,
  JobStatus.IN_PROGRESS,
  JobStatus.PENDING_CONFIRMATION,
  JobStatus.COMPLETED,
  JobStatus.DISPUTED,
  JobStatus.CANCELLED,
];

export async function loadJobContext(jobId: string): Promise<JobContext> {
  const job = await AppDataSource.getRepository(Job).findOne({ where: { id: jobId } });
  if (!job) throw notFound("Job not found");
  return withAcceptedPro(job);
}

export async function withAcceptedPro(job: Job): Promise<JobContext> {
  let acceptedProId: string | null = null;
  if (job.acceptedBidId) {
    const bid = await AppDataSource.getRepository(Bid).findOne({
      where: { id: job.acceptedBidId },
      select: { id: true, tradespersonId: true },
    });
    acceptedProId = bid?.tradespersonId ?? null;
  }
  return { job, acceptedProId };
}

export const isAdmin = (v: Viewer) => v.role === UserRole.ADMIN;
export const isOwner = (ctx: JobContext, v: Viewer) => ctx.job.homeownerId === v.id;
export const isAwardedPro = (ctx: JobContext, v: Viewer) =>
  v.role === UserRole.TRADESPERSON && !!ctx.acceptedProId && ctx.acceptedProId === v.id;

export async function bidOf(jobId: string, proId: string): Promise<Bid | null> {
  return AppDataSource.getRepository(Bid).findOne({ where: { jobId, tradespersonId: proId } });
}

export async function isProVerified(userId: string): Promise<boolean> {
  const p = await DS.getRepository(TradespersonProfile).findOne({
    where: { userId },
    select: { id: true, verificationStatus: true },
  });
  return p?.verificationStatus === "verified";
}

/** Parties: the client, the awarded professional, and admins. Full detail (address, schedule, money). */
export function canViewJobPrivate(ctx: JobContext, v: Viewer): boolean {
  return isAdmin(v) || isOwner(ctx, v) || isAwardedPro(ctx, v);
}

export type JobAccess = "private" | "listing" | "none";

/**
 * What a viewer may see of a job:
 * - private: parties and admins
 * - listing: verified pros on open jobs, and pros who bid on it (no exact address)
 */
export async function jobAccess(ctx: JobContext, v: Viewer): Promise<JobAccess> {
  if (canViewJobPrivate(ctx, v)) return "private";
  if (v.role !== UserRole.TRADESPERSON) return "none";
  if (await bidOf(ctx.job.id, v.id)) return "listing";
  if (ctx.job.status === JobStatus.OPEN) {
    const verified = v.proVerified ?? (await isProVerified(v.id));
    return verified ? "listing" : "none";
  }
  return "none";
}

export async function assertJobAccess(ctx: JobContext, v: Viewer): Promise<JobAccess> {
  const access = await jobAccess(ctx, v);
  if (access === "none") {
    if (v.role === UserRole.TRADESPERSON && ctx.job.status === JobStatus.OPEN) {
      throw forbidden("Your professional account must be verified to view job details", "NOT_VERIFIED");
    }
    throw forbidden("You don't have access to this job");
  }
  return access;
}

export function assertPrivateAccess(ctx: JobContext, v: Viewer) {
  if (!canViewJobPrivate(ctx, v)) throw forbidden("You don't have access to this job");
}

export function assertOwner(ctx: JobContext, v: Viewer, message = "Only the client who posted this job can do that") {
  if (!isOwner(ctx, v)) throw forbidden(message);
}

export function assertOwnerOrAdmin(ctx: JobContext, v: Viewer, message = "Only the client who posted this job can do that") {
  if (!isOwner(ctx, v) && !isAdmin(v)) throw forbidden(message);
}

export function assertAwardedProOrAdmin(ctx: JobContext, v: Viewer, message = "Only the hired professional can do that") {
  if (!isAwardedPro(ctx, v) && !isAdmin(v)) throw forbidden(message);
}

/**
 * Chat thread access for (job, pro):
 * - the client and admins (admins are read-only)
 * - the pro of that thread while their bid is active on an open job, or once they are hired
 */
export async function threadAccess(
  ctx: JobContext,
  v: Viewer,
  threadProId: string
): Promise<"write" | "read" | "none"> {
  if (isAdmin(v)) return "read";
  if (isOwner(ctx, v)) {
    if (ctx.acceptedProId === threadProId) return "write";
    const bid = await bidOf(ctx.job.id, threadProId);
    if (!bid) return "none";
    return ctx.job.status === JobStatus.OPEN && bid.status === BidStatus.ACTIVE ? "write" : "read";
  }
  if (v.role !== UserRole.TRADESPERSON || v.id !== threadProId) return "none";
  if (isAwardedPro(ctx, v)) return "write";
  if (ctx.job.status === JobStatus.OPEN) {
    const bid = await bidOf(ctx.job.id, v.id);
    if (bid?.status === BidStatus.ACTIVE) return "write";
  }
  return "none";
}

/** Who may read a stored file. */
export async function canAccessUpload(upload: Upload, v: Viewer | null): Promise<boolean> {
  if (PUBLIC_KINDS.has(upload.kind)) return true;
  if (!v) return false;
  if (isAdmin(v) || upload.ownerUserId === v.id) return true;
  if (upload.kind === UploadKind.LICENSE) return false;
  if (!upload.jobId) return false;
  const job = await AppDataSource.getRepository(Job).findOne({ where: { id: upload.jobId } });
  if (!job) return false;
  const ctx = await withAcceptedPro(job);
  switch (upload.kind) {
    case UploadKind.JOB_PHOTO:
      return (await jobAccess(ctx, v)) !== "none";
    case UploadKind.COMPLETION:
    case UploadKind.EVIDENCE:
      return canViewJobPrivate(ctx, v);
    case UploadKind.QUOTE: {
      if (isOwner(ctx, v)) return true;
      if (!upload.bidId) return false;
      const bid = await AppDataSource.getRepository(Bid).findOne({ where: { id: upload.bidId } });
      return bid?.tradespersonId === v.id;
    }
    case UploadKind.CHAT:
      return upload.threadTradespersonId
        ? (await threadAccess(ctx, v, upload.threadTradespersonId)) !== "none"
        : canViewJobPrivate(ctx, v);
    default:
      return false;
  }
}
