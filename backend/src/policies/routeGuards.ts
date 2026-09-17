import type { NextFunction, Request, Response } from "express";
import { AppDataSource } from "../data-source";
import { Bid } from "../entities/Bid";
import { forbidden, notFound } from "../http/errors";
import { assertOwner, loadJobContext } from "./jobPolicy";

/** Ownership checks that must run before multer writes anything. */
export async function authorizeJobOwner(req: Request, _res: Response, next: NextFunction) {
  const ctx = await loadJobContext(req.valid.params.id);
  assertOwner(ctx, { id: req.user!.id, role: req.user!.role });
  next();
}

export async function authorizeBidOwner(req: Request, _res: Response, next: NextFunction) {
  const bid = await AppDataSource.getRepository(Bid).findOne({ where: { id: req.valid.params.id } });
  if (!bid) throw notFound("Bid not found");
  if (bid.tradespersonId !== req.user!.id) throw forbidden("You can only change your own bid");
  next();
}
