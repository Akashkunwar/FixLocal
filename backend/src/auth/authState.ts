import { AppDataSource } from "../data-source";
import { User, UserRole } from "../entities/User";
import { TradespersonProfile, VerificationStatus } from "../entities/TradespersonProfile";
import { redisClient } from "../utils/cache";

export type AuthState = {
  id: string;
  email: string;
  role: UserRole;
  tokenVersion: number;
  isSuspended: boolean;
  deleted: boolean;
  emailVerified: boolean;
  proVerified: boolean;
};

const TTL_MS = 30_000;
const memory = new Map<string, { state: AuthState; expiresAt: number }>();
const redisKey = (userId: string) => `fixlocal:auth-state:${userId}`;

async function loadFromDb(userId: string): Promise<AuthState | null> {
  const user = await AppDataSource.getRepository(User).findOne({ where: { id: userId } });
  if (!user) return null;
  let proVerified = false;
  if (user.role === UserRole.TRADESPERSON) {
    const profile = await AppDataSource.getRepository(TradespersonProfile).findOne({
      where: { userId },
      select: { id: true, verificationStatus: true },
    });
    proVerified = profile?.verificationStatus === VerificationStatus.VERIFIED;
  }
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    tokenVersion: user.tokenVersion,
    isSuspended: user.isSuspended,
    deleted: !!user.deletedAt,
    emailVerified: !!user.emailVerifiedAt,
    proVerified,
  };
}

/** Per-request account state, cached briefly so suspensions apply within seconds. */
export async function getAuthState(userId: string): Promise<AuthState | null> {
  const redis = redisClient();
  if (redis) {
    try {
      const raw = await redis.get(redisKey(userId));
      if (raw) return JSON.parse(raw) as AuthState;
    } catch {
      /* fall through to DB */
    }
  } else {
    const hit = memory.get(userId);
    if (hit && hit.expiresAt > Date.now()) return hit.state;
  }
  const state = await loadFromDb(userId);
  if (!state) return null;
  if (redis) {
    try {
      await redis.set(redisKey(userId), JSON.stringify(state), { PX: TTL_MS });
    } catch {
      /* best effort */
    }
  } else {
    memory.set(userId, { state, expiresAt: Date.now() + TTL_MS });
  }
  return state;
}

export async function invalidateAuthState(userId: string): Promise<void> {
  memory.delete(userId);
  const redis = redisClient();
  if (redis) {
    try {
      await redis.del(redisKey(userId));
    } catch {
      /* best effort */
    }
  }
}

export function clearAuthStateMemory() {
  memory.clear();
}
