import type { NextFunction, Request, Response } from "express";
import { QueryFailedError } from "typeorm";
import { AppDataSource } from "../data-source";
import { IdempotencyKey } from "../entities/IdempotencyKey";
import { badRequest, conflict } from "../http/errors";

const repo = () => AppDataSource.getRepository(IdempotencyKey);

/**
 * Optional Idempotency-Key support for money-moving endpoints.
 * A repeated key replays the first response instead of acting twice.
 */
export async function idempotent(req: Request, res: Response, next: NextFunction) {
  const key = req.header("Idempotency-Key");
  if (!key || !req.user) return next();
  if (key.length > 128) return next(badRequest("Idempotency-Key must be at most 128 characters", "VALIDATION"));
  const path = req.originalUrl.split("?")[0].slice(0, 255);
  let row: IdempotencyKey;
  try {
    row = await repo().save(repo().create({ userId: req.user.id, key, method: req.method, path }));
  } catch (err) {
    const code = (err as QueryFailedError & { driverError?: { code?: string } }).driverError?.code;
    if (!(err instanceof QueryFailedError) || code !== "23505") throw err;
    const existing = await repo().findOne({ where: { userId: req.user.id, key } });
    if (!existing) return next(conflict("Request is being processed", "IDEMPOTENCY_IN_PROGRESS"));
    if (existing.method !== req.method || existing.path !== path) {
      return next(conflict("Idempotency-Key was already used for a different request", "IDEMPOTENCY_MISMATCH"));
    }
    if (existing.statusCode == null) {
      return next(conflict("Request is being processed", "IDEMPOTENCY_IN_PROGRESS"));
    }
    res.setHeader("Idempotent-Replayed", "true");
    return res.status(existing.statusCode).json(existing.responseBody);
  }

  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    const status = res.statusCode;
    if (status >= 500) {
      void repo().delete({ id: row.id });
    } else {
      void repo().update({ id: row.id }, { statusCode: status, responseBody: body as object });
    }
    return originalJson(body);
  };
  res.on("close", () => {
    if (!res.writableFinished) void repo().delete({ id: row.id, statusCode: undefined });
  });
  next();
}
