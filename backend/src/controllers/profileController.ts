import { Request, Response } from "express";
import { param } from "../utils/params";
import { AppDataSource } from "../data-source";
import { TradespersonProfile, VerificationStatus } from "../entities/TradespersonProfile";
import { User, UserRole } from "../entities/User";
import { Review } from "../entities/Review";
import { Bid, BidStatus } from "../entities/Bid";
import { JobStatus } from "../entities/Job";
import { notifyFavoritersProAvailable } from "../utils/matchAlerts";
import { haversineKm, parseCoordPair } from "../utils/geo";
import { buildResponseSla, buildSlaTrends, hoursBetween, maxHoursForTier } from "../utils/responseSla";
import { slaMapForPros } from "../utils/proSlaBatch";
import { Notification, NotificationType } from "../entities/Notification";
import { buildAvailabilityHeat, DAY_KEYS } from "../utils/availabilityHeat";



function normalizeTime(raw: unknown, fallback: string) {
  const s = String(raw || fallback).slice(0, 5);
  return /^\d{2}:\d{2}$/.test(s) ? s : fallback;
}

function normalizeWeeklyAvailability(raw: unknown) {
  if (!raw || typeof raw !== "object") return null;
  const src = raw as Record<string, any>;
  const out: Record<
    string,
    { enabled: boolean; start: string; end: string; slots?: { start: string; end: string }[] }
  > = {};
  for (const day of DAY_KEYS) {
    const slot = src[day];
    if (!slot || typeof slot !== "object") {
      out[day] = { enabled: false, start: "09:00", end: "17:00", slots: [] };
      continue;
    }
    const start = normalizeTime(slot.start, "09:00");
    const end = normalizeTime(slot.end, "17:00");
    let slots: { start: string; end: string }[] = [];
    if (Array.isArray(slot.slots)) {
      slots = slot.slots
        .filter((s: any) => s && typeof s === "object")
        .map((s: any) => ({
          start: normalizeTime(s.start, start),
          end: normalizeTime(s.end, end),
        }))
        .slice(0, 4);
    }
    // Ensure primary window is represented in slots for multi-slot UI
    if (slots.length === 0 && Boolean(slot.enabled)) {
      slots = [{ start, end }];
    } else if (slots.length === 0) {
      slots = [{ start, end }];
    }
    const primary = slots[0] || { start, end };
    out[day] = {
      enabled: Boolean(slot.enabled),
      start: primary.start,
      end: primary.end,
      slots,
    };
  }
  return out;
}

function normalizeBlockedDates(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const dates = raw
    .map((d) => String(d).slice(0, 10))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  return [...new Set(dates)].sort().slice(0, 60);
}


/** True if pro has at least one enabled day in the next 7 days that is not blocked. */
function isAvailableThisWeek(
  weekly: Record<string, { enabled?: boolean }> | null | undefined,
  blockedDates?: string[] | null
): boolean {
  const blocked = new Set((blockedDates || []).map((d) => String(d).slice(0, 10)));
  const jsToKey = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const key = `${y}-${m}-${day}`;
    if (blocked.has(key)) continue;
    const dayKey = jsToKey[d.getDay()];
    const slot = weekly?.[dayKey];
    if (slot && slot.enabled) return true;
  }
  // No weekly schedule set → treat as unknown/not matching the filter
  return false;
}

/** Soft "best time to invite" from the next open window, only when schedule is clean. */
function buildBestInviteHint(
  weekly: Record<string, any> | null | undefined,
  blockedDates?: string[] | null
): {
  dayKey: string;
  dayLabel: string;
  date: string;
  start: string;
  end: string;
  reason: string;
} | null {
  const heat = buildAvailabilityHeat(weekly, blockedDates);
  if (!heat.clean) return null;
  const fullLabels: Record<string, string> = {
    mon: "Monday",
    tue: "Tuesday",
    wed: "Wednesday",
    thu: "Thursday",
    fri: "Friday",
    sat: "Saturday",
    sun: "Sunday",
  };
  // Prefer soonest day with highest hours; skip blocked/empty
  const candidates = heat.days
    .map((d: any, idx: number) => ({ ...d, idx }))
    .filter((d: any) => d.enabled && d.hours > 0 && !d.blocked);
  if (!candidates.length) return null;
  candidates.sort((a: any, b: any) => b.hours - a.hours || a.idx - b.idx);
  const best = candidates[0];
  const slot = weekly?.[best.key];
  const windows =
    Array.isArray(slot?.slots) && slot.slots.length
      ? slot.slots
      : [{ start: slot?.start || "09:00", end: slot?.end || "17:00" }];
  // Prefer morning-ish window if multiple
  const win = [...windows].sort((a, b) => String(a.start).localeCompare(String(b.start)))[0];
  const start = String(win.start || "09:00").slice(0, 5);
  const end = String(win.end || "17:00").slice(0, 5);
  const when = best.idx === 0 ? "today" : best.idx === 1 ? "tomorrow" : fullLabels[best.key];
  return {
    dayKey: best.key,
    dayLabel: fullLabels[best.key] || best.key,
    date: best.date,
    start,
    end,
    reason: `Best time to invite: ${when} ${start}–${end} (pro usually free then)`,
  };
}

