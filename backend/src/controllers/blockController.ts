import type { Request, Response } from "express";
import { AppDataSource } from "../data-source";
import { UserBlock } from "../entities/UserBlock";
import { User, UserRole } from "../entities/User";
import { badRequest, notFound } from "../http/errors";

const blocks = () => AppDataSource.getRepository(UserBlock);

/** People the signed-in user has blocked (names only; never emails). */
export async function listBlocks(req: Request, res: Response) {
  const rows: Array<{ userId: string; name: string | null; role: UserRole; createdAt: Date }> = await AppDataSource.query(
    `SELECT b."blockedId" AS "userId", u."name", u."role", b."createdAt"
       FROM "user_blocks" b JOIN "users" u ON u."id" = b."blockedId"
      WHERE b."blockerId" = $1
      ORDER BY b."createdAt" DESC
      LIMIT 200`,
    [req.user!.id]
  );
  return res.json({ blocks: rows.map((r) => ({ ...r, name: r.name || "FixLocal user" })) });
}

export async function blockUser(req: Request, res: Response) {
  const targetId = req.valid.body.userId as string;
  if (targetId === req.user!.id) throw badRequest("You can't block yourself", "INVALID_TARGET");
  const target = await AppDataSource.getRepository(User).findOne({ where: { id: targetId }, select: { id: true, role: true } });
  if (!target) throw notFound("User not found");
  if (target.role === UserRole.ADMIN) throw badRequest("Support staff can't be blocked; report the message instead", "INVALID_TARGET");
  await blocks().createQueryBuilder().insert().into(UserBlock).values({ blockerId: req.user!.id, blockedId: targetId }).orIgnore().execute();
  return res.status(201).json({ blocked: true, userId: targetId });
}

export async function unblockUser(req: Request, res: Response) {
  await blocks().delete({ blockerId: req.user!.id, blockedId: req.valid.params.userId });
  return res.json({ blocked: false, userId: req.valid.params.userId });
}
