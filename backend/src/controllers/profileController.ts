import type { Request, Response } from "express";
import { AppDataSource } from "../data-source";
import { TradespersonProfile, VerificationStatus } from "../entities/TradespersonProfile";
import { User, UserRole } from "../entities/User";
import { Review, ReviewDirection } from "../entities/Review";
import { Bid, BidStatus } from "../entities/Bid";
import { Job, JobStatus } from "../entities/Job";
import { JobInvite } from "../entities/JobInvite";
import { Notification, NotificationType } from "../entities/Notification";
import { Favorite, FavoriteTargetType } from "../entities/Favorite";
import { Upload, UploadKind } from "../entities/Upload";
import { buildResponseSla, buildSlaTrends, hoursBetween, maxHoursForTier } from "../utils/responseSla";
import { slaMapForPros } from "../utils/proSlaBatch";
import { buildAvailabilityHeat, DAY_KEYS } from "../utils/availabilityHeat";
import { createNotifications } from "../utils/notifications";
import { toProfile, toReview } from "../serializers";
import { releasedTotalsByJob } from "../domain/escrow";
import { median, mean, rate } from "../domain/analytics";
import { localDatesAhead, monthKeyInZone } from "../domain/time";
import { filesOf } from "../middleware/upload";
import { assertOwnedRefs, deleteUploadByRef, fileRef, nameFromRef, storeUploads } from "../services/files";
import { badRequest, forbidden, notFound } from "../http/errors";
import { viewer } from "./jobController";

const profiles = () => AppDataSource.getRepository(TradespersonProfile);
const MAX_GALLERY = 12;

async function ownProfile(userId: string) {
  const existing = await profiles().findOne({ where: { userId }, relations: ["user"] });
  if (existing) return existing;
  await profiles().save(profiles().create({ userId, galleryUrls: [] }));
  return profiles().findOneOrFail({ where: { userId }, relations: ["user"] });
}

function normalizeWeekly(raw: Record<string, { enabled: boolean; start?: string; end?: string; slots?: { start: string; end: string }[] }>) {
  const out: NonNullable<TradespersonProfile["weeklyAvailability"]> = {};
  for (const day of DAY_KEYS) {
    const slot = raw[day];
    if (!slot) {
      out[day] = { enabled: false, start: "09:00", end: "17:00", slots: [{ start: "09:00", end: "17:00" }] };
      continue;
    }
    const start = slot.start || "09:00";
    const end = slot.end || "17:00";
    const slots = (slot.slots && slot.slots.length ? slot.slots : [{ start, end }]).slice(0, 4);
    out[day] = { enabled: slot.enabled, start: slots[0].start, end: slots[0].end, slots };
  }
  return out;
}

/** "Available this week": an enabled, unblocked day in the next 7 days (pro's own time zone). */
function availableThisWeek(p: TradespersonProfile, timezone: string) {
  const blocked = new Set(p.blockedDates || []);
  return localDatesAhead(7, timezone).some(({ date, dayKey }) => !blocked.has(date) && !!p.weeklyAvailability?.[dayKey]?.enabled);
}

function bestInviteHint(p: TradespersonProfile, timezone: string) {
  const heat = buildAvailabilityHeat(p.weeklyAvailability, p.blockedDates, timezone);
  if (!heat.clean) return null;
  const labels: Record<string, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
  const candidates = heat.days.map((d, idx) => ({ ...d, idx })).filter((d) => d.enabled && d.hours > 0 && !d.blocked);
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.hours - a.hours || a.idx - b.idx);
  const best = candidates[0];
  const slot = p.weeklyAvailability?.[best.key];
  const windows = slot?.slots?.length ? slot.slots : [{ start: slot?.start || "09:00", end: slot?.end || "17:00" }];
  const win = [...windows].sort((a, b) => a.start.localeCompare(b.start))[0];
  const when = best.idx === 0 ? "today" : best.idx === 1 ? "tomorrow" : labels[best.key];
  return {
    dayKey: best.key,
    dayLabel: labels[best.key] || best.key,
    date: best.date,
    start: win.start,
    end: win.end,
    reason: `Best time to invite: ${when} ${win.start}–${win.end} (usually free then)`,
  };
}