function normalizeCustomRatePackages(raw: unknown): {
  id: string;
  label: string;
  hint?: string;
  amountMin: number;
  amountMax?: number | null;
  unit?: string | null;
}[] {
  if (!Array.isArray(raw)) return [];
  const out: {
    id: string;
    label: string;
    hint?: string;
    amountMin: number;
    amountMax?: number | null;
    unit?: string | null;
  }[] = [];
  for (let i = 0; i < raw.length && out.length < 12; i++) {
    const t: any = raw[i];
    const label = String(t?.label || "").trim().slice(0, 80);
    const amountMin = Number(t?.amountMin);
    if (!label || !Number.isFinite(amountMin) || amountMin < 0) continue;
    let amountMax: number | null | undefined = undefined;
    if (t?.amountMax != null && t?.amountMax !== "") {
      const n = Number(t.amountMax);
      if (Number.isFinite(n) && n >= amountMin) amountMax = n;
    }
    const hint = t?.hint != null ? String(t.hint).trim().slice(0, 160) : undefined;
    const unit = t?.unit != null ? String(t.unit).trim().slice(0, 40) : undefined;
    out.push({
      id: String(t?.id || `pkg-${i}-${Date.now()}`).slice(0, 64),
      label,
      ...(hint ? { hint } : {}),
      amountMin: Math.round(amountMin),
      ...(amountMax != null ? { amountMax } : {}),
      ...(unit ? { unit } : {}),
    });
  }
  return out;
}


function normalizeCaseStudies(raw: unknown): {
  id: string;
  title: string;
  notes?: string;
  beforeUrl?: string | null;
  afterUrl?: string | null;
  category?: string | null;
}[] {
  if (!Array.isArray(raw)) return [];
  const out: {
    id: string;
    title: string;
    notes?: string;
    beforeUrl?: string | null;
    afterUrl?: string | null;
    category?: string | null;
  }[] = [];
  for (let i = 0; i < raw.length && out.length < 12; i++) {
    const t: any = raw[i];
    const title = String(t?.title || "").trim().slice(0, 120);
    if (!title) continue;
    const notes = t?.notes != null ? String(t.notes).trim().slice(0, 800) : undefined;
    const beforeUrl =
      t?.beforeUrl != null && String(t.beforeUrl).trim()
        ? String(t.beforeUrl).trim().slice(0, 500)
        : undefined;
    const afterUrl =
      t?.afterUrl != null && String(t.afterUrl).trim()
        ? String(t.afterUrl).trim().slice(0, 500)
        : undefined;
    const category =
      t?.category != null && String(t.category).trim()
        ? String(t.category).trim().slice(0, 40)
        : undefined;
    out.push({
      id: String(t?.id || `case-${i}-${Date.now()}`).slice(0, 64),
      title,
      ...(notes ? { notes } : {}),
      ...(beforeUrl ? { beforeUrl } : {}),
      ...(afterUrl ? { afterUrl } : {}),
      ...(category ? { category } : {}),
    });
  }
  return out;
}

