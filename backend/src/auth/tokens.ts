import crypto from "crypto";
import jwt from "jsonwebtoken";
import { IsNull } from "typeorm";
import { AppDataSource } from "../data-source";
import { config } from "../config";
import { RefreshToken } from "../entities/RefreshToken";
import { UserRole } from "../entities/User";
import { redisClient } from "../utils/cache";
import { conflict, unauthorized } from "../http/errors";

export type AccessClaims = {
  sub: string;
  email: string;
  role: UserRole;
  tv: number;
};

export const REFRESH_COOKIE = "fl_refresh";
export const REFRESH_COOKIE_PATH = "/api/auth";

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function signAccessToken(user: { id: string; email: string; role: UserRole; tokenVersion: number }): string {
  const claims: AccessClaims = { sub: user.id, email: user.email, role: user.role, tv: user.tokenVersion };
  return jwt.sign(claims, config().jwtSecret, {
    algorithm: "HS256",
    expiresIn: config().accessTokenTtlSec,
  });
}

export function verifyAccessToken(token: string): AccessClaims {
  const payload = jwt.verify(token, config().jwtSecret, { algorithms: ["HS256"] });
  if (typeof payload !== "object" || !payload || typeof payload.sub !== "string" || typeof payload.tv !== "number") {
    throw new Error("Malformed token");
  }
  return payload as unknown as AccessClaims;
}

const refreshRepo = () => AppDataSource.getRepository(RefreshToken);

export async function issueRefreshToken(
  userId: string,
  opts: { familyId?: string; userAgent?: string | null } = {}
): Promise<{ raw: string; row: RefreshToken }> {
  const raw = randomToken(32);
  const row = await refreshRepo().save(
    refreshRepo().create({
      userId,
      tokenHash: sha256(raw),
      familyId: opts.familyId || crypto.randomUUID(),
      expiresAt: new Date(Date.now() + config().refreshTokenTtlDays * 86400_000),
      userAgent: opts.userAgent ? opts.userAgent.slice(0, 255) : null,
    })
  );
  return { raw, row };
}

// ---- refresh grace window ----
// Two tabs (or a retried request) often send the same refresh token at once. Within a few seconds
// of a rotation, re-sending the token that was just rotated gets the *same* new token back instead
// of revoking the session family. The new token is stored encrypted with a key derived from the old
// token itself, so only a holder of the old token can read it, and only for GRACE_SEC.

export const REFRESH_GRACE_SEC = 10;
const graceMemory = new Map<string, { value: string; expiresAt: number }>();
const graceKey = (oldRaw: string) => `fixlocal:refresh-grace:${sha256(`id:${oldRaw}`)}`;

