import { Bid } from "../entities/Bid";
import { Dispute } from "../entities/Dispute";
import { Job } from "../entities/Job";
import { Message } from "../entities/Message";
import { Notification } from "../entities/Notification";
import { PaymentMilestone } from "../entities/PaymentMilestone";
import { Review } from "../entities/Review";
import { TradespersonProfile } from "../entities/TradespersonProfile";
import { User } from "../entities/User";
import { NOTIFICATION_TYPE_VALUES } from "../domain/notificationTypes";
import { publicUrl, publicUrls, signedUrl, signedUrls } from "../services/files";
import type { JobAccess } from "../policies/jobPolicy";

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** ~1 km precision for anything shown outside the job's parties. */
export const roundCoord = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : Math.round(n * 100) / 100;
};

export function mergedNotificationPrefs(prefs?: Record<string, boolean> | null) {
  const out: Record<string, boolean> = {};
  for (const t of NOTIFICATION_TYPE_VALUES) out[t] = prefs?.[t] !== false;
  return out;
}

export function toSelfUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    name: user.name ?? null,
    phone: user.phone ?? null,
    avatarUrl: publicUrl(user.avatarUrl),
    isSuspended: !!user.isSuspended,
    emailVerified: !!user.emailVerifiedAt,
    timezone: user.timezone,
    notificationPrefs: mergedNotificationPrefs(user.notificationPrefs),
    quoteViewNudgeHours:
      user.quoteViewNudgeHours != null && Number.isFinite(Number(user.quoteViewNudgeHours))
        ? Number(user.quoteViewNudgeHours)
        : null,
    createdAt: user.createdAt,
  };
}

/** Safe to show to any signed-in user. */
export function toPublicUser(user: Pick<User, "id" | "name" | "role" | "avatarUrl"> | null | undefined) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name ?? null,
    role: user.role,
    avatarUrl: publicUrl(user.avatarUrl),
  };
}

/** Name + contact, only between the client and the hired professional (or admins). */
export function toContactUser(user: Pick<User, "id" | "name" | "email" | "phone" | "role"> | null | undefined) {
  if (!user) return null;
  return { id: user.id, name: user.name ?? null, email: user.email, phone: user.phone ?? null, role: user.role };
}

type ProfileView = "owner" | "public" | "admin";

export function toProfile(
  profile: TradespersonProfile,
  user: User | null | undefined,
  view: ProfileView,
  opts: { revealContact?: boolean } = {}
) {
  const exact = view !== "public";
  const contact = exact || opts.revealContact;
  return {
    id: profile.id,
    userId: profile.userId,
    name: user?.name ?? null,
    avatarUrl: publicUrl(user?.avatarUrl),
    ...(contact ? { email: user?.email, phone: user?.phone ?? null } : {}),
    skills: profile.skills ?? null,
    serviceAreas: profile.serviceAreas ?? null,
    bio: profile.bio ?? null,
    yearsExperience: profile.yearsExperience ?? null,
    hourlyRateMin: num(profile.hourlyRateMin),
    hourlyRateMax: num(profile.hourlyRateMax),
    city: profile.city ?? null,
    lat: exact ? num(profile.lat) : roundCoord(profile.lat),
    lng: exact ? num(profile.lng) : roundCoord(profile.lng),
    galleryUrls: publicUrls(profile.galleryUrls),
    averageRating: Number(profile.averageRating || 0),
    reviewCount: profile.reviewCount || 0,
    verificationStatus: profile.verificationStatus,
    verifiedAt: profile.verifiedAt ?? null,
    ...(exact ? { licenseDocUrl: signedUrl(profile.licenseDocUrl) } : {}),
    weeklyAvailability: profile.weeklyAvailability || null,
    blockedDates: profile.blockedDates || [],
    notInterestedCategories: profile.notInterestedCategories || [],
    customRatePackages: Array.isArray(profile.customRatePackages) ? profile.customRatePackages : [],
    caseStudies: (Array.isArray(profile.caseStudies) ? profile.caseStudies : []).map((c) => ({
      ...c,
      beforeUrl: publicUrl(c.beforeUrl),
      afterUrl: publicUrl(c.afterUrl),
    })),
  };
}