function serializeProfile(profile: TradespersonProfile, user?: User | null) {
  return {
    id: profile.id,
    userId: profile.userId,
    email: user?.email,
    name: user?.name,
    phone: user?.phone,
    avatarUrl: user?.avatarUrl,
    skills: profile.skills,
    serviceAreas: profile.serviceAreas,
    bio: profile.bio,
    yearsExperience: profile.yearsExperience,
    hourlyRateMin: profile.hourlyRateMin,
    hourlyRateMax: profile.hourlyRateMax,
    city: profile.city,
    lat: profile.lat,
    lng: profile.lng,
    galleryUrls: profile.galleryUrls || [],
    averageRating: Number(profile.averageRating || 0),
    reviewCount: profile.reviewCount || 0,
    verificationStatus: profile.verificationStatus,
    verifiedAt: profile.verifiedAt,
    licenseDocUrl: profile.licenseDocUrl,
    weeklyAvailability: profile.weeklyAvailability || null,
    blockedDates: profile.blockedDates || [],
    notInterestedCategories: profile.notInterestedCategories || [],
    customRatePackages: Array.isArray(profile.customRatePackages)
      ? profile.customRatePackages
      : [],
    caseStudies: Array.isArray(profile.caseStudies) ? profile.caseStudies : [],
  };
}

export async function getMyProfile(req: Request, res: Response) {
  if (req.user!.role !== UserRole.TRADESPERSON) {
    return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
  }

  const profileRepo = AppDataSource.getRepository(TradespersonProfile);
  let profile = await profileRepo.findOne({ where: { userId: req.user!.id } });
  if (!profile) {
    profile = await profileRepo.save(
      profileRepo.create({ userId: req.user!.id, galleryUrls: [] })
    );
  }

  const user = await AppDataSource.getRepository(User).findOne({
    where: { id: req.user!.id },
  });

  return res.json({ profile: serializeProfile(profile, user) });
}

export async function updateMyProfile(req: Request, res: Response) {
  if (req.user!.role !== UserRole.TRADESPERSON) {
    return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
  }

  const profileRepo = AppDataSource.getRepository(TradespersonProfile);
  let profile = await profileRepo.findOne({ where: { userId: req.user!.id } });
  if (!profile) {
    profile = profileRepo.create({ userId: req.user!.id, galleryUrls: [] });
  }

  const {
    skills,
    serviceAreas,
    bio,
    yearsExperience,
    hourlyRateMin,
    hourlyRateMax,
    city,
    lat,
    lng,
    galleryUrls,
    weeklyAvailability,
    blockedDates,
    notInterestedCategories,
    customRatePackages,
    caseStudies,
  } = req.body ?? {};

  const availabilityTouched =
    weeklyAvailability !== undefined || blockedDates !== undefined;

  if (skills !== undefined) profile.skills = String(skills);
  if (serviceAreas !== undefined) profile.serviceAreas = String(serviceAreas);
  if (bio !== undefined) profile.bio = String(bio);
  if (city !== undefined) profile.city = String(city);
  if (lat !== undefined) {
    const n = Number(lat);
    profile.lat = Number.isFinite(n) ? n : undefined;
  }
  if (lng !== undefined) {
    const n = Number(lng);
    profile.lng = Number.isFinite(n) ? n : undefined;
  }
  if (yearsExperience !== undefined) {
    const n = Number(yearsExperience);
    profile.yearsExperience = Number.isFinite(n) ? n : undefined;
  }
  if (hourlyRateMin !== undefined) {
    const n = Number(hourlyRateMin);
    profile.hourlyRateMin = Number.isFinite(n) ? n : undefined;
  }
  if (hourlyRateMax !== undefined) {
    const n = Number(hourlyRateMax);
    profile.hourlyRateMax = Number.isFinite(n) ? n : undefined;
  }
  if (galleryUrls !== undefined) {
    profile.galleryUrls = Array.isArray(galleryUrls)
      ? galleryUrls.map(String).slice(0, 12)
      : [];
  }
  if (weeklyAvailability !== undefined) {
    profile.weeklyAvailability = normalizeWeeklyAvailability(weeklyAvailability);
  }
  if (blockedDates !== undefined) {
    profile.blockedDates = normalizeBlockedDates(blockedDates);
  }
  if (notInterestedCategories !== undefined) {
    const allowed = new Set([
      "plumbing",
      "electrical",
      "carpentry",
      "painting",
      "appliance",
      "cleaning",
      "construction",
      "office_facilities",
      "tech_services",
      "moving",
      "other",
    ]);
    const raw = Array.isArray(notInterestedCategories) ? notInterestedCategories : [];
    profile.notInterestedCategories = [
      ...new Set(
        raw
          .map((c) => String(c || "").toLowerCase().trim())
          .filter((c) => allowed.has(c))
      ),
    ];
  }
  if (customRatePackages !== undefined) {
    profile.customRatePackages = normalizeCustomRatePackages(customRatePackages);
  }
  if (caseStudies !== undefined) {
    profile.caseStudies = normalizeCaseStudies(caseStudies);
  }

  await profileRepo.save(profile);

  if (availabilityTouched) {
    try {
      await notifyFavoritersProAvailable(
        req.user!.id,
        "updated availability — they may be free soon"
      );
    } catch (e) {
      console.warn("pro available alerts failed", e);
    }
  }

  const user = await AppDataSource.getRepository(User).findOne({
    where: { id: req.user!.id },
  });
  return res.json({ profile: serializeProfile(profile, user) });
}

