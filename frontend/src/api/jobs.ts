import { api, API_URL } from "./client";

export type AmcProposal = {
  status: "proposed" | "requested" | "accepted" | "declined" | "countered";
  cadence: string;
  packageLabel: string;
  amountMin: number;
  amountMax?: number | null;
  unit?: string | null;
  note?: string | null;
  proposedByUserId: string;
  proposedAt: string;
  replyNote?: string | null;
  repliedAt?: string | null;
  replyCadence?: string | null;
};

export type Job = {
  id: string;
  title: string;
  description: string;
  category: string;
  siteType?: string | null;
  cadence?: string | null;
  cadenceNote?: string | null;
  amcProposal?: AmcProposal | null;
  preferredStart?: string | null;
  preferredEnd?: string | null;
  maxBids: number;
  budgetMin?: string | number | null;
  budgetMax?: string | number | null;
  address?: string | null;
  area?: string | null;
  city?: string | null;
  pincode?: string | null;
  lat?: number | null;
  lng?: number | null;
  distanceKm?: number | null;
  photoUrls: string[];
  beforePhotoUrls?: string[];
  afterPhotoUrls?: string[];
  status: string;
  paymentStatus?: string;
  escrowAmount?: string | number | null;
  escrowSource?: "quote" | "bid" | null;
  scheduleStatus?: string;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  scheduleProposedByUserId?: string | null;
  scheduleNote?: string | null;
  homeownerId: string;
  acceptedBidId?: string | null;
  completedAt?: string | null;
  createdAt: string;
};

export type ResponseSla = {
  tier: string;
  label: string;
  hours: number | null;
  source: "invite_to_bid" | "job_to_bid" | "none" | string;
  sampleSize: number;
  inviteAvgHours?: number | null;
  jobAvgHours?: number | null;
  inviteSampleSize?: number;
  jobSampleSize?: number;
};

export type Bid = {
  id: string;
  jobId: string;
  tradespersonId: string;
  amount: string | number | null;
  message?: string | null;
  etaDays?: number | null;
  proposedVisitStart?: string | null;
  proposedVisitEnd?: string | null;
  quoteAmount?: string | number | null;
  quoteNotes?: string | null;
  quoteAttachmentUrl?: string | null;
  quoteHistory?: Array<{
    amount?: number | null;
    notes?: string | null;
    attachmentUrl?: string | null;
    revisedAt: string;
  }> | null;
  counterOffer?: {
    suggestedAmount: number;
    notes?: string | null;
    requestedAt: string;
    status: "pending" | "addressed" | "dismissed" | "declined";
    addressedAt?: string | null;
    declinedAt?: string | null;
    declinedNotes?: string | null;
  } | null;
  counterHistory?: Array<{
    suggestedAmount: number;
    notes?: string | null;
    requestedAt: string;
    status: "pending" | "addressed" | "dismissed" | "declined";
    resolvedAt?: string | null;
    addressedAt?: string | null;
    declinedAt?: string | null;
    declinedNotes?: string | null;
  }> | null;
  quoteViewedAt?: string | null;
  quoteViewedRevisionCount?: number | null;
  quoteViewedNudgeSentAt?: string | null;
  viewedNoReply?: {
    due: boolean;
    hoursSinceView: number | null;
    thresholdHours: number;
    revisedSinceView: boolean;
    nudged: boolean;
    quoteViewedAt?: string | null;
    nudgeSentAt?: string | null;
  } | null;
  distanceKm?: number | null;
  jobToBidHours?: number | null;
  inviteToBidHours?: number | null;
  /** Wave 21: match score for best-value blend on bid compare */
  matchScore?: number | null;
  heatBoost?: number | null;
  rankedScore?: number | null;
  matchBreakdown?: {
    skills: number;
    rating: number;
    response: number;
    distance: number;
    total: number;
    skillHits?: string[];
    distanceKm?: number | null;
    avgResponseHours?: number | null;
  } | null;
  responseSla?: ResponseSla | null;
  proSlaTrends?: {
    d7: ResponseSla;
    d30: ResponseSla;
    clean: boolean;
  } | null;
  status: string;
  createdAt: string;
  tradesperson?: { id: string; email: string; name?: string | null };
  profile?: {
    averageRating: number;
    reviewCount: number;
    skills?: string | null;
    city?: string | null;
    lat?: number | null;
    lng?: number | null;
    yearsExperience?: number | null;
    verificationStatus?: string;
  } | null;
};

