import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { QueryFailedError } from "typeorm";
import { HttpError } from "../http/errors";
import { ValidationFailure } from "./validate";
import { logger } from "../logger";
import { reportError } from "../services/errorReporter";

type PgError = { code?: string; detail?: string; constraint?: string };

const PG_BAD_INPUT = new Set(["22P02", "22007", "22008", "22003", "22001", "22023", "22004"]);

/** A specific message for failures people actually hit, so the page can say more than "Invalid request". */
function describeValidation(err: ValidationFailure): { message: string; code: string } {
  const paths = err.issues.map((i) => i.path);
  if (paths.includes("body.token")) {
    return { message: "This link is invalid or has expired. Ask for a new one.", code: "TOKEN_INVALID" };
  }
  if (paths.length && paths.every((p) => p.startsWith("params."))) {
    return { message: "We couldn't find that. The link may be wrong or out of date.", code: "INVALID_ID" };
  }
  return { message: "Invalid request", code: "VALIDATION" };
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.path}`, code: "ROUTE_NOT_FOUND" });
}

export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) return next(err);

  if (err instanceof ValidationFailure) {
    return res.status(400).json({ ...describeValidation(err), issues: err.issues });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ message: err.message, code: err.code, ...(err.details || {}) });
  }
  if (err instanceof multer.MulterError) {
    const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    return res.status(status).json({ message: err.message, code: "UPLOAD_ERROR" });
  }
  const typed = err as { type?: string; status?: number };
  if (typed?.type === "entity.parse.failed") {
    return res.status(400).json({ message: "Request body is not valid JSON", code: "INVALID_JSON" });
  }
  if (typed?.type === "entity.too.large") {
    return res.status(413).json({ message: "Request body is too large", code: "PAYLOAD_TOO_LARGE" });
  }
  if (err instanceof QueryFailedError) {
    const pg = (err as QueryFailedError & { driverError?: PgError }).driverError || {};
    if (pg.code === "23505") {
      return res.status(409).json({ message: "This record already exists", code: "DUPLICATE" });
    }
    if (pg.code === "23514") {
      return res.status(400).json({ message: "A value is outside the allowed range", code: "CONSTRAINT" });
    }
    if (pg.code === "23503") {
      return res.status(400).json({ message: "A referenced record does not exist", code: "INVALID_REFERENCE" });
    }
    if (pg.code && PG_BAD_INPUT.has(pg.code)) {
      return res.status(400).json({ message: "Invalid input", code: "INVALID_INPUT" });
    }
  }

  const requestId = (req as Request & { id?: unknown }).id;
  logger.error({ err, reqId: requestId, path: req.path }, "unhandled error");
  reportError(err, { requestId, method: req.method, path: req.route?.path ?? req.path, userId: req.user?.id ?? null });
  return res.status(500).json({ message: "Something went wrong on our side. Please try again.", code: "INTERNAL", requestId });
}