export async function getMyProfile(req: Request, res: Response) {
  const p = await ownProfile(req.user!.id);
  return res.json({ profile: toProfile(p, p.user, "owner") });
}

export async function updateMyProfile(req: Request, res: Response) {
  const p = await ownProfile(req.user!.id);
  const b = req.valid.body;
  const heatBefore = buildAvailabilityHeat(p.weeklyAvailability, p.blockedDates, p.user.timezone).score;
  const simple = ["skills", "serviceAreas", "bio", "city", "lat", "lng", "yearsExperience", "hourlyRateMin", "hourlyRateMax"] as const;
  for (const key of simple) {
    if (b[key] !== undefined) (p as unknown as Record<string, unknown>)[key] = b[key];
  }
  if (p.hourlyRateMin != null && p.hourlyRateMax != null && Number(p.hourlyRateMin) > Number(p.hourlyRateMax)) {
    throw badRequest("Minimum rate can't be above the maximum", "VALIDATION");
  }
  if (b.galleryUrls !== undefined) {
    // Only reordering/removing existing gallery images; new images come through the upload endpoint.
    const current = new Set(p.galleryUrls || []);
    const next: string[] = b.galleryUrls;
    if (next.some((u) => !current.has(u))) throw badRequest("Upload new gallery photos with the gallery upload", "INVALID_FILE_REF");
    for (const removed of [...current].filter((u) => !next.includes(u))) await deleteUploadByRef(removed);
    p.galleryUrls = next;
  }
  if (b.weeklyAvailability !== undefined) p.weeklyAvailability = b.weeklyAvailability ? normalizeWeekly(b.weeklyAvailability) : null;
  if (b.blockedDates !== undefined) p.blockedDates = [...new Set<string>(b.blockedDates)].sort().slice(0, 60);
  if (b.notInterestedCategories !== undefined) p.notInterestedCategories = [...new Set<string>(b.notInterestedCategories)];
  if (b.customRatePackages !== undefined) p.customRatePackages = b.customRatePackages;
  if (b.caseStudies !== undefined) {
    const refs = (b.caseStudies as { beforeUrl?: string | null; afterUrl?: string | null }[])
      .flatMap((c) => [c.beforeUrl, c.afterUrl])
      .filter((r): r is string => !!r);
    await assertOwnedRefs(refs, { ownerUserId: p.userId, kinds: [UploadKind.CASE_STUDY, UploadKind.GALLERY] });
    const previousIds = new Map((p.caseStudies || []).map((c) => [c.id, c as { sourceJobId?: string }]));
    p.caseStudies = (b.caseStudies as typeof p.caseStudies).map((c) => ({
      ...c,
      ...(previousIds.get(c.id)?.sourceJobId ? { sourceJobId: previousIds.get(c.id)!.sourceJobId } : {}),
    }));
  }
  await profiles().save(p);

  const availabilityTouched = b.weeklyAvailability !== undefined || b.blockedDates !== undefined;
  const heatAfter = buildAvailabilityHeat(p.weeklyAvailability, p.blockedDates, p.user.timezone).score;
  if (availabilityTouched && heatAfter > heatBefore && p.verificationStatus === VerificationStatus.VERIFIED) {
    await notifyFavoritersOfAvailability(p.userId, p.user.name);
  }
  return res.json({ profile: toProfile(p, p.user, "owner") });
}

/** At most one "saved pro has more availability" alert per client per day. */
async function notifyFavoritersOfAvailability(proId: string, proName?: string | null) {
  const favs = await AppDataSource.getRepository(Favorite).find({ where: { targetType: FavoriteTargetType.PRO, targetId: proId } });
  if (!favs.length) return;
  const recent = await AppDataSource.getRepository(Notification)
    .createQueryBuilder("n")
    .select("n.userId", "userId")
    .where("n.userId IN (:...ids)", { ids: favs.map((f) => f.userId) })
    .andWhere("n.type = :type AND n.meta->>'proUserId' = :pid AND n.meta->>'availability' = 'true'", {
      type: NotificationType.PRO_AVAILABLE,
      pid: proId,
    })
    .andWhere("n.createdAt > :since", { since: new Date(Date.now() - 86400_000) })
    .getRawMany<{ userId: string }>();
  const skip = new Set(recent.map((r) => r.userId));
  await createNotifications(
    favs
      .filter((f) => !skip.has(f.userId))
      .map((f) => ({
        userId: f.userId,
        type: NotificationType.PRO_AVAILABLE,
        title: "Saved professional has more availability",
        body: `${proName || "A saved professional"} opened up more time this week.`,
        link: `/pros/${proId}`,
        meta: { proUserId: proId, availability: true },
      }))
  );
}

