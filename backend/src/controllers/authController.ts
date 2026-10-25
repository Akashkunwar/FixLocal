import type { Request, Response } from "express";
import { EMAIL_PREF_KEY } from "../utils/notifications";
import { TERMS_VERSION } from "../domain/legal";
import { In, IsNull, MoreThan } from "typeorm";
import { z } from "zod";
import { AppDataSource } from "../data-source";
import { config } from "../config";
import { User, UserRole } from "../entities/User";
import { TradespersonProfile, VerificationStatus } from "../entities/TradespersonProfile";
import { EmailToken, type EmailTokenType } from "../entities/EmailToken";
import { UserTemplate, TEMPLATE_KINDS, type TemplateKind } from "../entities/UserTemplate";
import { AuditAction } from "../entities/AuditLog";
import { Upload, UploadKind } from "../entities/Upload";
import { comparePassword, dummyCompare, hashPassword } from "../utils/password";
import {
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH,
  createSseTicket,
  issueRefreshToken,
  randomToken,
  revokeAllRefreshTokens,
  revokeRefreshToken,
  rotateRefreshToken,
  sha256,
  signAccessToken,
} from "../auth/tokens";
import { invalidateAuthState } from "../auth/authState";
import { badRequest, conflict, forbidden, unauthorized } from "../http/errors";
import { toSelfUser } from "../serializers";
import { appLink, sendMail } from "../services/mailer";
import { writeAudit } from "../utils/audit";
import { isNotificationType } from "../domain/notificationTypes";
import { deleteUploadByRef, discardFiles, fileRef, storeUploads } from "../services/files";
import { filesOf } from "../middleware/upload";
import { normalizeTemplates } from "../validation/templates";

const users = () => AppDataSource.getRepository(User);

function setRefreshCookie(res: Response, raw: string) {
  const cfg = config();
  res.cookie(REFRESH_COOKIE, raw, {
    httpOnly: true,
    secure: cfg.cookieSecure,
    sameSite: cfg.cookieSameSite,
    path: REFRESH_COOKIE_PATH,
    maxAge: cfg.refreshTokenTtlDays * 86400_000,
  });
}

function clearRefreshCookie(res: Response) {
  const cfg = config();
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: cfg.cookieSecure,
    sameSite: cfg.cookieSameSite,
    path: REFRESH_COOKIE_PATH,
  });
}

async function startSession(req: Request, res: Response, user: User, status = 200) {
  const { raw } = await issueRefreshToken(user.id, { userAgent: req.get("user-agent") });
  setRefreshCookie(res, raw);
  return res.status(status).json({
    token: signAccessToken(user),
    expiresIn: config().accessTokenTtlSec,
    user: toSelfUser(user),
  });
}

async function sendEmailToken(user: User, type: EmailTokenType) {
  const raw = randomToken(32);
  const ttlMs = type === "verify" ? 48 * 3600_000 : 3600_000;
  const repo = AppDataSource.getRepository(EmailToken);
  await repo.update({ userId: user.id, type, usedAt: IsNull() }, { usedAt: new Date() });
  await repo.save(repo.create({ userId: user.id, type, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + ttlMs) }));
  if (type === "verify") {
    await sendMail({
      to: user.email,
      subject: "Verify your FixLocal email",
      text: `Hi ${user.name || "there"},\n\nConfirm your email to start using FixLocal:\n${appLink(`/verify-email?token=${raw}`)}\n\nThis link expires in 48 hours.`,
    });
  } else {
    await sendMail({
      to: user.email,
      subject: "Reset your FixLocal password",
      text: `Someone asked to reset the password for this account.\n\nChoose a new password here:\n${appLink(`/reset-password?token=${raw}`)}\n\nThis link expires in 1 hour. If this wasn't you, you can ignore this email.`,
    });
  }
  return raw;
}

async function consumeEmailToken(raw: string, type: EmailTokenType) {
  const repo = AppDataSource.getRepository(EmailToken);
  const token = await repo.findOne({
    where: { tokenHash: sha256(raw), type, usedAt: IsNull(), expiresAt: MoreThan(new Date()) },
  });
  if (!token) throw badRequest("This link is invalid or has expired", "TOKEN_INVALID");
  const res = await repo.update({ id: token.id, usedAt: IsNull() }, { usedAt: new Date() });
  if (!res.affected) throw badRequest("This link is invalid or has expired", "TOKEN_INVALID");
  return token.userId;
}