export type PaymentMilestone = {
  id: string;
  jobId: string;
  label: string;
  sequence: number;
  amount: string | number;
  percent: number;
  status: string;
  releasedAt?: string | null;
};

export type JobPayments = {
  jobId: string;
  paymentStatus: string;
  escrowAmount: number | null;
  escrowSource?: "quote" | "bid" | null;
  releasedTotal: number;
  remainingHeld: number;
  milestones: PaymentMilestone[];
  parties?: {
    homeowner?: { id: string; name?: string | null; email?: string } | null;
    tradesperson?: { id: string; name?: string | null; email?: string } | null;
  };
  auditNotes?: {
    id: string;
    action: string;
    summary: string;
    snippet: string;
    actorEmail?: string | null;
    createdAt: string;
  }[];
};

export type JobInvite = {
  id: string;
  tradespersonId: string;
  tradespersonName?: string | null;
  tradespersonEmail?: string | null;
  invitedByUserId: string;
  invitedByName?: string | null;
  invitedAt: string;
  status: "pending" | "declined";
  declinedAt?: string | null;
  declineNote?: string | null;
  declineReason?: string | null;
  message?: string | null;
  cooldownUntil?: string | null;
  cooldownRemainingMs?: number;
  inCooldown?: boolean;
  opened?: boolean;
  openedAt?: string | null;
  clickedAt?: string | null;
  notificationRead?: boolean;
  bidAfterInvite?: boolean;
};

export type InviteAnalytics = {
  jobId?: string;
  homeownerId?: string;
  sent: number;
  uniquePros?: number;
  pending?: number;
  declined: number;
  opened: number;
  clicked: number;
  bidAfterInvite: number;
  openRate: number;
  bidRate: number;
  declineRate: number;
  declineReasons?: Record<string, number>;
  limit?: number;
  remaining?: number;
  jobs?: number;
  byJob?: {
    jobId: string;
    title: string;
    status: string;
    category: string;
    sent: number;
    declined: number;
    opened: number;
    clicked: number;
    bidAfterInvite: number;
  }[];
};

export type ShortlistInviteAnalytics = {
  jobId?: string;
  homeownerId?: string;
  ranked: number;
  invited: number;
  bidAfter: number;
  inviteRate: number;
  bidRate: number;
  overallRate: number;
  avgRankBid?: number | null;
  sourceTagged?: boolean;
  jobs?: number;
  funnel: { stage: string; label: string; count: number; rate: number }[];
  byRank?: { rank: number; invited: number; bidAfter: number; names: string[] }[];
  byJob?: { jobId: string; title: string; status: string; invited: number; bidAfter: number }[];
};


export type Dispute = {
  id: string;
  jobId: string;
  reason: string;
  evidenceUrls?: string[];
  status: string;
  resolution?: string | null;
  resolutionNotes?: string | null;
  refundMeta?: {
    milestoneIds: string[];
    totalRefunded: number;
    labels?: string[];
  } | null;
  raisedBy?: { id: string; email: string; name?: string | null; role: string };
  job?: { id: string; title: string; status: string; homeownerId?: string; category?: string };
  createdAt?: string;
  resolvedAt?: string | null;
};