async function inviteHoursForPro(proId: string, bids: Bid[]) {
  const invites = await AppDataSource.getRepository(JobInvite).find({
    where: { tradespersonId: proId },
    select: { jobId: true, createdAt: true },
  });
  const at = new Map(invites.map((i) => [i.jobId, new Date(i.createdAt)]));
  const out: number[] = [];
  for (const bid of bids) {
    const invitedAt = at.get(bid.jobId);
    if (!invitedAt) continue;
    const h = hoursBetween(invitedAt, bid.createdAt);
    if (h != null) out.push(h);
  }
  return out;
}

export async function getPublicProfile(req: Request, res: Response) {
  const userId = req.valid.params.userId;
  const v = viewer(req);
  const user = await AppDataSource.getRepository(User).findOne({ where: { id: userId, role: UserRole.TRADESPERSON } });
  const profile = user && !user.deletedAt ? await profiles().findOne({ where: { userId } }) : null;
  if (!user || !profile) throw notFound("Professional not found");
  const self = v.id === userId;
  const admin = v.role === UserRole.ADMIN;
  if (profile.verificationStatus !== VerificationStatus.VERIFIED && !self && !admin) {
    throw notFound("Professional not found");
  }
  // Contact details only once this client has hired this professional.
  let revealContact = false;
  if (v.role === UserRole.HOMEOWNER) {
    const hired = await AppDataSource.getRepository(Job)
      .createQueryBuilder("j")
      .innerJoin(Bid, "b", "b.id = j.acceptedBidId")
      .where("j.homeownerId = :me AND b.tradespersonId = :pro", { me: v.id, pro: userId })
      .getExists();
    revealContact = hired;
  }
  const reviews = await AppDataSource.getRepository(Review).find({
    where: { revieweeId: userId, direction: ReviewDirection.CLIENT_TO_PRO },
    relations: ["reviewer", "job"],
    order: { createdAt: "DESC" },
    take: 20,
  });
  const bids = await AppDataSource.getRepository(Bid).find({
    where: { tradespersonId: userId },
    relations: ["job"],
    order: { createdAt: "DESC" },
    take: 80,
  });
  const jobHours = bids.map((b) => hoursBetween(b.job?.createdAt, b.createdAt)).filter((h): h is number => h != null);
  const responseSla = buildResponseSla({ inviteHours: await inviteHoursForPro(userId, bids), jobHours });
  const view = admin ? "admin" : self ? "owner" : "public";
  return res.json({
    profile: {
      ...toProfile(profile, user, view, { revealContact }),
      responseSla,
      availabilityHeat: buildAvailabilityHeat(profile.weeklyAvailability, profile.blockedDates, user.timezone),
    },
    responseSla,
    contactRevealed: revealContact || view !== "public",
    reviews: reviews.map((r) => ({ ...toReview(r), reviewerName: r.reviewer?.name || "Client" })),
  });
}

const OFFICE_TERMS = ["%office%", "%facilit%", "%amc%", "%cctv%", "%network%"];
const HOME_TERMS = ["%home%", "%plumb%", "%electric%", "%carpent%", "%paint%", "%appliance%", "%clean%", "%mov%"];