export async function getPublicProfile(req: Request, res: Response) {
  const userId = param(req, "userId");
  const user = await AppDataSource.getRepository(User).findOne({
    where: { id: userId, role: UserRole.TRADESPERSON },
  });
  if (!user) {
    return res.status(404).json({ message: "Tradesperson not found", code: "NOT_FOUND" });
  }

  const profile = await AppDataSource.getRepository(TradespersonProfile).findOne({
    where: { userId },
  });
  if (!profile) {
    return res.status(404).json({ message: "Profile not found", code: "NOT_FOUND" });
  }

  const reviews = await AppDataSource.getRepository(Review).find({
    where: { tradespersonId: userId },
    relations: ["reviewer", "job"],
    order: { createdAt: "DESC" },
    take: 20,
  });

  // Response SLA: invite→bid and job→bid history for this pro
  const bids = await AppDataSource.getRepository(Bid).find({
    where: { tradespersonId: userId },
    relations: ["job"],
    order: { createdAt: "DESC" },
    take: 80,
  });
  const invites = await AppDataSource.getRepository(Notification)
    .createQueryBuilder("n")
    .where("n.userId = :uid", { uid: userId })
    .andWhere("n.type = :type", { type: NotificationType.MATCH })
    .andWhere("n.meta->>'invite' = 'true'")
    .orderBy("n.createdAt", "DESC")
    .take(120)
    .getMany();
  const invitesByJob: Record<string, Date> = {};
  for (const n of invites) {
    const jid = String((n.meta as any)?.jobId || "");
    if (!jid) continue;
    const t = new Date(n.createdAt);
    if (!invitesByJob[jid] || t < invitesByJob[jid]) invitesByJob[jid] = t;
  }
  const jobHours: number[] = [];
  const inviteHours: number[] = [];
  for (const bid of bids) {
    const jh = hoursBetween(bid.job?.createdAt, bid.createdAt);
    if (jh != null) jobHours.push(jh);
    const invAt = invitesByJob[bid.jobId];
    if (invAt) {
      const ih = hoursBetween(invAt, bid.createdAt);
      if (ih != null) inviteHours.push(ih);
    }
  }
  const responseSla = buildResponseSla({ inviteHours, jobHours });

  return res.json({
    profile: {
      ...serializeProfile(profile, user),
      responseSla,
    },
    responseSla,
    reviews: reviews.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt,
      jobTitle: r.job?.title,
      reviewerName: r.reviewer?.name || "Homeowner",
    })),
  });
}

