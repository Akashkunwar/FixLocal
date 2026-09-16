import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../utils/jwt";

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);
  const q = req.query.token ?? req.query.access_token;
  if (typeof q === "string" && q.trim()) return q.trim();
  return null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ message: "Missing or invalid token", code: "UNAUTHORIZED" });
  }

  try {
    const payload = verifyToken(token);
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token", code: "UNAUTHORIZED" });
  }
}