export async function register(req: Request, res: Response) {
  const { email, password, role, name, phone } = req.valid.body;
  const exists = await users().exists({ where: { email } });
  if (exists) throw conflict("That email is already registered", "EMAIL_TAKEN");

  const cfg = config();
  const autoVerify = !cfg.isProd && process.env.DEV_AUTO_VERIFY_EMAIL === "true";
  const user = await AppDataSource.transaction(async (m) => {
    const u = await m.save(
      m.create(User, {
        email,
        passwordHash: await hashPassword(password),
        role,
        name: name || undefined,
        phone: phone || undefined,
        isSuspended: false,
        emailVerifiedAt: autoVerify ? new Date() : null,
        termsAcceptedAt: new Date(),
        termsVersion: TERMS_VERSION,
      })
    );
    if (role === UserRole.TRADESPERSON) {
      await m.save(m.create(TradespersonProfile, { userId: u.id, galleryUrls: [] }));
    }
    return u;
  });
  if (!user.emailVerifiedAt) await sendEmailToken(user, "verify");
  return startSession(req, res, user, 201);
}

export async function login(req: Request, res: Response) {
  const { email, password } = req.valid.body;
  const user = await users()
    .createQueryBuilder("u")
    .addSelect("u.passwordHash")
    .where("u.email = :email", { email })
    .getOne();
  if (!user || user.deletedAt) {
    await dummyCompare(password);
    throw unauthorized("Invalid email or password", "INVALID_CREDENTIALS");
  }
  if (!(await comparePassword(password, user.passwordHash))) {
    throw unauthorized("Invalid email or password", "INVALID_CREDENTIALS");
  }
  if (user.isSuspended) throw forbidden("Your account has been suspended. Contact support.", "ACCOUNT_SUSPENDED");
  if (user.role === UserRole.TRADESPERSON) {
    const profile = await AppDataSource.getRepository(TradespersonProfile).findOne({ where: { userId: user.id } });
    if (profile?.verificationStatus === VerificationStatus.SUSPENDED) {
      throw forbidden("Your professional account is suspended. Contact support.", "ACCOUNT_SUSPENDED");
    }
  }
  return startSession(req, res, user);
}

export async function refresh(req: Request, res: Response) {
  const raw = req.cookies?.[REFRESH_COOKIE];
  if (!raw) throw unauthorized("Session expired", "SESSION_EXPIRED");
  let rotated;
  try {
    rotated = await rotateRefreshToken(raw, req.get("user-agent"));
  } catch (err) {
    clearRefreshCookie(res);
    throw err;
  }
  const user = await users().findOne({ where: { id: rotated.userId } });
  if (!user || user.deletedAt) {
    clearRefreshCookie(res);
    throw unauthorized("Session expired", "SESSION_EXPIRED");
  }
  if (user.isSuspended) {
    await revokeAllRefreshTokens(user.id);
    clearRefreshCookie(res);
    throw forbidden("Your account has been suspended. Contact support.", "ACCOUNT_SUSPENDED");
  }
  setRefreshCookie(res, rotated.raw);
  return res.json({ token: signAccessToken(user), expiresIn: config().accessTokenTtlSec, user: toSelfUser(user) });
}

export async function logout(req: Request, res: Response) {
  const raw = req.cookies?.[REFRESH_COOKIE];
  if (raw) await revokeRefreshToken(raw);
  clearRefreshCookie(res);
  return res.json({ ok: true });
}

export async function logoutEverywhere(req: Request, res: Response) {
  await users().increment({ id: req.user!.id }, "tokenVersion", 1);
  await revokeAllRefreshTokens(req.user!.id);
  await invalidateAuthState(req.user!.id);
  clearRefreshCookie(res);
  return res.json({ ok: true });
}

export async function sseTicket(req: Request, res: Response) {
  return res.json({ ticket: await createSseTicket(req.user!.id), expiresIn: 30 });
}

export async function me(req: Request, res: Response) {
  const user = await users().findOne({ where: { id: req.user!.id } });
  if (!user) throw unauthorized("Account not found");
  return res.json({ user: toSelfUser(user) });
}