export async function browsePros(req: Request, res: Response) {
  const {
    q,
    city,
    neighborhood,
    area,
    skill,
    category,
    verified,
    ratingMin,
    rateMax,
    nearLat,
    nearLng,
    maxKm,
    sort,
  } = req.query;
  const cityQ = String(city || "").trim();
  const nbhQ = String(neighborhood || area || "").trim();
  const origin = parseCoordPair(nearLat, nearLng);
  const maxDistance = Number(maxKm);
  const wantDistance = String(sort) === "distance";

  const qb = AppDataSource.getRepository(TradespersonProfile)
    .createQueryBuilder("p")
    .leftJoinAndSelect("p.user", "user");
  if (!wantDistance) qb.take(40);

  if (String(verified) !== "0") {
    qb.andWhere("p.verificationStatus = :vs", { vs: VerificationStatus.VERIFIED });
  }

  if (cityQ) {
    qb.andWhere("(p.city ILIKE :cityQ OR p.serviceAreas ILIKE :cityQ)", {
      cityQ: `%${cityQ}%`,
    });
    qb.addSelect(
      `CASE WHEN LOWER(COALESCE(p.city, '')) = LOWER(:cityExact) THEN 0 WHEN p.city ILIKE :cityLike OR p.serviceAreas ILIKE :cityLike THEN 1 ELSE 2 END`,
      "city_rank"
    );
    qb.setParameter("cityExact", cityQ);
    qb.setParameter("cityLike", `%${cityQ}%`);
    qb.orderBy("city_rank", "ASC");
  }
  if (nbhQ) {
    qb.andWhere("p.serviceAreas ILIKE :nbh", { nbh: `%${nbhQ}%` });
  }
  const skillOrCat = String(skill || category || "").trim();
  if (skillOrCat) {
    qb.andWhere("p.skills ILIKE :skill", { skill: `%${skillOrCat}%` });
  }

  // Soft site-type preference (skills/bio keywords) — no scoring/match math
  const siteTypeQ = String(req.query.siteType || "").trim().toLowerCase();
  if (siteTypeQ) {
    if (!["residential", "office"].includes(siteTypeQ)) {
      return res
        .status(400)
        .json({ message: "Invalid siteType", code: "INVALID_SITE_TYPE" });
    }
    if (siteTypeQ === "office") {
      qb.andWhere(
        `(p.skills ILIKE :stOffice OR p.bio ILIKE :stOffice OR p.skills ILIKE :stFac OR p.skills ILIKE :stAmc OR p.skills ILIKE :stCctv OR p.skills ILIKE :stNet)`,
        {
          stOffice: "%office%",
          stFac: "%facilit%",
          stAmc: "%AMC%",
          stCctv: "%CCTV%",
          stNet: "%network%",
        }
      );
    } else {
      qb.andWhere(
        `(p.skills ILIKE :stHome OR p.bio ILIKE :stHome OR p.skills ILIKE :stPlumb OR p.skills ILIKE :stElec OR p.skills ILIKE :stCarp OR p.skills ILIKE :stPaint OR p.skills ILIKE :stAppl OR p.skills ILIKE :stClean OR p.skills ILIKE :stMove OR COALESCE(p.skills, '') = '')`,
        {
          stHome: "%home%",
          stPlumb: "%plumb%",
          stElec: "%electric%",
          stCarp: "%carpent%",
          stPaint: "%paint%",
          stAppl: "%appliance%",
          stClean: "%clean%",
          stMove: "%mov%",
        }
      );
    }
  }
  const rMin = Number(ratingMin);
  if (Number.isFinite(rMin) && rMin > 0) {
    qb.andWhere("p.averageRating >= :rMin", { rMin });
  }
  const rMax = Number(rateMax);
  if (Number.isFinite(rMax) && rMax > 0) {
    qb.andWhere("(p.hourlyRateMin IS NULL OR p.hourlyRateMin <= :rMax)", { rMax });
  }
  if (q) {
    const search = `%${String(q)}%`;
    qb.andWhere(
      "(p.skills ILIKE :search OR p.bio ILIKE :search OR p.serviceAreas ILIKE :search OR user.name ILIKE :search OR p.city ILIKE :search)",
      { search }
    );
  }

  if (!wantDistance) {
    qb.addOrderBy("p.averageRating", "DESC").addOrderBy("p.reviewCount", "DESC");
  }

  const profiles = await qb.getMany();
  let shaped = profiles.map((p) => {
    const base = serializeProfile(p, p.user);
    const distanceKm = origin
      ? haversineKm(origin.lat, origin.lng, p.lat, p.lng)
      : null;
    return { ...base, distanceKm };
  });

  if (Number.isFinite(maxDistance) && maxDistance > 0 && origin) {
    shaped = shaped.filter((p) => p.distanceKm != null && p.distanceKm <= maxDistance);
  }

  if (wantDistance && origin) {
    shaped.sort((a, b) => {
      const da = a.distanceKm ?? Number.POSITIVE_INFINITY;
      const db = b.distanceKm ?? Number.POSITIVE_INFINITY;
      if (da !== db) return da - db;
      return Number(b.averageRating || 0) - Number(a.averageRating || 0);
    });
  } else {
    shaped.sort((a, b) => {
      const r = Number(b.averageRating || 0) - Number(a.averageRating || 0);
      if (r !== 0) return r;
      return (b.reviewCount || 0) - (a.reviewCount || 0);
    });
  }

  // Attach response SLA (job→bid) and optional tier / max-hours filter
  const slaTierQ = String(req.query.slaTier || "").trim().toLowerCase();
  const maxRespH = Number(req.query.maxResponseHours);
  const wantSlaFilter =
    (slaTierQ && slaTierQ !== "any" && slaTierQ !== "unknown") ||
    (Number.isFinite(maxRespH) && maxRespH > 0);

  const ids = shaped.map((p) => p.userId);
  const slaMap = ids.length ? await slaMapForPros(ids) : {};
  let withSla = shaped.map((p) => ({
    ...p,
    responseSla: slaMap[p.userId] || null,
  }));

  if (wantSlaFilter) {
    withSla = withSla.filter((p) => {
      const sla = p.responseSla;
      if (!sla || sla.tier === "unknown" || sla.hours == null) return false;
      if (Number.isFinite(maxRespH) && maxRespH > 0 && sla.hours > maxRespH) return false;
      if (slaTierQ && slaTierQ !== "any") {
        // "fast_or_better" = lightning|fast; otherwise exact tier or maxHours ceiling
        if (slaTierQ === "fast_or_better") {
          return sla.tier === "lightning" || sla.tier === "fast";
        }
        if (slaTierQ === "same_day_or_better") {
          return ["lightning", "fast", "same_day"].includes(sla.tier);
        }
        const ceiling = maxHoursForTier(slaTierQ);
        if (ceiling != null && Number.isFinite(ceiling)) {
          return sla.hours <= ceiling;
        }
        return sla.tier === slaTierQ;
      }
      return true;
    });
  }


  const availableThisWeek =
    String(req.query.availableThisWeek || "").trim() === "1" ||
    String(req.query.availableThisWeek || "").toLowerCase() === "true";

  if (availableThisWeek) {
    // Need profile weeklyAvailability / blockedDates — re-fetch from shaped ids
    const fullProfiles = ids.length
      ? await AppDataSource.getRepository(TradespersonProfile)
          .createQueryBuilder("p")
          .where("p.userId IN (:...ids)", { ids })
          .getMany()
      : [];
    const availMap = Object.fromEntries(
      fullProfiles.map((p) => [
        p.userId,
        isAvailableThisWeek(p.weeklyAvailability as any, p.blockedDates),
      ])
    );
    withSla = withSla.filter((p) => availMap[p.userId]);
  }

  // Attach availability flags, 7-day heat, and soft best-invite hint
  {
    const fullProfiles = withSla.length
      ? await AppDataSource.getRepository(TradespersonProfile)
          .createQueryBuilder("p")
          .where("p.userId IN (:...ids)", { ids: withSla.map((p) => p.userId) })
          .getMany()
      : [];
    const pmap = Object.fromEntries(fullProfiles.map((p) => [p.userId, p]));
    withSla = withSla.map((p) => {
      const prof = pmap[p.userId];
      const weekly = (prof?.weeklyAvailability as any) || null;
      const blocked = prof?.blockedDates || [];
      const available = prof ? isAvailableThisWeek(weekly, blocked) : false;
      const heat = buildAvailabilityHeat(weekly, blocked);
      const bestInviteHint = buildBestInviteHint(weekly, blocked);
      return {
        ...p,
        availableThisWeek: available,
        weeklyAvailability: weekly,
        blockedDates: blocked,
        availabilityHeat: heat,
        bestInviteHint,
      };
    });
  }

  // Min availability heat score (0–100 from free hours / 40h week)
  const minHeatRaw = req.query.minHeat ?? req.query.minAvailabilityScore;
  const minHeat = Number(minHeatRaw);
  if (Number.isFinite(minHeat) && minHeat > 0) {
    withSla = withSla.filter((p: any) => {
      const heat = p.availabilityHeat;
      if (!heat || !heat.clean) return false;
      return Number(heat.score || 0) >= minHeat;
    });
  }

  // Wave 18: sort by availability heat (clean + higher score first)
  const wantHeatSort = String(sort || "").toLowerCase() === "heat";
  if (wantHeatSort) {
    withSla = [...withSla].sort((a: any, b: any) => {
      const ha = a.availabilityHeat;
      const hb = b.availabilityHeat;
      const ca = ha?.clean ? 1 : 0;
      const cb = hb?.clean ? 1 : 0;
      if (cb !== ca) return cb - ca;
      const sa = Number(ha?.score || 0);
      const sb = Number(hb?.score || 0);
      if (sb !== sa) return sb - sa;
      return Number(b.averageRating || 0) - Number(a.averageRating || 0);
    });
  }

  return res.json({
    pros: withSla.slice(0, 40),
    sort: wantHeatSort ? "heat" : wantDistance ? "distance" : "rating",
  });
}