export type TradespersonProfile = {
  id: string;
  userId: string;
  email?: string;
  name?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  skills?: string | null;
  serviceAreas?: string | null;
  bio?: string | null;
  yearsExperience?: number | null;
  hourlyRateMin?: string | number | null;
  hourlyRateMax?: string | number | null;
  city?: string | null;
  lat?: number | null;
  lng?: number | null;
  distanceKm?: number | null;
  galleryUrls?: string[];
  averageRating: number;
  reviewCount: number;
  verificationStatus: string;
  verifiedAt?: string | null;
  licenseDocUrl?: string | null;
  weeklyAvailability?: Record<
    string,
    {
      enabled: boolean;
      start: string;
      end: string;
      slots?: { start: string; end: string }[];
    }
  > | null;
  blockedDates?: string[];
  notInterestedCategories?: string[];
  customRatePackages?: {
    id: string;
    label: string;
    hint?: string;
    amountMin: number;
    amountMax?: number | null;
    unit?: string | null;
  }[];
  caseStudies?: {
    id: string;
    title: string;
    notes?: string;
    beforeUrl?: string | null;
    afterUrl?: string | null;
    category?: string | null;
  }[];
  availableThisWeek?: boolean;
  responseSla?: ResponseSla | null;
  availabilityHeat?: {
    days: {
      key: string;
      label: string;
      date: string;
      enabled: boolean;
      blocked: boolean;
      hours: number;
      level: number;
    }[];
    score: number;
    totalHours: number;
    clean: boolean;
  } | null;
  bestInviteHint?: {
    dayKey: string;
    dayLabel: string;
    date: string;
    start: string;
    end: string;
    reason: string;
  } | null;
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
  return api<{
    jobs: Job[];
    pagination: { total: number; page: number; totalPages: number };
  }>(`/api/jobs${q ? `?${q}` : ""}`);
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
  return api<{
    job: Job;
    autoReleased?: { count: number; paymentStatus?: string } | null;
  }>(`/api/jobs/${id}/complete`, { method: "POST" });
}

export function uploadCompletionPhotos(
  jobId: string,
  opts: { before?: File[]; after?: File[] }
) {
  const fd = new FormData();
  (opts.before || []).slice(0, 4).forEach((f) => fd.append("before", f));
  (opts.after || []).slice(0, 4).forEach((f) => fd.append("after", f));
  return api<{ job: Job; added: { before: string[]; after: string[] } }>(
    `/api/jobs/${jobId}/completion-photos`,
    { method: "POST", body: fd }
  );
}

export function removeCompletionPhoto(
  jobId: string,
  body: { url: string; kind: "before" | "after" }
) {
  return api<{ job: Job }>(`/api/jobs/${jobId}/completion-photos`, {
    method: "DELETE",
    body: JSON.stringify(body),
  });
}