export async function browsePros(req: Request, res: Response) {
  const q = req.valid.query;
  const v = viewer(req);
  if (q.verified === "0" && v.role !== UserRole.ADMIN) throw forbidden("Only admins can list unverified professionals");
  const limit = q.limit ?? 40;
  const qb = profiles()
    .createQueryBuilder("p")
    .innerJoinAndSelect("p.user", "user")
    .where("user.deletedAt IS NULL AND user.isSuspended = false");
  if (q.verified !== "0") qb.andWhere("p.verificationStatus = :vs", { vs: VerificationStatus.VERIFIED });

  const like = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  if (q.city) {
    qb.andWhere("(p.city ILIKE :cityQ OR p.serviceAreas ILIKE :cityQ)", { cityQ: like(q.city) });
  }
  const nbh = q.neighborhood || q.area;
  if (nbh) qb.andWhere("p.serviceAreas ILIKE :nbh", { nbh: like(nbh) });
  const skill = q.skill || q.category;
  if (skill) qb.andWhere("p.skills ILIKE :skill", { skill: like(String(skill).replace(/_/g, " ")) });
  if (q.siteType) {
    const terms = q.siteType === "office" ? OFFICE_TERMS : HOME_TERMS;
    const clauses = terms.map((_, i) => `p.skills ILIKE :st${i} OR p.bio ILIKE :st${i}`);
    if (q.siteType === "residential") clauses.push(`COALESCE(p.skills, '') = ''`);
    qb.andWhere(`(${clauses.join(" OR ")})`, Object.fromEntries(terms.map((t, i) => [`st${i}`, t])));
  }
  if (q.ratingMin) qb.andWhere("p.averageRating >= :rMin", { rMin: q.ratingMin });
  if (q.rateMax) qb.andWhere("(p.hourlyRateMin IS NULL OR p.hourlyRateMin <= :rMax)", { rMax: q.rateMax });
  if (q.q) {
    qb.andWhere(
      "(p.skills ILIKE :search OR p.bio ILIKE :search OR p.serviceAreas ILIKE :search OR user.name ILIKE :search OR p.city ILIKE :search)",
      { search: like(q.q) }
    );
  }
  const hasOrigin = q.nearLat !== undefined && q.nearLng !== undefined;
  if (hasOrigin && q.maxKm) {
    const dLat = q.maxKm / 111;
    const dLng = q.maxKm / (111 * Math.max(0.1, Math.cos((q.nearLat * Math.PI) / 180)));
    qb.andWhere("p.lat BETWEEN :minLat AND :maxLat AND p.lng BETWEEN :minLng AND :maxLng", {
      minLat: q.nearLat - dLat,
      maxLat: q.nearLat + dLat,
      minLng: q.nearLng - dLng,
      maxLng: q.nearLng + dLng,
    });
  }
  qb.orderBy("p.averageRating", "DESC").addOrderBy("p.reviewCount", "DESC").take(200);
  const rows = await qb.getMany();

  const hav = (p: TradespersonProfile) => {
    if (!hasOrigin || p.lat == null || p.lng == null) return null;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(p.lat - q.nearLat);
    const dLng = toRad(p.lng - q.nearLng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(q.nearLat)) * Math.cos(toRad(p.lat)) * Math.sin(dLng / 2) ** 2;
    return Math.round(2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h))) * 10) / 10;
  };
  let list = rows.map((p) => ({ p, distanceKm: hav(p) }));
  if (hasOrigin && q.maxKm) list = list.filter((x) => x.distanceKm != null && x.distanceKm <= q.maxKm);

  const sla = await slaMapForPros(list.map((x) => x.p.userId));
  let shaped = list.map(({ p, distanceKm }) => {
    const heat = buildAvailabilityHeat(p.weeklyAvailability, p.blockedDates, p.user.timezone);
    return {
      ...toProfile(p, p.user, v.role === UserRole.ADMIN ? "admin" : "public"),
      distanceKm,
      responseSla: sla[p.userId] || null,
      availableThisWeek: availableThisWeek(p, p.user.timezone),
      availabilityHeat: heat,
      bestInviteHint: bestInviteHint(p, p.user.timezone),
    };
  });

  const tier = q.slaTier && q.slaTier !== "any" && q.slaTier !== "unknown" ? q.slaTier : null;
  if (tier || q.maxResponseHours) {
    shaped = shaped.filter((p) => {
      const s = p.responseSla;
      if (!s || s.tier === "unknown" || s.hours == null) return false;
      if (q.maxResponseHours && s.hours > q.maxResponseHours) return false;
      if (tier === "fast_or_better") return s.tier === "lightning" || s.tier === "fast";
      if (tier === "same_day_or_better") return ["lightning", "fast", "same_day"].includes(s.tier);
      if (tier) {
        const ceiling = maxHoursForTier(tier);
        return ceiling != null ? s.hours <= ceiling : s.tier === tier;
      }
      return true;
    });
  }
  if (q.availableThisWeek) shaped = shaped.filter((p) => p.availableThisWeek);
  if (q.minHeat) shaped = shaped.filter((p) => p.availabilityHeat.clean && p.availabilityHeat.score >= q.minHeat);

  const sort = q.sort === "distance" && hasOrigin ? "distance" : q.sort === "heat" ? "heat" : "rating";
  shaped.sort((a, b) => {
    if (sort === "distance") {
      const d = (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity);
      if (d !== 0) return d;
    } else if (sort === "heat") {
      const c = Number(b.availabilityHeat.clean) - Number(a.availabilityHeat.clean);
      if (c !== 0) return c;
      const s = b.availabilityHeat.score - a.availabilityHeat.score;
      if (s !== 0) return s;
    }
    return b.averageRating - a.averageRating || b.reviewCount - a.reviewCount;
  });
  return res.json({ pros: shaped.slice(0, limit), sort });
}