function sealFor(oldRaw: string, plain: string): string {
  const key = crypto.createHash("sha256").update(`grace-key:${oldRaw}`).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

function openWith(oldRaw: string, sealed: string): string | null {
  try {
    const buf = Buffer.from(sealed, "base64url");
    const key = crypto.createHash("sha256").update(`grace-key:${oldRaw}`).digest();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

async function rememberRotation(oldRaw: string, userId: string, nextRaw: string) {
  const sealed = sealFor(oldRaw, JSON.stringify({ userId, raw: nextRaw }));
  const redis = redisClient();
  if (redis) {
    await redis.set(graceKey(oldRaw), sealed, { EX: REFRESH_GRACE_SEC });
  } else {
    graceMemory.set(graceKey(oldRaw), { value: sealed, expiresAt: Date.now() + REFRESH_GRACE_SEC * 1000 });
  }
}

async function recallRotation(oldRaw: string): Promise<{ userId: string; raw: string } | null> {
  const redis = redisClient();
  let sealed: string | null = null;
  if (redis) {
    sealed = await redis.get(graceKey(oldRaw));
  } else {
    const hit = graceMemory.get(graceKey(oldRaw));
    if (hit && hit.expiresAt > Date.now()) sealed = hit.value;
    else graceMemory.delete(graceKey(oldRaw));
  }
  const plain = sealed ? openWith(oldRaw, sealed) : null;
  return plain ? (JSON.parse(plain) as { userId: string; raw: string }) : null;
}

const refreshRace = () => conflict("Your session was refreshed in another tab. Try again.", "REFRESH_IN_PROGRESS");

/**
 * Exchange a refresh token for a new one. Re-sending the token that was just rotated, within
 * REFRESH_GRACE_SEC, returns the same new token (or a 409 to retry, never a logout). Reusing an
 * older rotated token revokes the whole family (likely theft).
 */
export async function rotateRefreshToken(raw: string, userAgent?: string | null) {
  const row = await refreshRepo().findOne({ where: { tokenHash: sha256(raw) } });
  if (!row) throw unauthorized("Session expired", "SESSION_EXPIRED");
  if (row.revokedAt) {
    const withinGrace = !!row.replacedById && Date.now() - row.revokedAt.getTime() < REFRESH_GRACE_SEC * 1000;
    if (withinGrace) {
      const again = await recallRotation(raw);
      if (again && again.userId === row.userId) return again;
      throw refreshRace();
    }
    if (row.replacedById) await revokeFamily(row.familyId);
    throw unauthorized("Session expired", "SESSION_EXPIRED");
  }
  if (row.expiresAt.getTime() <= Date.now()) {
    throw unauthorized("Session expired", "SESSION_EXPIRED");
  }
  const next = await issueRefreshToken(row.userId, { familyId: row.familyId, userAgent });
  const res = await refreshRepo()
    .createQueryBuilder()
    .update(RefreshToken)
    .set({ revokedAt: new Date(), replacedById: next.row.id })
    .where("id = :id AND revokedAt IS NULL", { id: row.id })
    .execute();
  if (!res.affected) {
    // Lost a race with a concurrent refresh of the same token: drop our spare token and hand back
    // the winner's once it is recorded (it is written right after the winner's update).
    await refreshRepo().update({ id: next.row.id }, { revokedAt: new Date() });
    for (let i = 0; i < 10; i++) {
      const again = await recallRotation(raw);
      if (again && again.userId === row.userId) return again;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw refreshRace();
  }
  await rememberRotation(raw, row.userId, next.raw);
  return { userId: row.userId, raw: next.raw };
}

export async function revokeRefreshToken(raw: string) {
  await refreshRepo().update({ tokenHash: sha256(raw), revokedAt: IsNull() }, { revokedAt: new Date() });
}

export async function revokeFamily(familyId: string) {
  await refreshRepo().update({ familyId, revokedAt: IsNull() }, { revokedAt: new Date() });
}

export async function revokeAllRefreshTokens(userId: string) {
  await refreshRepo().update({ userId, revokedAt: IsNull() }, { revokedAt: new Date() });
}

// ---- one-time SSE tickets (EventSource cannot send headers) ----

const memoryTickets = new Map<string, { userId: string; expiresAt: number }>();
const TICKET_TTL_SEC = 30;

export async function createSseTicket(userId: string): Promise<string> {
  const ticket = randomToken(24);
  const redis = redisClient();
  if (redis) {
    await redis.set(`fixlocal:sse-ticket:${sha256(ticket)}`, userId, { EX: TICKET_TTL_SEC });
  } else {
    memoryTickets.set(sha256(ticket), { userId, expiresAt: Date.now() + TICKET_TTL_SEC * 1000 });
  }
  return ticket;
}

export async function consumeSseTicket(ticket: string): Promise<string | null> {
  const key = sha256(ticket);
  const redis = redisClient();
  if (redis) {
    const userId = await redis.getDel(`fixlocal:sse-ticket:${key}`);
    return userId || null;
  }
  const entry = memoryTickets.get(key);
  memoryTickets.delete(key);
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry.userId;
}
