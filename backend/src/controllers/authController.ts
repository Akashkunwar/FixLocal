import { Request, Response } from "express";
import { AppDataSource } from "../data-source";
import { User, UserRole } from "../entities/User";
import { TradespersonProfile, VerificationStatus } from "../entities/TradespersonProfile";
import { hashPassword, comparePassword } from "../utils/password";
import { signToken } from "../utils/jwt";

const DEFAULT_NOTIFICATION_PREFS: Record<string, boolean> = {
  new_bid: true,
  bid_accepted: true,
  bid_rejected: true,
  job_status: true,
  dispute: true,
  message: true,
  review: true,
  system: true,
};

function mergeNotificationPrefs(prefs?: Record<string, boolean> | null) {
  return { ...DEFAULT_NOTIFICATION_PREFS, ...(prefs || {}) };
}

function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    phone: user.phone,
    avatarUrl: user.avatarUrl,
    isSuspended: !!user.isSuspended,
    notificationPrefs: mergeNotificationPrefs(user.notificationPrefs),
    inviteTemplates: Array.isArray(user.inviteTemplates) ? user.inviteTemplates : [],
    counterTemplates: Array.isArray(user.counterTemplates) ? user.counterTemplates : [],
    homeownerCounterTemplates: Array.isArray(user.homeownerCounterTemplates)
      ? user.homeownerCounterTemplates
      : [],
    introTemplates: Array.isArray(user.introTemplates) ? user.introTemplates : [],
    namedJobTemplates: Array.isArray(user.namedJobTemplates) ? user.namedJobTemplates : [],
    quoteViewNudgeHours:
      user.quoteViewNudgeHours != null && Number.isFinite(Number(user.quoteViewNudgeHours))
        ? Number(user.quoteViewNudgeHours)
        : null,
    createdAt: user.createdAt,
  };
}

export async function register(req: Request, res: Response) {
  const { email, password, role, name, phone } = req.body ?? {};

  if (!email || !password || !role) {
    return res.status(400).json({ message: "email, password, and role are required" });
  }

  if (role !== UserRole.HOMEOWNER && role !== UserRole.TRADESPERSON) {
    return res.status(400).json({
      message: "role must be HOMEOWNER or TRADESPERSON",
      code: "INVALID_ROLE",
    });
  }

  if (typeof password !== "string" || password.length < 6) {
    return res.status(400).json({ message: "password must be at least 6 characters" });
  }

  const userRepo = AppDataSource.getRepository(User);
  const existing = await userRepo.findOne({ where: { email: String(email).toLowerCase() } });
  if (existing) {
    return res.status(409).json({ message: "Email already registered", code: "EMAIL_TAKEN" });
  }

  const user = userRepo.create({
    email: String(email).toLowerCase(),
    passwordHash: await hashPassword(password),
    role,
    name: name ? String(name).trim() : undefined,
    phone: phone ? String(phone).trim() : undefined,
    isSuspended: false,
  });
  await userRepo.save(user);

  if (role === UserRole.TRADESPERSON) {
    const profileRepo = AppDataSource.getRepository(TradespersonProfile);
    await profileRepo.save(profileRepo.create({ userId: user.id, galleryUrls: [] }));
  }

  const token = signToken({ id: user.id, email: user.email, role: user.role });
  return res.status(201).json({ token, user: publicUser(user) });
}

export async function login(req: Request, res: Response) {
  const { email, password } = req.body ?? {};

  if (!email || !password) {
    return res.status(400).json({ message: "email and password are required" });
  }

  const user = await AppDataSource.getRepository(User).findOne({
    where: { email: String(email).toLowerCase() },
  });

  if (!user || !(await comparePassword(password, user.passwordHash))) {
    return res.status(401).json({ message: "Invalid email or password", code: "INVALID_CREDENTIALS" });
  }

  if (user.isSuspended) {
    return res.status(403).json({
      message: "Your account has been suspended. Contact support.",
      code: "ACCOUNT_SUSPENDED",
    });
  }

  // Also block suspended tradespeople at profile level
  if (user.role === UserRole.TRADESPERSON) {
    const profile = await AppDataSource.getRepository(TradespersonProfile).findOne({
      where: { userId: user.id },
    });
    if (profile?.verificationStatus === VerificationStatus.SUSPENDED) {
      return res.status(403).json({
        message: "Your tradesperson account is suspended. Contact support.",
        code: "ACCOUNT_SUSPENDED",
      });
    }
  }

  const token = signToken({ id: user.id, email: user.email, role: user.role });
  return res.json({ token, user: publicUser(user) });
}

export async function me(req: Request, res: Response) {
  const user = await AppDataSource.getRepository(User).findOne({
    where: { id: req.user!.id },
  });

  if (!user) {
    return res.status(401).json({ message: "User not found", code: "UNAUTHORIZED" });
  }

  if (user.isSuspended) {
    return res.status(403).json({
      message: "Your account has been suspended. Contact support.",
      code: "ACCOUNT_SUSPENDED",
    });
  }

  return res.json({ user: publicUser(user) });
}

