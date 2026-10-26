import crypto from "crypto";
import type { Request, Response } from "express";
import { AppDataSource } from "../data-source";
import { User } from "../entities/User";
import { appLink } from "../services/mailer";

// No 0/O, 1/I/L: codes get read out over the phone and typed on small keyboards.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function newReferralCode(length = 8): string {
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

/** The user's code, created on first use (unique; retried on the rare collision). */
async function ensureCode(userId: string): Promise<string> {
  const repo = AppDataSource.getRepository(User);
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await repo.findOne({ where: { id: userId }, select: { id: true, referralCode: true } });
    if (current?.referralCode) return current.referralCode;
    try {
      // Conditional so two first-visits at once can't hand out two codes.
      await repo
        .createQueryBuilder()
        .update()
        .set({ referralCode: newReferralCode() })
        .where(`"id" = :id AND "referralCode" IS NULL`, { id: userId })
        .execute();
    } catch (err) {
      if ((err as { code?: string }).code !== "23505") throw err;
    }
  }
  throw new Error("Could not allocate a referral code");
}

type Row = { name: string | null; createdAt: Date; confirmed: boolean; completed: boolean };

/** POST: create the code if needed (idempotent), then the same body as GET. */
export async function createMyReferralCode(req: Request, res: Response) {
  await ensureCode(req.user!.id);
  return getMyReferrals(req, res);
}

/** GET is read-only: `code` is null until the user creates one. */
export async function getMyReferrals(req: Request, res: Response) {
  const me = await AppDataSource.getRepository(User).findOne({ where: { id: req.user!.id }, select: { id: true, referralCode: true } });
  const code = me?.referralCode ?? null;
  const rows: Row[] = await AppDataSource.query(
    `SELECT u."name", u."createdAt", (u."emailVerifiedAt" IS NOT NULL) AS "confirmed",
            (EXISTS (SELECT 1 FROM "jobs" j WHERE j."homeownerId" = u."id" AND j."status" = 'completed')
             OR EXISTS (SELECT 1 FROM "jobs" j JOIN "bids" b ON b."id" = j."acceptedBidId"
                         WHERE b."tradespersonId" = u."id" AND j."status" = 'completed')) AS "completed"
       FROM "users" u
      WHERE u."referredById" = $1 AND u."deletedAt" IS NULL
      ORDER BY u."createdAt" DESC
      LIMIT 100`,
    [req.user!.id]
  );
  const link = code ? appLink(`/register?ref=${code}`) : null;
  return res.json({
    referral: {
      code,
      link,
      shareText: link ? `I use FixLocal to find verified local professionals. Join with my link: ${link}` : null,
      totals: {
        joined: rows.length,
        confirmed: rows.filter((r) => r.confirmed).length,
        completedFirstJob: rows.filter((r) => r.completed).length,
      },
      // First names only: the people you invited don't share their details with you.
      people: rows.map((r) => ({
        firstName: (r.name || "").trim().split(/\s+/)[0] || "Someone",
        joinedAt: r.createdAt,
        status: r.completed ? "completed_first_job" : r.confirmed ? "confirmed" : "joined",
      })),
    },
  });
}