export async function uploadGallery(req: Request, res: Response) {
  if (req.user!.role !== UserRole.TRADESPERSON) {
    return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
  }

  const files = req.files as Express.Multer.File[] | undefined;
  if (!files?.length) {
    return res.status(400).json({ message: "At least one photo is required", code: "NO_FILES" });
  }

  const profileRepo = AppDataSource.getRepository(TradespersonProfile);
  let profile = await profileRepo.findOne({ where: { userId: req.user!.id } });
  if (!profile) {
    profile = profileRepo.create({ userId: req.user!.id, galleryUrls: [] });
  }

  const newUrls = files.map((f) => `/uploads/${f.filename}`);
  const existing = profile.galleryUrls || [];
  profile.galleryUrls = [...existing, ...newUrls].slice(0, 12);
  await profileRepo.save(profile);

  const user = await AppDataSource.getRepository(User).findOne({
    where: { id: req.user!.id },
  });
  return res.json({ profile: serializeProfile(profile, user) });
}

export async function removeGalleryImage(req: Request, res: Response) {
  if (req.user!.role !== UserRole.TRADESPERSON) {
    return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
  }

  const url = String(req.body?.url || "").trim();
  if (!url) {
    return res.status(400).json({ message: "url is required" });
  }

  const profileRepo = AppDataSource.getRepository(TradespersonProfile);
  const profile = await profileRepo.findOne({ where: { userId: req.user!.id } });
  if (!profile) {
    return res.status(404).json({ message: "Profile not found", code: "NOT_FOUND" });
  }

  profile.galleryUrls = (profile.galleryUrls || []).filter((u) => u !== url);
  await profileRepo.save(profile);

  const user = await AppDataSource.getRepository(User).findOne({
    where: { id: req.user!.id },
  });
  return res.json({ profile: serializeProfile(profile, user) });
}

