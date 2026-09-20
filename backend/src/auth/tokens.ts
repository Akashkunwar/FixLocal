import crypto from "crypto";
import jwt from "jsonwebtoken";
import { IsNull } from "typeorm";
import { AppDataSource } from "../data-source";
import { config } from "../config";
import { RefreshToken } from "../entities/RefreshToken";
import { UserRole } from "../entities/User";
import { redisClient } from "../utils/cache";
import { unauthorized } from "../http/errors";

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

/**
 * Exchange a refresh token for a new one. Reusing an already-rotated token
 * revokes the whole family (likely theft).
 */
export async function rotateRefreshToken(raw: string, userAgent?: string | null) {
  const row = await refreshRepo().findOne({ where: { tokenHash: sha256(raw) } });
  if (!row) throw unauthorized("Session expired", "SESSION_EXPIRED");
  if (row.revokedAt) {
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
    // Lost a race with a concurrent refresh using the same token.
    await revokeFamily(row.familyId);
    throw unauthorized("Session expired", "SESSION_EXPIRED");
  }
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