export async function uploadGallery(req: Request, res: Response) {
  const files = filesOf(req, "photos");
  if (!files.length) throw badRequest("Choose at least one photo", "NO_FILES");
  const p = await ownProfile(req.user!.id);
  if ((p.galleryUrls || []).length + files.length > MAX_GALLERY) {
    throw badRequest(`A gallery can have at most ${MAX_GALLERY} photos`, "TOO_MANY_FILES");
  }
  const uploads = await storeUploads(files, { kind: UploadKind.GALLERY, ownerUserId: req.user!.id });
  p.galleryUrls = [...(p.galleryUrls || []), ...uploads.map((u) => fileRef(u.name))];
  await profiles().save(p);
  return res.json({ profile: toProfile(p, p.user, "owner") });
}

export async function removeGalleryImage(req: Request, res: Response) {
  const p = await ownProfile(req.user!.id);
  const url = req.valid.body.url as string;
  if (!(p.galleryUrls || []).includes(url)) throw notFound("That photo isn't in your gallery");
  p.galleryUrls = p.galleryUrls.filter((u) => u !== url);
  await profiles().save(p);
  await deleteUploadByRef(url);
  return res.json({ profile: toProfile(p, p.user, "owner") });
}

/** Licence / ID document for verification (visible only to the pro and admins). */
export async function uploadLicense(req: Request, res: Response) {
  const files = filesOf(req, "file");
  if (!files.length) throw badRequest("Choose a document to upload", "NO_FILES");
  const p = await ownProfile(req.user!.id);
  const [u] = await storeUploads(files, { kind: UploadKind.LICENSE, ownerUserId: req.user!.id, allowPdf: true });
  const previous = p.licenseDocUrl;
  p.licenseDocUrl = fileRef(u.name);
  await profiles().save(p);
  if (previous && nameFromRef(previous)) {
    const old = await AppDataSource.getRepository(Upload).findOne({ where: { name: nameFromRef(previous)! } });
    if (old?.kind === UploadKind.LICENSE) await deleteUploadByRef(previous);
  }
  return res.json({ profile: toProfile(p, p.user, "owner") });
}

async function wonBids(proId: string) {
  return AppDataSource.getRepository(Bid).find({
    where: { tradespersonId: proId, status: BidStatus.ACCEPTED },
    relations: ["job"],
    order: { createdAt: "DESC" },
  });
}

/** Earnings = escrow actually released to this professional (ledger), not bid amounts. */
export async function getMyEarnings(req: Request, res: Response) {
  const proId = req.user!.id;
  const released = await releasedTotalsByJob(AppDataSource.manager, proId);
  const won = await wonBids(proId);
  const count = (s: JobStatus) => won.filter((b) => b.job?.status === s).length;
  const totalEarned = Math.round([...released.values()].reduce((s, r) => s + r.total, 0) * 100) / 100;
  const activeBids = await AppDataSource.getRepository(Bid).count({ where: { tradespersonId: proId, status: BidStatus.ACTIVE } });
  return res.json({
    earnings: {
      totalEarned,
      completedJobs: count(JobStatus.COMPLETED),
      inProgressJobs: count(JobStatus.IN_PROGRESS) + count(JobStatus.PENDING_CONFIRMATION),
      awardedJobs: count(JobStatus.AWARDED),
      activeBids,
      recent: won.slice(0, 10).map((b) => ({
        jobId: b.jobId,
        title: b.job?.title || "Job",
        amount: released.get(b.jobId)?.total ?? 0,
        agreedAmount: Number(b.job?.escrowAmount ?? b.amount),
        status: b.job?.status || "unknown",
        completedAt: b.job?.completedAt || null,
      })),
    },
  });
}