export async function updateMe(req: Request, res: Response) {
  const userRepo = AppDataSource.getRepository(User);
  const user = await userRepo.findOne({ where: { id: req.user!.id } });
  if (!user) {
    return res.status(401).json({ message: "User not found", code: "UNAUTHORIZED" });
  }

  const { name, phone, avatarUrl, notificationPrefs, inviteTemplates, counterTemplates, homeownerCounterTemplates, introTemplates, namedJobTemplates, quoteViewNudgeHours } =
    req.body ?? {};
  if (name !== undefined) user.name = String(name).trim() || undefined;
  if (phone !== undefined) user.phone = String(phone).trim() || undefined;
  if (avatarUrl !== undefined) user.avatarUrl = String(avatarUrl).trim() || undefined;
  if (notificationPrefs !== undefined && notificationPrefs && typeof notificationPrefs === "object") {
    const merged = mergeNotificationPrefs(user.notificationPrefs);
    for (const [key, value] of Object.entries(notificationPrefs as Record<string, unknown>)) {
      if (key in DEFAULT_NOTIFICATION_PREFS) {
        merged[key] = Boolean(value);
      }
    }
    user.notificationPrefs = merged;
  }
  if (inviteTemplates !== undefined) {
    const raw = Array.isArray(inviteTemplates) ? inviteTemplates : [];
    user.inviteTemplates = raw
      .slice(0, 20)
      .map((t: any, i: number) => ({
        id: String(t?.id || `tpl-${Date.now()}-${i}`).slice(0, 64),
        label: String(t?.label || "Template").trim().slice(0, 80) || "Template",
        body: String(t?.body || "").trim().slice(0, 500),
        createdAt: t?.createdAt ? String(t.createdAt) : new Date().toISOString(),
      }))
      .filter((t: { body: string }) => t.body.length > 0);
  }
  if (counterTemplates !== undefined) {
    const raw = Array.isArray(counterTemplates) ? counterTemplates : [];
    user.counterTemplates = raw
      .slice(0, 20)
      .map((t: any, i: number) => ({
        id: String(t?.id || `ctr-${Date.now()}-${i}`).slice(0, 64),
        label: String(t?.label || "Template").trim().slice(0, 80) || "Template",
        body: String(t?.body || "").trim().slice(0, 500),
        createdAt: t?.createdAt ? String(t.createdAt) : new Date().toISOString(),
      }))
      .filter((t: { body: string }) => t.body.length > 0);
  }
  if (homeownerCounterTemplates !== undefined) {
    const raw = Array.isArray(homeownerCounterTemplates) ? homeownerCounterTemplates : [];
    user.homeownerCounterTemplates = raw
      .slice(0, 20)
      .map((t: any, i: number) => ({
        id: String(t?.id || `ho-ctr-${Date.now()}-${i}`).slice(0, 64),
        label: String(t?.label || "Template").trim().slice(0, 80) || "Template",
        body: String(t?.body || "").trim().slice(0, 500),
        createdAt: t?.createdAt ? String(t.createdAt) : new Date().toISOString(),
      }))
      .filter((t: { body: string }) => t.body.length > 0);
  }
  if (introTemplates !== undefined) {
    const raw = Array.isArray(introTemplates) ? introTemplates : [];
    user.introTemplates = raw
      .slice(0, 20)
      .map((t: any, i: number) => ({
        id: String(t?.id || `intro-${Date.now()}-${i}`).slice(0, 64),
        label: String(t?.label || "Template").trim().slice(0, 80) || "Template",
        body: String(t?.body || "").trim().slice(0, 500),
        createdAt: t?.createdAt ? String(t.createdAt) : new Date().toISOString(),
      }))
      .filter((t: { body: string }) => t.body.length > 0);
  }
  if (namedJobTemplates !== undefined) {
    const raw = Array.isArray(namedJobTemplates) ? namedJobTemplates : [];
    user.namedJobTemplates = raw
      .slice(0, 24)
      .map((t: any, i: number) => {
        const name = String(t?.name || t?.label || "").trim().slice(0, 80);
        const title = String(t?.title || "").trim().slice(0, 120);
        if (!name || !title) return null;
        const site =
          t?.siteType === "office" || t?.siteType === "residential"
            ? String(t.siteType)
            : undefined;
        const entry: Record<string, unknown> = {
          id: String(t?.id || `njt-${Date.now()}-${i}`).slice(0, 64),
          name,
          title,
          description: String(t?.description || "").trim().slice(0, 4000),
          category: String(t?.category || "other").trim().slice(0, 40) || "other",
          createdAt: t?.createdAt ? String(t.createdAt) : new Date().toISOString(),
        };
        if (site) entry.siteType = site;
        if (t?.cadence != null) entry.cadence = String(t.cadence).slice(0, 20);
        if (t?.cadenceNote) entry.cadenceNote = String(t.cadenceNote).trim().slice(0, 500);
        if (t?.budgetMin != null && t.budgetMin !== "") entry.budgetMin = String(t.budgetMin).slice(0, 20);
        if (t?.budgetMax != null && t.budgetMax !== "") entry.budgetMax = String(t.budgetMax).slice(0, 20);
        if (t?.address) entry.address = String(t.address).trim().slice(0, 200);
        if (t?.city) entry.city = String(t.city).trim().slice(0, 80);
        if (t?.area) entry.area = String(t.area).trim().slice(0, 80);
        if (t?.pincode) entry.pincode = String(t.pincode).trim().slice(0, 20);
        if (t?.lat != null && t.lat !== "") entry.lat = String(t.lat).slice(0, 32);
        if (t?.lng != null && t.lng !== "") entry.lng = String(t.lng).slice(0, 32);
        if (t?.sourceJobId) entry.sourceJobId = String(t.sourceJobId).slice(0, 64);
        return entry;
      })
      .filter(Boolean) as User["namedJobTemplates"];
  }
  if (quoteViewNudgeHours !== undefined) {
    if (quoteViewNudgeHours === null || quoteViewNudgeHours === "") {
      user.quoteViewNudgeHours = null;
    } else {
      const n = Number(quoteViewNudgeHours);
      if (!Number.isFinite(n) || n < 1 || n > 168) {
        return res.status(400).json({
          message: "quoteViewNudgeHours must be 1–168 or null",
          code: "VALIDATION",
        });
      }
      user.quoteViewNudgeHours = Math.round(n);
    }
  }

  await userRepo.save(user);
  return res.json({ user: publicUser(user) });
}