export async function updateMe(req: Request, res: Response) {
  const user = await users().findOne({ where: { id: req.user!.id } });
  if (!user) throw unauthorized("Account not found");
  const body = req.valid.body;
  if (body.name !== undefined) user.name = body.name || undefined;
  if (body.phone !== undefined) user.phone = body.phone || undefined;
  if (body.timezone !== undefined) user.timezone = body.timezone;
  if (body.notificationPrefs !== undefined) {
    const merged: Record<string, boolean> = { ...(user.notificationPrefs || {}) };
    for (const [key, value] of Object.entries(body.notificationPrefs as Record<string, boolean>)) {
      if (isNotificationType(key)) merged[key] = value;
    }
    user.notificationPrefs = merged;
  }
  if (body.emailNotifications !== undefined) {
    user.notificationPrefs = { ...(user.notificationPrefs || {}), [EMAIL_PREF_KEY]: body.emailNotifications };
  }
  if (body.quoteViewNudgeHours !== undefined) user.quoteViewNudgeHours = body.quoteViewNudgeHours;
  await users().save(user);
  return res.json({ user: toSelfUser(user) });
}

export async function uploadAvatar(req: Request, res: Response) {
  const files = filesOf(req, "file");
  if (!files.length) throw badRequest("Choose an image to upload", "NO_FILES");
  const [upload] = await storeUploads(files, { kind: UploadKind.AVATAR, ownerUserId: req.user!.id });
  const user = await users().findOneOrFail({ where: { id: req.user!.id } });
  const previous = user.avatarUrl;
  user.avatarUrl = fileRef(upload.name);
  await users().save(user);
  if (previous) await deleteUploadByRef(previous);
  return res.json({ user: toSelfUser(user) });
}

export async function changePassword(req: Request, res: Response) {
  const { currentPassword, newPassword } = req.valid.body;
  const user = await users()
    .createQueryBuilder("u")
    .addSelect("u.passwordHash")
    .where("u.id = :id", { id: req.user!.id })
    .getOneOrFail();
  if (!(await comparePassword(currentPassword, user.passwordHash))) {
    throw badRequest("Current password is incorrect", "INVALID_CREDENTIALS");
  }
  await users().update(
    { id: user.id },
    { passwordHash: await hashPassword(newPassword), tokenVersion: user.tokenVersion + 1 }
  );
  await revokeAllRefreshTokens(user.id);
  await invalidateAuthState(user.id);
  user.tokenVersion += 1;
  return startSession(req, res, user);
}

export async function verifyEmail(req: Request, res: Response) {
  const userId = await consumeEmailToken(req.valid.body.token, "verify");
  await users().update({ id: userId, emailVerifiedAt: IsNull() }, { emailVerifiedAt: new Date() });
  await invalidateAuthState(userId);
  return res.json({ ok: true, message: "Email verified" });
}

export async function resendVerification(req: Request, res: Response) {
  const user = await users().findOneOrFail({ where: { id: req.user!.id } });
  if (user.emailVerifiedAt) return res.json({ ok: true, message: "Email is already verified" });
  await sendEmailToken(user, "verify");
  return res.json({ ok: true, message: "Verification email sent" });
}

export async function forgotPassword(req: Request, res: Response) {
  const user = await users().findOne({ where: { email: req.valid.body.email } });
  if (user && !user.deletedAt && !user.isSuspended) await sendEmailToken(user, "reset");
  // Same answer either way so the endpoint can't be used to discover accounts.
  return res.json({ ok: true, message: "If that email has an account, a reset link is on its way." });
}

export async function resetPassword(req: Request, res: Response) {
  const { token, password } = req.valid.body;
  const userId = await consumeEmailToken(token, "reset");
  await users().increment({ id: userId }, "tokenVersion", 1);
  await users().update(
    { id: userId },
    { passwordHash: await hashPassword(password), emailVerifiedAt: () => `COALESCE("emailVerifiedAt", now())` }
  );
  await revokeAllRefreshTokens(userId);
  await invalidateAuthState(userId);
  clearRefreshCookie(res);
  return res.json({ ok: true, message: "Password updated. Log in with your new password." });
}

/**
 * Account deletion: personal data is anonymized; jobs, payments and audit records stay
 * for the other party and for accounting.
 */