export async function getMyEarnings(req: Request, res: Response) {
  if (req.user!.role !== UserRole.TRADESPERSON) {
    return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
  }

  const userId = req.user!.id;
  const bidRepo = AppDataSource.getRepository(Bid);
  const acceptedBids = await bidRepo.find({
    where: { tradespersonId: userId, status: BidStatus.ACCEPTED },
    relations: ["job"],
    order: { createdAt: "DESC" },
  });

  let totalEarned = 0;
  let completedCount = 0;
  let inProgressCount = 0;
  let awardedCount = 0;
  const recent: {
    jobId: string;
    title: string;
    amount: number;
    status: string;
    completedAt?: Date | null;
  }[] = [];

  for (const bid of acceptedBids) {
    const amount = Number(bid.amount || 0);
    const status = bid.job?.status || "unknown";
    if (status === JobStatus.COMPLETED) {
      totalEarned += amount;
      completedCount += 1;
    } else if (status === JobStatus.IN_PROGRESS) {
      inProgressCount += 1;
    } else if (status === JobStatus.AWARDED) {
      awardedCount += 1;
    }
    recent.push({
      jobId: bid.jobId,
      title: bid.job?.title || "Job",
      amount,
      status,
      completedAt: bid.job?.completedAt || null,
    });
  }

  const activeBids = await bidRepo.count({
    where: { tradespersonId: userId, status: BidStatus.ACTIVE },
  });

  return res.json({
    earnings: {
      totalEarned,
      completedJobs: completedCount,
      inProgressJobs: inProgressCount,
      awardedJobs: awardedCount,
      activeBids,
      recent: recent.slice(0, 10),
    },
  });
}


