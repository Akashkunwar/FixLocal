import type { NextFunction, Request, Response } from "express";
import { consumeSseTicket, verifyAccessToken } from "../auth/tokens";
import { getAuthState, type AuthState } from "../auth/authState";
import { forbidden, unauthorized } from "../http/errors";
import { UserRole } from "../entities/User";

function bearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7).trim() || null;
  return null;
}

function attach(req: Request, state: AuthState) {
  req.user = {
    id: state.id,
    email: state.email,
    role: state.role,
    emailVerified: state.emailVerified,
    proVerified: state.proVerified,
  };
}

function checkState(state: AuthState | null): AuthState {
  if (!state || state.deleted) throw unauthorized("Account not found", "UNAUTHORIZED");
  if (state.isSuspended) throw forbidden("Your account has been suspended. Contact support.", "ACCOUNT_SUSPENDED");
  return state;
}

/** Bearer access token only (never from the query string). */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = bearer(req);
  if (!token) return next(unauthorized("Missing or invalid token"));
  let claims;
  try {
    claims = verifyAccessToken(token);
  } catch {
    return next(unauthorized("Invalid or expired token", "TOKEN_EXPIRED"));
  }
  const state = checkState(await getAuthState(claims.sub));
  if (state.tokenVersion !== claims.tv || state.role !== claims.role) {
    return next(unauthorized("Session is no longer valid", "TOKEN_REVOKED"));
  }
  attach(req, state);
  next();
}

/** SSE streams: a one-time ticket from POST /api/auth/sse-ticket, or a bearer header. */
export async function requireStreamAuth(req: Request, res: Response, next: NextFunction) {
  const ticket = typeof req.query.ticket === "string" ? req.query.ticket : "";
  if (!ticket) return requireAuth(req, res, next);
  const userId = await consumeSseTicket(ticket);
  if (!userId) return next(unauthorized("Stream ticket is invalid or expired", "TICKET_INVALID"));
  attach(req, checkState(await getAuthState(userId)));
  next();
}

export function requireVerifiedEmail(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  if (req.user.role === UserRole.ADMIN || req.user.emailVerified) return next();
  next(forbidden("Verify your email address to continue", "EMAIL_NOT_VERIFIED"));
}