export async function deleteAccount(req: Request, res: Response) {
  const { password } = req.valid.body;
  const user = await users()
    .createQueryBuilder("u")
    .addSelect("u.passwordHash")
    .where("u.id = :id", { id: req.user!.id })
    .getOneOrFail();
  if (user.role === UserRole.ADMIN) throw forbidden("Admin accounts can't be deleted here");
  if (!(await comparePassword(password, user.passwordHash))) {
    throw badRequest("Password is incorrect", "INVALID_CREDENTIALS");
  }
  const openWork = await AppDataSource.query(
    `SELECT 1 FROM "jobs" j LEFT JOIN "bids" b ON b."id" = j."acceptedBidId"
     WHERE (j."homeownerId" = $1 OR b."tradespersonId" = $1)
       AND j."status" IN ('awarded','in_progress','pending_confirmation','disputed') LIMIT 1`,
    [user.id]
  );
  if (openWork.length) {
    throw conflict("Finish or cancel your active jobs before deleting your account", "ACTIVE_JOBS");
  }
  // Profile files (avatar, portfolio, licence) go with the account; job files stay with the job record.
  const profileKinds = [UploadKind.AVATAR, UploadKind.GALLERY, UploadKind.CASE_STUDY, UploadKind.LICENSE];
  const removed = await AppDataSource.transaction(async (m) => {
    await m.update(User, { id: user.id }, {
      email: `deleted-${user.id}@deleted.fixlocal.invalid`,
      name: "Deleted user",
      passwordHash: await hashPassword(randomToken(24)),
      notificationPrefs: null,
      deletedAt: new Date(),
      tokenVersion: user.tokenVersion + 1,
    });
    await m.query(`UPDATE "users" SET "phone" = NULL, "avatarUrl" = NULL WHERE "id" = $1`, [user.id]);
    await m.delete(UserTemplate, { userId: user.id });
    await m.query(`UPDATE "jobs" SET "status" = 'cancelled' WHERE "homeownerId" = $1 AND "status" = 'open'`, [user.id]);
    await m.query(`UPDATE "bids" SET "status" = 'withdrawn' WHERE "tradespersonId" = $1 AND "status" = 'active'`, [user.id]);
    if (user.role === UserRole.TRADESPERSON) {
      await m.query(
        `UPDATE "tradesperson_profiles" SET "bio" = NULL, "lat" = NULL, "lng" = NULL, "galleryUrls" = '[]',
           "caseStudies" = '[]', "licenseDocUrl" = NULL, "verificationStatus" = 'suspended' WHERE "userId" = $1`,
        [user.id]
      );
    }
    const files = await m.find(Upload, { where: { ownerUserId: user.id, kind: In(profileKinds) }, select: { name: true } });
    await m.delete(Upload, { ownerUserId: user.id, kind: In(profileKinds) });
    return files.map((f) => fileRef(f.name));
  });
  await discardFiles(removed);
  await revokeAllRefreshTokens(user.id);
  await invalidateAuthState(user.id);
  await writeAudit({
    actorUserId: user.id,
    actorEmail: user.email,
    action: AuditAction.USER_DELETE,
    targetType: "user",
    targetId: user.id,
    summary: "User deleted their account",
  });
  clearRefreshCookie(res);
  return res.json({ ok: true });
}

// ---- saved templates ----

export async function listTemplates(req: Request, res: Response) {
  const rows = await AppDataSource.getRepository(UserTemplate).find({
    where: { userId: req.user!.id },
    order: { kind: "ASC", position: "ASC" },
  });
  const out: Record<TemplateKind, Record<string, unknown>[]> = {
    invite: [],
    counter: [],
    homeownerCounter: [],
    intro: [],
    namedJob: [],
  };
  for (const r of rows) out[r.kind]?.push(r.data);
  return res.json({ templates: out });
}

export const templateKindParams = z.object({ kind: z.enum(TEMPLATE_KINDS) });

export async function replaceTemplates(req: Request, res: Response) {
  const kind = req.valid.params.kind as TemplateKind;
  const items = normalizeTemplates(kind, req.valid.body.items);
  await AppDataSource.transaction(async (m) => {
    await m.delete(UserTemplate, { userId: req.user!.id, kind });
    if (items.length) {
      await m.save(
        items.map((data, position) => m.create(UserTemplate, { userId: req.user!.id, kind, position, data }))
      );
    }
  });
  return res.json({ kind, items });
}

/** Existing users accept the current Terms / Privacy Policy (shown after an update). */
export async function acceptTerms(req: Request, res: Response) {
  await users().update({ id: req.user!.id }, { termsAcceptedAt: new Date(), termsVersion: TERMS_VERSION });
  const user = await users().findOneOrFail({ where: { id: req.user!.id } });
  return res.json({ user: toSelfUser(user) });
}