export function toJob(job: Job, access: Exclude<JobAccess, "none">) {
  const base = {
    id: job.id,
    title: job.title,
    description: job.description,
    category: job.category,
    siteType: job.siteType ?? null,
    cadence: job.cadence ?? null,
    cadenceNote: job.cadenceNote ?? null,
    preferredStart: job.preferredStart ?? null,
    preferredEnd: job.preferredEnd ?? null,
    maxBids: job.maxBids,
    budgetMin: num(job.budgetMin),
    budgetMax: num(job.budgetMax),
    area: job.area ?? null,
    city: job.city ?? null,
    pincode: job.pincode ?? null,
    photoUrls: signedUrls(job.photoUrls),
    status: job.status,
    homeownerId: job.homeownerId,
    acceptedBidId: job.acceptedBidId ?? null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
  if (access === "listing") {
    return { ...base, address: null, lat: roundCoord(job.lat), lng: roundCoord(job.lng), exactLocation: false };
  }
  return {
    ...base,
    address: job.address ?? null,
    lat: num(job.lat),
    lng: num(job.lng),
    exactLocation: true,
    amcProposal: job.amcProposal ?? null,
    beforePhotoUrls: signedUrls(job.beforePhotoUrls),
    afterPhotoUrls: signedUrls(job.afterPhotoUrls),
    paymentStatus: job.paymentStatus,
    escrowAmount: num(job.escrowAmount),
    escrowSource: job.escrowSource ?? null,
    scheduleStatus: job.scheduleStatus,
    scheduledStart: job.scheduledStart ?? null,
    scheduledEnd: job.scheduledEnd ?? null,
    scheduleProposedByUserId: job.scheduleProposedByUserId ?? null,
    scheduleNote: job.scheduleNote ?? null,
    photoConsent: !!job.photoConsent,
    pendingConfirmationAt: job.pendingConfirmationAt ?? null,
    completedAt: job.completedAt ?? null,
  };
}

/** A bid as its author, the job's client, or an admin sees it. */
export function toBid(bid: Bid) {
  return {
    id: bid.id,
    jobId: bid.jobId,
    tradespersonId: bid.tradespersonId,
    amount: num(bid.amount),
    message: bid.message ?? null,
    etaDays: bid.etaDays ?? null,
    proposedVisitStart: bid.proposedVisitStart ?? null,
    proposedVisitEnd: bid.proposedVisitEnd ?? null,
    quoteAmount: num(bid.quoteAmount),
    quoteNotes: bid.quoteNotes ?? null,
    quoteAttachmentUrl: signedUrl(bid.quoteAttachmentUrl),
    quoteRevision: bid.quoteRevision ?? 0,
    quoteHistory: (Array.isArray(bid.quoteHistory) ? bid.quoteHistory : []).map((h) => ({
      ...h,
      attachmentUrl: signedUrl(h.attachmentUrl),
    })),
    counterOffer: bid.counterOffer ?? null,
    counterHistory: Array.isArray(bid.counterHistory) ? bid.counterHistory : [],
    quoteViewedAt: bid.quoteViewedAt ?? null,
    quoteViewedRevisionCount: bid.quoteViewedRevisionCount ?? null,
    quoteViewedNudgeSentAt: bid.quoteViewedNudgeSentAt ?? null,
    status: bid.status,
    createdAt: bid.createdAt,
    updatedAt: bid.updatedAt,
  };
}

export function toMilestone(m: PaymentMilestone) {
  return {
    id: m.id,
    jobId: m.jobId,
    label: m.label,
    sequence: m.sequence,
    amount: Number(m.amount),
    percent: m.percent,
    status: m.status,
    releasedAt: m.releasedAt ?? null,
    refundedAt: m.refundedAt ?? null,
    refundNote: m.refundNote ?? null,
  };
}

export function toMessage(m: Message, sender?: Pick<User, "id" | "name" | "role"> | null) {
  const s = sender || (m as Message & { sender?: User }).sender;
  return {
    id: m.id,
    jobId: m.jobId,
    threadTradespersonId: m.threadTradespersonId,
    body: m.body,
    attachmentUrls: signedUrls(m.attachmentUrls),
    quote: m.quote
      ? { amount: Number(m.quote.amount), notes: m.quote.notes, attachmentUrl: signedUrl(m.quote.attachmentUrl) }
      : null,
    createdAt: m.createdAt,
    sender: s ? { id: s.id, name: s.name ?? null, role: s.role } : { id: m.senderId, name: null, role: "" },
  };
}

export function toDispute(d: Dispute) {
  return {
    id: d.id,
    jobId: d.jobId,
    raisedByUserId: d.raisedByUserId,
    reason: d.reason,
    evidenceUrls: signedUrls(d.evidenceUrls),
    status: d.status,
    resolution: d.resolution ?? null,
    resolutionNotes: d.resolutionNotes ?? null,
    previousJobStatus: d.previousJobStatus ?? null,
    refundMeta: d.refundMeta || null,
    resolvedAt: d.resolvedAt ?? null,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    job: d.job
      ? { id: d.job.id, title: d.job.title, status: d.job.status, homeownerId: d.job.homeownerId, category: d.job.category }
      : undefined,
    raisedBy: d.raisedBy ? { id: d.raisedBy.id, name: d.raisedBy.name ?? null, role: d.raisedBy.role } : undefined,
  };
}

export function toReview(r: Review) {
  return {
    id: r.id,
    jobId: r.jobId,
    direction: r.direction,
    rating: r.rating,
    comment: r.comment ?? null,
    createdAt: r.createdAt,
    reviewerId: r.reviewerId,
    revieweeId: r.revieweeId,
    reviewerName: r.reviewer?.name || (r.direction === "client_to_pro" ? "Client" : "Professional"),
    jobTitle: r.job?.title,
  };
}

export function toNotification(n: Notification) {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    link: n.link ?? null,
    read: n.read,
    meta: n.meta ?? null,
    createdAt: n.createdAt,
  };
}
