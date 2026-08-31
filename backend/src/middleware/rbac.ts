import { Request, Response, NextFunction } from "express";
import { UserRole } from "../entities/User";

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized", code: "UNAUTHORIZED" });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
    }
    next();
  };
}