export async function getMyAnalytics(req: Request, res: Response) {
  const proId = req.user!.id;
  const user = await AppDataSource.getRepository(User).findOneOrFail({ where: { id: proId } });
  const tz = user.timezone;
  const bidRepo = AppDataSource.getRepository(Bid);
  const allBids = await bidRepo.find({ where: { tradespersonId: proId }, relations: ["job"], order: { createdAt: "ASC" } });
  const won = allBids.filter((b) => b.status === BidStatus.ACCEPTED);
  const lost = allBids.filter((b) => b.status === BidStatus.REJECTED || b.status === BidStatus.WITHDRAWN);
  const released = await releasedTotalsByJob(AppDataSource.manager, proId);

  const byMonth = new Map<string, number>();
  const mix = new Map<string, { category: string; count: number; earned: number }>();
  for (const b of won) {
    const cat = b.job?.category || "other";
    const row = mix.get(cat) || { category: cat, count: 0, earned: 0 };
    row.count += 1;
    const r = released.get(b.jobId);
    if (r) {
      row.earned += r.total;
      const key = monthKeyInZone(r.lastAt, tz);
      byMonth.set(key, (byMonth.get(key) || 0) + r.total);
    }
    mix.set(cat, row);
  }
  const months: { month: string; amount: number }[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 15));
    const key = monthKeyInZone(d, tz);
    months.push({ month: key, amount: Math.round((byMonth.get(key) || 0) * 100) / 100 });
  }

  const samples = allBids
    .map((b) => ({ hours: hoursBetween(b.job?.createdAt, b.createdAt), at: b.createdAt }))
    .filter((s): s is { hours: number; at: Date } => s.hours != null);
  const hours = samples.map((s) => s.hours);
  const trends = buildSlaTrends(samples);
  const profile = await profiles().findOne({ where: { userId: proId } });
  const nowMs = Date.now();
  const weeks = [5, 4, 3, 2, 1, 0].map((w) => {
    const end = nowMs - w * 7 * 86400_000;
    const slice = samples.filter((s) => {
      const t = new Date(s.at).getTime();
      return t >= end - 7 * 86400_000 && t < end;
    });
    return { label: w === 0 ? "now" : `-${w}w`, hours: mean(slice.map((s) => s.hours)), n: slice.length };
  });
  const totalEarned = Math.round([...released.values()].reduce((s, r) => s + r.total, 0) * 100) / 100;
  return res.json({
    analytics: {
      jobsWon: won.length,
      totalBids: allBids.length,
      activeBids: allBids.filter((b) => b.status === BidStatus.ACTIVE).length,
      lostOrWithdrawn: lost.length,
      winRate: rate(won.length, allBids.length),
      averageRating: Number(profile?.averageRating || 0),
      reviewCount: profile?.reviewCount || 0,
      totalEarned,
      completedJobs: won.filter((b) => b.job?.status === JobStatus.COMPLETED).length,
      inProgressJobs: won.filter((b) => b.job?.status === JobStatus.IN_PROGRESS || b.job?.status === JobStatus.PENDING_CONFIRMATION).length,
      awardedJobs: won.filter((b) => b.job?.status === JobStatus.AWARDED).length,
      earningsOverTime: months,
      categoryMix: [...mix.values()].sort((a, b) => b.count - a.count),
      avgResponseHours: mean(hours),
      medianResponseHours: median(hours),
      bidsLast30Days: allBids.filter((b) => new Date(b.createdAt).getTime() >= nowMs - 30 * 86400_000).length,
      responseSampleSize: hours.length,
      responseSla: buildResponseSla({ jobHours: hours }),
      slaTrends: { d7: trends.d7, d30: trends.d30, clean: trends.clean },
      slaSparkline: weeks,
    },
  });
}