export async function getMyAnalytics(req: Request, res: Response) {
  if (req.user!.role !== UserRole.TRADESPERSON) {
    return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
  }

  const userId = req.user!.id;
  const bidRepo = AppDataSource.getRepository(Bid);
  const profileRepo = AppDataSource.getRepository(TradespersonProfile);

  const allBids = await bidRepo.find({
    where: { tradespersonId: userId },
    relations: ["job"],
    order: { createdAt: "ASC" },
  });

  const totalBids = allBids.length;
  const wonBids = allBids.filter((b) => b.status === BidStatus.ACCEPTED);
  const lostBids = allBids.filter(
    (b) => b.status === BidStatus.REJECTED || b.status === BidStatus.WITHDRAWN
  );
  const activeBids = allBids.filter((b) => b.status === BidStatus.ACTIVE).length;
  const jobsWon = wonBids.length;
  const winRate = totalBids > 0 ? Math.round((jobsWon / totalBids) * 1000) / 10 : 0;

  let totalEarned = 0;
  const earningsByMonth: Record<string, number> = {};
  const categoryMixMap: Record<string, { category: string; count: number; earned: number }> = {};

  for (const bid of wonBids) {
    const amount = Number(bid.amount || 0);
    const cat = bid.job?.category || "other";
    if (!categoryMixMap[cat]) categoryMixMap[cat] = { category: cat, count: 0, earned: 0 };
    categoryMixMap[cat].count += 1;
    if (bid.job?.status === JobStatus.COMPLETED) {
      totalEarned += amount;
      categoryMixMap[cat].earned += amount;
      const when = bid.job.completedAt || bid.job.updatedAt || bid.createdAt;
      const d = new Date(when);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      earningsByMonth[key] = (earningsByMonth[key] || 0) + amount;
    }
  }

  const months: { month: string; amount: number }[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    months.push({ month: key, amount: earningsByMonth[key] || 0 });
  }

  // Response-ish: hours from job post → this pro's bid (with timestamps for trends)
  const responseSamples: { hours: number; at: Date }[] = [];
  for (const bid of allBids) {
    if (!bid.job?.createdAt) continue;
    const h = hoursBetween(bid.job.createdAt, bid.createdAt);
    if (h == null) continue;
    responseSamples.push({ hours: h, at: bid.createdAt });
  }
  const responseHours = responseSamples.map((s) => s.hours).sort((a, b) => a - b);
  const avgResponseHours =
    responseHours.length > 0
      ? Math.round((responseHours.reduce((a, b) => a + b, 0) / responseHours.length) * 10) / 10
      : null;
  const medianResponseHours =
    responseHours.length > 0
      ? Math.round(responseHours[Math.floor(responseHours.length / 2)] * 10) / 10
      : null;

  const dayAgo30 = Date.now() - 30 * 86400000;
  const bidsLast30Days = allBids.filter(
    (b) => new Date(b.createdAt).getTime() >= dayAgo30
  ).length;

  const categoryMix = Object.values(categoryMixMap).sort((a, b) => b.count - a.count);
  const slaTrends = buildSlaTrends(responseSamples);

  const profile = await profileRepo.findOne({ where: { userId } });

  return res.json({
    analytics: {
      jobsWon,
      totalBids,
      activeBids,
      lostOrWithdrawn: lostBids.length,
      winRate,
      averageRating: Number(profile?.averageRating || 0),
      reviewCount: profile?.reviewCount || 0,
      totalEarned,
      completedJobs: wonBids.filter((b) => b.job?.status === JobStatus.COMPLETED).length,
      inProgressJobs: wonBids.filter((b) => b.job?.status === JobStatus.IN_PROGRESS).length,
      awardedJobs: wonBids.filter((b) => b.job?.status === JobStatus.AWARDED).length,
      earningsOverTime: months,
      categoryMix,
      avgResponseHours,
      medianResponseHours,
      bidsLast30Days,
      responseSampleSize: responseHours.length,
      responseSla: buildResponseSla({ jobHours: responseHours }),
      slaTrends: {
        d7: slaTrends.d7,
        d30: slaTrends.d30,
        clean: slaTrends.clean,
      },
      slaSparkline: (() => {
        const weeks: { label: string; hours: number | null; n: number }[] = [];
        const nowMs = Date.now();
        for (let w = 5; w >= 0; w--) {
          const end = nowMs - w * 7 * 86400000;
          const start = end - 7 * 86400000;
          const slice = responseSamples.filter((s) => {
            const t = new Date(s.at).getTime();
            return t >= start && t < end;
          });
          const label =
            w === 0 ? "now" : w === 1 ? "-1w" : `-${w}w`;
          if (!slice.length) {
            weeks.push({ label, hours: null, n: 0 });
          } else {
            const avg =
              Math.round(
                (slice.reduce((a, b) => a + b.hours, 0) / slice.length) * 10
              ) / 10;
            weeks.push({ label, hours: avg, n: slice.length });
          }
        }
        return weeks;
      })(),
    },
  });
}
