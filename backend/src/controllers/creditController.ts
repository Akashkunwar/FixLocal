import type { Request, Response } from "express";
import { AppDataSource } from "../data-source";
import { config } from "../config";
import { creditBalance } from "../domain/credits";

/** The signed-in user's FixLocal credit: balance, history and how it is earned and used. */
export async function getMyCredits(req: Request, res: Response) {
  const userId = req.user!.id;
  const [balance, entries] = await Promise.all([
    creditBalance(AppDataSource.manager, userId),
    AppDataSource.query(
      `SELECT c."id", c."kind", c."amount", c."note", c."jobId", j."title" AS "jobTitle", c."createdAt"
         FROM "credit_entries" c LEFT JOIN "jobs" j ON j."id" = c."jobId"
        WHERE c."userId" = $1 ORDER BY c."createdAt" DESC LIMIT 50`,
      [userId]
    ) as Promise<{ id: string; kind: string; amount: string; note: string | null; jobId: string | null; jobTitle: string | null; createdAt: Date }[]>,
  ]);
  const { rewardInr, minJobInr } = config().referral;
  return res.json({
    credits: {
      balance: Math.max(0, balance),
      rewardAmount: rewardInr,
      minJobAmount: minJobInr,
      usedAt: req.user!.role === "TRADESPERSON" ? "payout" : "payment",
      simulated: true,
      entries: entries.map((e) => ({ ...e, amount: Number(e.amount) })),
    },
  });
}
