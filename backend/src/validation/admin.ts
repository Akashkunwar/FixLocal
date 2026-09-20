import { z } from "zod";
import { AuditAction } from "../entities/AuditLog";
import { UserRole } from "../entities/User";
import { VerificationStatus } from "../entities/TradespersonProfile";
import { boolish, enumOf, id, isoDate, limit, optionalText, page, requiredText } from "./common";

export const listUsersQuery = z.object({
  role: z.preprocess((v) => (typeof v === "string" && v ? v.toUpperCase() : undefined), enumOf(UserRole).optional()),
  q: optionalText(100),
  suspended: boolish.optional(),
  page,
  limit: limit(200),
});

export const suspendBody = z.object({ suspended: boolish });

export const listTradespeopleQuery = z.object({
  status: z.preprocess((v) => (v === "" ? undefined : v), enumOf(VerificationStatus, "Invalid status").optional()),
  page,
  limit: limit(200),
});

export const verifyBody = z.object({
  status: z.preprocess((v) => v ?? "verified", enumOf(VerificationStatus, "status must be verified, rejected, suspended or pending")),
});

export const auditLogsQuery = z.object({
  action: z.preprocess((v) => (v === "" ? undefined : v), enumOf(AuditAction, "Unknown action").optional()),
  limit: limit(100),
  before: z.preprocess((v) => (v === "" ? undefined : v), isoDate.optional()),
});

export const adminNoteBody = z.object({
  note: requiredText(2000),
  targetType: optionalText(64),
  targetId: z.preprocess((v) => (v === "" ? undefined : v), id.optional()),
  summary: optionalText(200),
});

export const rollbackBody = z.object({ auditLogId: id });

export const forceCancelBody = z.object({ reason: optionalText(500) });

export { id };
