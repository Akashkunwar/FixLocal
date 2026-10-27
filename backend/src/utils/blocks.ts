import { AppDataSource } from "../data-source";

/** True when either user has blocked the other. */
export async function isBlockedBetween(a: string | null | undefined, b: string | null | undefined): Promise<boolean> {
  if (!a || !b || a === b) return false;
  const rows = await AppDataSource.query(
    `SELECT 1 FROM "user_blocks"
      WHERE ("blockerId" = $1 AND "blockedId" = $2) OR ("blockerId" = $2 AND "blockedId" = $1) LIMIT 1`,
    [a, b]
  );
  return rows.length > 0;
}