/**
 * Download everything FixLocal holds about the signed-in user as JSON (DPDP Act 2023 "right to
 * access"). Secrets (password hash, token hashes) are never included; other people's personal
 * details are reduced to ids.
 */
export async function exportMyData(req: Request, res: Response) {
  const id = req.user!.id;
  const q = <T = Record<string, unknown>>(sql: string) => AppDataSource.query(sql, [id]) as Promise<T[]>;
  const [account] = await q(
    `SELECT "id", "email", "role", "name", "phone", "avatarUrl", "timezone", "isSuspended", "emailVerifiedAt",
            "termsAcceptedAt", "termsVersion", "notificationPrefs", "quoteViewNudgeHours", "createdAt", "updatedAt"
       FROM "users" WHERE "id" = $1`
  );
  const [
    profile, jobs, bids, messages, reviewsWritten, reviewsReceived, notifications, favorites, blocks, reports,
    disputes, ledger, uploads, templates,
  ] = await Promise.all([
    q(`SELECT * FROM "tradesperson_profiles" WHERE "userId" = $1`),
    q(`SELECT "id", "title", "description", "category", "status", "budgetMin", "budgetMax", "address", "area", "city",
              "pincode", "lat", "lng", "paymentStatus", "photoUrls", "createdAt", "completedAt"
         FROM "jobs" WHERE "homeownerId" = $1 ORDER BY "createdAt"`),
    q(`SELECT "id", "jobId", "amount", "message", "etaDays", "quoteAmount", "quoteNotes", "quoteHistory", "status", "createdAt"
         FROM "bids" WHERE "tradespersonId" = $1 ORDER BY "createdAt"`),
    q(`SELECT "id", "jobId", "threadTradespersonId", "body", "attachmentUrls", "quote", "createdAt"
         FROM "messages" WHERE "senderId" = $1 ORDER BY "createdAt"`),
    q(`SELECT "id", "jobId", "direction", "rating", "comment", "revieweeId", "createdAt" FROM "reviews" WHERE "reviewerId" = $1`),
    q(`SELECT "id", "jobId", "direction", "rating", "comment", "createdAt" FROM "reviews" WHERE "revieweeId" = $1`),
    q(`SELECT "id", "type", "title", "body", "link", "read", "createdAt" FROM "notifications" WHERE "userId" = $1
         ORDER BY "createdAt" DESC LIMIT 1000`),
    q(`SELECT "targetType", "targetId", "notes", "tags", "createdAt" FROM "favorites" WHERE "userId" = $1`),
    q(`SELECT "blockedId", "createdAt" FROM "user_blocks" WHERE "blockerId" = $1`),
    q(`SELECT "id", "targetType", "targetId", "reason", "status", "createdAt" FROM "reports" WHERE "reporterId" = $1`),
    q(`SELECT "id", "jobId", "reason", "status", "resolution", "resolutionNotes", "createdAt", "resolvedAt"
         FROM "disputes" WHERE "raisedByUserId" = $1`),
    q(`SELECT "id", "jobId", "milestoneId", "type", "amount", "note", "createdAt",
              CASE WHEN "payeeUserId" = $1 THEN 'received' ELSE 'paid' END AS "direction"
         FROM "ledger_entries" WHERE "payeeUserId" = $1 OR "payerUserId" = $1 ORDER BY "createdAt"`),
    q(`SELECT "name", "kind", "jobId", "mime", "size", "originalName", "createdAt" FROM "uploads" WHERE "ownerUserId" = $1`),
    q(`SELECT "kind", "position", "data", "createdAt" FROM "user_templates" WHERE "userId" = $1`),
  ]);
  const body = {
    exportedAt: new Date().toISOString(),
    format: "fixlocal-export-v1",
    note: "Payments on FixLocal are simulated; ledger amounts are not real money movements.",
    account,
    professionalProfile: profile[0] ?? null,
    jobsPosted: jobs,
    bids,
    messagesSent: messages,
    reviewsWritten,
    reviewsReceived,
    notifications,
    favorites,
    blockedUsers: blocks,
    reportsFiled: reports,
    disputesRaised: disputes,
    escrowLedger: ledger,
    files: uploads,
    templates,
  };
  res.setHeader("Content-Disposition", `attachment; filename="fixlocal-data-${new Date().toISOString().slice(0, 10)}.json"`);
  res.setHeader("Cache-Control", "no-store");
  return res.json(body);
}
