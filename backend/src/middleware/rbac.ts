import type { NextFunction, Request, Response } from "express";
import { UserRole } from "../entities/User";
import { forbidden, unauthorized } from "../http/errors";

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden("Your account type can't do that"));
    next();
  };
}