export function publishCaseStudyFromJob(
  jobId: string,
  body: {
    title?: string;
    notes?: string;
    beforeUrl?: string;
    afterUrl?: string;
    id?: string;
  } = {}
) {
  return api<{
    caseStudy: {
      id: string;
      title: string;
      notes?: string;
      beforeUrl?: string | null;
      afterUrl?: string | null;
      category?: string | null;
      sourceJobId?: string;
    };
    profile: { id: string; caseStudies: unknown[] };
    message?: string;
  }>(`/api/jobs/${jobId}/publish-case-study`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function proposeAmc(
  jobId: string,
  body: {
    cadence: string;
    packageLabel: string;
    amountMin: number;
    amountMax?: number | null;
    unit?: string;
    note?: string;
  }
) {
  return api<{ job: Job; message?: string }>(`/api/jobs/${jobId}/amc-proposal`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function replyAmc(
  jobId: string,
  body: {
    action: "accept" | "decline" | "counter";
    replyNote?: string;
    replyCadence?: string;
  }
) {
  return api<{ job: Job; message?: string }>(
    `/api/jobs/${jobId}/amc-proposal/reply`,
    {
      method: "POST",
      body: JSON.stringify(body),
    }
  );
}


export function requestAmc(
  jobId: string,
  body: {
    cadence: string;
    packageLabel: string;
    amountMin: number;
    amountMax?: number | null;
    unit?: string;
    note?: string;
  }
) {
  return api<{ job: Job; message?: string }>(`/api/jobs/${jobId}/amc-request`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function replyAmcRequest(
  jobId: string,
  body: {
    action: "accept" | "decline" | "counter";
    replyNote?: string;
    replyCadence?: string;
    packageLabel?: string;
    amountMin?: number;
    amountMax?: number | null;
    unit?: string;
    cadence?: string;
  }
) {
  return api<{ job: Job; message?: string }>(
    `/api/jobs/${jobId}/amc-request/reply`,
    {
      method: "POST",
      body: JSON.stringify(body),
    }
  );
}


export type BestValueBlendWeights = {
  matchPct: number;
  pricePct: number;
  slaHeatPct?: number;
};

export function listBids(jobId: string) {
  return api<{ bids: Bid[]; bestValueBlend?: BestValueBlendWeights }>(`/api/jobs/${jobId}/bids`);
}

export function acceptBid(bidId: string) {
  return api<{
    job: Job;
    bids?: Bid[];
    escrow?: {
      amount: number;
      source: "quote" | "bid" | string;
      message?: string;
      counterAddressed?: boolean;
      counterSuggested?: number | null;
      amountDiffersFromCounter?: boolean;
      softHoldPreview?: {
        holdAmount: number;
        counterSuggested: number | null;
        delta: number;
        note: string;
      } | null;
    };
  }>(`/api/bids/${bidId}/accept`, { method: "POST" });
}

export type SuggestedPro = {
  userId: string;
  name: string | null;
  city: string | null;
  skills: string | null;
  averageRating: number;
  reviewCount: number;
  score: number;
  heatBoost?: number;
  rankedScore?: number;
  breakdown: {
    skills: number;
    rating: number;
    response: number;
    distance: number;
    total: number;
    skillHits: string[];
    distanceKm: number | null;
    avgResponseHours: number | null;
    weights?: { skills: number; rating: number; response: number; distance: number };
  };
  responseSla?: ResponseSla | null;
  availabilityHeat?: {
    days: any[];
    score: number;
    totalHours: number;
    clean: boolean;
  } | null;
};

export function getShortlistRanked(jobId: string) {
  return api<{
    jobId: string;
    category?: string;
    shortlist: Array<{
      userId: string;
      name?: string | null;
      city?: string | null;
      skills?: string | null;
      averageRating: number;
      reviewCount: number;
      verificationStatus?: string | null;
      notes?: string | null;
      tags: string[];
      tagHits: string[];
      tagBoost: number;
      score: number;
      smartScore: number;
      breakdown: any;
      responseSla?: ResponseSla | null;
      availabilityHeat?: {
        days: any[];
        score: number;
        totalHours: number;
        clean: boolean;
      } | null;
      shortlistInviteMinHeat?: number;
      inviteBlockedByHeat?: boolean;
      inviteHeatReason?: string | null;
    }>;
    weights?: any;
    shortlistInviteMinHeat?: number;
  }>(`/api/jobs/${jobId}/shortlist-ranked`);
}

export function getSuggestedPros(jobId: string, limit = 5) {
  return api<{ jobId: string; category: string; suggestions: SuggestedPro[]; weights?: { skills: number; rating: number; response: number; distance: number }; skippedNotInterested?: number; heatAware?: boolean }>(
    `/api/jobs/${jobId}/suggested-pros?limit=${limit}`
  );
}

export function inviteSuggestedPro(
  jobId: string,
  body: {
    tradespersonId: string;
    message?: string;
    source?: "shortlist" | "suggested" | "profile" | "bulk" | "other";
    shortlistRank?: number;
    smartScore?: number;
    minHeat?: number;
  }
) {
  return api<{
    ok: boolean;
    jobId: string;
    tradespersonId: string;
    notificationId: string | null;
    message: string;
    source?: string;
    shortlistRank?: number | null;
    code?: string;
  }>(`/api/jobs/${jobId}/invite-pro`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function declineJobInvite(
  jobId: string,
  opts?: string | { note?: string; reason?: string }
) {
  const body =
    typeof opts === "string"
      ? { note: opts || undefined }
      : {
          note: opts?.note || undefined,
          reason: opts?.reason || undefined,
        };
  return api<{ ok: boolean; jobId: string; message: string; reason?: string | null }>(
    `/api/jobs/${jobId}/decline-invite`,
    {
      method: "POST",
      body: JSON.stringify(body),
    }
  );
}

export function listJobInvites(jobId: string) {
  return api<{
    jobId: string;
    invites: JobInvite[];
    used: number;
    limit: number;
    remaining: number;
  }>(`/api/jobs/${jobId}/invites`);
}

export function getJobInviteAnalytics(jobId: string) {
  return api<InviteAnalytics>(`/api/jobs/${jobId}/invite-analytics`);
}

export function getHomeownerInviteAnalytics() {
  return api<InviteAnalytics>(`/api/jobs/invite-analytics`);
}

export function getShortlistInviteAnalytics(jobId: string) {
  return api<ShortlistInviteAnalytics>(`/api/jobs/${jobId}/shortlist-invite-analytics`);
}

export function getHomeownerShortlistInviteAnalytics() {
  return api<ShortlistInviteAnalytics>(`/api/jobs/shortlist-invite-analytics`);
}

export function markInviteOpened(jobId: string) {
  return api<{
    ok: boolean;
    notificationId: string;
    openedAt: string;
    clickedAt: string;
    firstOpen: boolean;
  }>(`/api/jobs/${jobId}/invite-opened`, { method: "POST" });
}

export function bulkInviteSuggestedPros(
  jobId: string,
  body: {
    tradespersonIds: string[];
    message?: string;
    source?: "shortlist" | "suggested" | "profile" | "bulk" | "other";
    shortlistRanks?: Record<string, number>;
    smartScores?: Record<string, number>;
    minHeat?: number;
  }
) {
  return api<{
    ok: boolean;
    jobId: string;
    sent: number;
    failed: number;
    stoppedForRateLimit: boolean;
    message: string;
    results: {
      tradespersonId: string;
      ok: boolean;
      code?: string;
      message: string;
      notificationId?: string | null;
      cooldownUntil?: string | null;
      retryAfterMs?: number;
    }[];
  }>(`/api/jobs/${jobId}/invite-pros`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export type DisputeEvidence = {
  reason: string;
  files?: File[];
};

export function createDispute(jobId: string, reasonOrOpts: string | DisputeEvidence) {
  if (typeof reasonOrOpts === "string") {
    return api<{ dispute: Dispute; job: Job }>("/api/disputes", {
      method: "POST",
      body: JSON.stringify({ jobId, reason: reasonOrOpts }),
    });
  }
  const fd = new FormData();
  fd.append("jobId", jobId);
  fd.append("reason", reasonOrOpts.reason);
  (reasonOrOpts.files || []).slice(0, 5).forEach((f) => fd.append("evidence", f));
  return api<{ dispute: Dispute; job: Job }>("/api/disputes", {
    method: "POST",
    body: fd,
  });
}

export function uploadGallery(files: File[]) {
  const fd = new FormData();
  files.slice(0, 8).forEach((f) => fd.append("photos", f));
  return api<{ profile: TradespersonProfile }>("/api/profile/gallery", {
    method: "POST",
    body: fd,
  });
}

export function removeGalleryImage(url: string) {
  return api<{ profile: TradespersonProfile }>("/api/profile/gallery", {
    method: "DELETE",
    body: JSON.stringify({ url }),
  });
}

export type EarningsSummary = {
  totalEarned: number;
  completedJobs: number;
  inProgressJobs: number;
  awardedJobs: number;
  activeBids: number;
  recent: {
    jobId: string;
    title: string;
    amount: number;
    status: string;
    completedAt?: string | null;
  }[];
};

export function getMyEarnings() {
  return api<{ earnings: EarningsSummary }>("/api/profile/earnings");
}

export function placeBid(
  jobId: string,
  body: {
    amount: number;
    message?: string;
    etaDays?: number;
    proposedVisitStart?: string;
    proposedVisitEnd?: string;
    quoteAmount?: number;
    quoteNotes?: string;
    quoteAttachment?: File | null;
  }
) {
  const hasFile = !!body.quoteAttachment;
  if (hasFile || body.quoteAmount != null || body.quoteNotes) {
    const fd = new FormData();
    fd.append("amount", String(body.amount));
    if (body.message) fd.append("message", body.message);
    if (body.etaDays != null) fd.append("etaDays", String(body.etaDays));
    if (body.proposedVisitStart) fd.append("proposedVisitStart", body.proposedVisitStart);
    if (body.proposedVisitEnd) fd.append("proposedVisitEnd", body.proposedVisitEnd);
    if (body.quoteAmount != null) fd.append("quoteAmount", String(body.quoteAmount));
    if (body.quoteNotes) fd.append("quoteNotes", body.quoteNotes);
    if (body.quoteAttachment) fd.append("quoteAttachment", body.quoteAttachment);
    return api<{ bid: Bid }>(`/api/jobs/${jobId}/bids`, { method: "POST", body: fd });
  }
  return api<{ bid: Bid }>(`/api/jobs/${jobId}/bids`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getJobPayments(jobId: string) {
  return api<JobPayments>(`/api/jobs/${jobId}/payments`);
}

export function releaseMilestone(jobId: string, milestoneId: string) {
  return api<{ job: Job; milestone: PaymentMilestone; paymentStatus: string }>(
    `/api/jobs/${jobId}/payments/${milestoneId}/release`,
    { method: "POST" }
  );
}

export function proposeSchedule(
  jobId: string,
  body: { start: string; end?: string; note?: string }
) {
  return api<{ job: Job }>(`/api/jobs/${jobId}/schedule/propose`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function acceptSchedule(jobId: string) {
  return api<{ job: Job }>(`/api/jobs/${jobId}/schedule/accept`, {
    method: "POST",
  });
}

export function updateBidQuote(
  bidId: string,
  body: {
    quoteAmount?: number;
    quoteNotes?: string;
    quoteAttachment?: File | null;
    clearQuoteAttachment?: boolean;
  }
) {
  const hasFile = !!body.quoteAttachment;
  if (hasFile) {
    const fd = new FormData();
    if (body.quoteAmount != null) fd.append("quoteAmount", String(body.quoteAmount));
    if (body.quoteNotes != null) fd.append("quoteNotes", body.quoteNotes);
    if (body.clearQuoteAttachment) fd.append("clearQuoteAttachment", "1");
    fd.append("quoteAttachment", body.quoteAttachment!);
    return api<{ bid: Bid; message?: string }>(`/api/bids/${bidId}/quote`, {
      method: "PATCH",
      body: fd,
    });
  }
  return api<{ bid: Bid; message?: string }>(`/api/bids/${bidId}/quote`, {
    method: "PATCH",
    body: JSON.stringify({
      quoteAmount: body.quoteAmount,
      quoteNotes: body.quoteNotes,
      clearQuoteAttachment: body.clearQuoteAttachment ? "1" : undefined,
    }),
  });
}

export function withdrawBid(bidId: string) {
  return api<{ bid: Bid }>(`/api/bids/${bidId}`, { method: "DELETE" });
}

export function requestQuoteRevise(
  bidId: string,
  body: { suggestedAmount: number; notes?: string }
) {
  return api<{
    bid: Bid;
    message?: string;
  }>(`/api/bids/${bidId}/counter-offer`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function markQuoteViewed(bidId: string) {
  return api<{
    viewed: boolean;
    notified: boolean;
    quoteViewedAt?: string;
    quoteViewedRevisionCount?: number | null;
    message?: string;
  }>(`/api/bids/${bidId}/quote-viewed`, { method: "POST" });
}

export function declineCounterOffer(bidId: string, body: { notes?: string } = {}) {
  return api<{
    bid: Bid;
    message?: string;
  }>(`/api/bids/${bidId}/counter-offer/decline`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function checkViewedNoReply(
  bidId: string,
  opts: { forceHours?: number; force?: boolean } = {}
) {
  const q = new URLSearchParams();
  if (opts.forceHours != null) q.set("forceHours", String(opts.forceHours));
  if (opts.force) q.set("force", "1");
  const qs = q.toString();
  return api<{
    bidId: string;
    viewedNoReply: Bid["viewedNoReply"];
  }>(`/api/bids/${bidId}/viewed-no-reply${qs ? `?${qs}` : ""}`, { method: "POST" });
}


export function startJob(jobId: string) {
  return api<{ job: Job }>(`/api/jobs/${jobId}/start`, { method: "POST" });
}

export function getProfile() {
  return api<{ profile: TradespersonProfile }>("/api/profile");
}

export function updateProfile(body: Record<string, unknown>) {
  return api<{ profile: TradespersonProfile }>("/api/profile", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function browsePros(params: Record<string, string | undefined> = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v) qs.set(k, v);
  });
  const q = qs.toString();
  return api<{ pros: TradespersonProfile[] }>(`/api/profile/browse${q ? `?${q}` : ""}`);
}

export function getPublicProfile(userId: string) {
  return api<{ profile: TradespersonProfile; reviews: any[]; responseSla?: ResponseSla }>(
    `/api/profile/user/${userId}`
  );
}


export type ProAnalytics = {
  jobsWon: number;
  totalBids: number;
  activeBids: number;
  lostOrWithdrawn: number;
  winRate: number;
  averageRating: number;
  reviewCount: number;
  totalEarned: number;
  completedJobs: number;
  inProgressJobs: number;
  awardedJobs: number;
  earningsOverTime: { month: string; amount: number }[];
  categoryMix?: { category: string; count: number; earned: number }[];
  avgResponseHours?: number | null;
  responseSla?: ResponseSla | null;
  medianResponseHours?: number | null;
  bidsLast30Days?: number;
  slaTrends?: {
    d7: ResponseSla;
    d30: ResponseSla;
    clean: boolean;
  } | null;
  slaSparkline?: { label: string; hours: number | null; n: number }[];
  responseSampleSize?: number;
};

export function getMyAnalytics() {
  return api<{ analytics: ProAnalytics }>("/api/profile/analytics");
}

export type EscrowWhatIf = {
  bidId: string;
  jobId: string;
  source: string;
  defaultAmount: number;
  amount: number;
  milestones: { label: string; sequence: number; percent: number; amount: number }[];
  note?: string;
  counterOffer?: {
    suggestedAmount: number;
    status: string;
    deltaVsAmount: number;
  } | null;
};

export function escrowWhatIf(bidId: string, amount?: number) {
  const q = amount != null ? `?amount=${encodeURIComponent(String(amount))}` : "";
  return api<EscrowWhatIf>(`/api/bids/${bidId}/escrow-what-if${q}`);
}

export type CounterAnalytics = {
  role?: string;
  homeownerId?: string;
  tradespersonId?: string;
  jobId?: string | null;
  jobs?: number;
  bids?: number;
  sent: number;
  pending: number;
  addressed: number;
  declined: number;
  dismissed: number;
  addressRate: number;
  declineRate: number;
  avgTimeToAddressHours: number | null;
  medianTimeToAddressHours: number | null;
  avgTimeToDeclineHours: number | null;
  medianTimeToDeclineHours: number | null;
  afterAddressedAccepted: number;
  afterAddressedRejected: number;
  afterAddressedOpen: number;
  addressSampleSize?: number;
  declineSampleSize?: number;
  byJob?: Array<CounterAnalytics & { jobId: string; title?: string }>;
};

export function getCounterAnalytics(params: Record<string, string | undefined> = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v) qs.set(k, v);
  });
  const q = qs.toString();
  return api<CounterAnalytics>(`/api/bids/counter-analytics${q ? `?${q}` : ""}`);
}

export function getHomeownerCounterAnalytics() {
  return api<CounterAnalytics>("/api/jobs/counter-analytics");
}

export function getProCounterAnalytics() {
  return api<CounterAnalytics>("/api/profile/counter-analytics");
}
