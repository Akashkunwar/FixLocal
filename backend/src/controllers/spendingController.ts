import type { Request, Response } from "express";
import { AppDataSource } from "../data-source";
import { User } from "../entities/User";
import { monthKeyInZone } from "../domain/time";

const r2 = (n: number) => Math.round(n * 100) / 100;

type JobRow = {
  id: string;
  title: string;
  category: string;
  status: string;
  createdAt: Date;
  completedAt: Date | null;
  escrowAmount: string | null;
  proId: string | null;
  proName: string | null;
};
/** Only client-funded movements: credit-funded rows (credit_*) never count as the client's money. */
type LedgerRow = { jobId: string; type: "hold" | "release" | "refund" | "clawback" | `credit_${string}`; amount: string; createdAt: Date };

/**
 * A client's spending and job history, derived from the escrow ledger (simulated payments):
 * paid to pros (releases), still held in escrow, refunded, by month and by category, top pros, every job.
 */
export async function getMySpending(req: Request, res: Response) {
  const me = req.user!.id;
  const user = await AppDataSource.getRepository(User).findOneOrFail({ where: { id: me } });
  const jobs: JobRow[] = await AppDataSource.query(
    `SELECT j."id", j."title", j."category", j."status", j."createdAt", j."completedAt", j."escrowAmount",
            b."tradespersonId" AS "proId", u."name" AS "proName"
       FROM "jobs" j
       LEFT JOIN "bids" b ON b."id" = j."acceptedBidId"
       LEFT JOIN "users" u ON u."id" = b."tradespersonId"
      WHERE j."homeownerId" = $1
      ORDER BY j."createdAt" DESC`,
    [me]
  );
  const ledger: LedgerRow[] = await AppDataSource.query(
    `SELECT l."jobId", l."type", l."amount", l."createdAt"
       FROM "ledger_entries" l JOIN "jobs" j ON j."id" = l."jobId"
      WHERE j."homeownerId" = $1`,
    [me]
  );

  const perJob = new Map<string, { held: number; paid: number; refunded: number; lastPaidAt: Date | null }>();
  const byMonth = new Map<string, number>();
  for (const l of ledger) {
    const row = perJob.get(l.jobId) || { held: 0, paid: 0, refunded: 0, lastPaidAt: null };
    const amt = Number(l.amount);
    if (l.type === "hold") row.held += amt;
    if (l.type === "refund") row.refunded += amt;
    if (l.type === "clawback") {
      // A released deposit the professional gave back: no longer paid, now refunded.
      row.paid -= amt;
      row.refunded += amt;
      const key = monthKeyInZone(new Date(l.createdAt), user.timezone);
      byMonth.set(key, (byMonth.get(key) || 0) - amt);
    }
    if (l.type === "release") {
      row.paid += amt;
      row.lastPaidAt = !row.lastPaidAt || l.createdAt > row.lastPaidAt ? l.createdAt : row.lastPaidAt;
      const key = monthKeyInZone(new Date(l.createdAt), user.timezone);
      byMonth.set(key, (byMonth.get(key) || 0) + amt);
    }
    perJob.set(l.jobId, row);
  }

  const byCategory = new Map<string, { category: string; jobs: number; paid: number }>();
  const byPro = new Map<string, { proId: string; name: string; jobs: number; paid: number }>();
  let paid = 0;
  let refunded = 0;
  let inEscrow = 0;
  const history = jobs.map((j) => {
    const m = perJob.get(j.id) || { held: 0, paid: 0, refunded: 0, lastPaidAt: null };
    paid += m.paid;
    refunded += m.refunded;
    inEscrow += Math.max(0, m.held - m.paid - m.refunded);
    if (m.paid > 0) {
      const c = byCategory.get(j.category) || { category: j.category, jobs: 0, paid: 0 };
      c.jobs += 1;
      c.paid += m.paid;
      byCategory.set(j.category, c);
      if (j.proId) {
        const p = byPro.get(j.proId) || { proId: j.proId, name: j.proName || "Professional", jobs: 0, paid: 0 };
        p.jobs += 1;
        p.paid += m.paid;
        byPro.set(j.proId, p);
      }
    }
    return {
      jobId: j.id,
      title: j.title,
      category: j.category,
      status: j.status,
      createdAt: j.createdAt,
      completedAt: j.completedAt,
      agreedAmount: j.escrowAmount != null ? Number(j.escrowAmount) : null,
      paid: r2(m.paid),
      refunded: r2(m.refunded),
      inEscrow: r2(Math.max(0, m.held - m.paid - m.refunded)),
      pro: j.proId ? { id: j.proId, name: j.proName || "Professional" } : null,
    };
  });

  // The last 12 months, oldest first, including empty months.
  const months: { month: string; amount: number }[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 15));
    const key = monthKeyInZone(d, user.timezone);
    months.push({ month: key, amount: r2(byMonth.get(key) || 0) });
  }
  const count = (...s: string[]) => jobs.filter((j) => s.includes(j.status)).length;

  return res.json({
    spending: {
      totals: {
        paid: r2(paid),
        inEscrow: r2(inEscrow),
        refunded: r2(refunded),
        jobsPosted: jobs.length,
        jobsCompleted: count("completed"),
        jobsActive: count("awarded", "in_progress", "pending_confirmation", "disputed"),
        jobsOpen: count("open", "bidding_closed"),
        jobsCancelled: count("cancelled"),
        averageJob: byCategory.size ? r2(paid / [...byCategory.values()].reduce((s, c) => s + c.jobs, 0)) : 0,
      },
      months,
      byCategory: [...byCategory.values()].map((c) => ({ ...c, paid: r2(c.paid) })).sort((a, b) => b.paid - a.paid),
      topPros: [...byPro.values()].map((p) => ({ ...p, paid: r2(p.paid) })).sort((a, b) => b.paid - a.paid).slice(0, 5),
      jobs: history,
      note: "Payments on FixLocal are simulated during the pilot.",
    },
  });
}
