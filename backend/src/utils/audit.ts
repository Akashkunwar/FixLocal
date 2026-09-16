import { AppDataSource } from "../data-source";
import { AuditLog, AuditAction } from "../entities/AuditLog";

export { AuditAction };

export async function writeAudit(input: {
  actorUserId: string;
  actorEmail?: string;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  summary?: string;
  meta?: Record<string, unknown>;
}) {
  const repo = AppDataSource.getRepository(AuditLog);
  const row = repo.create({
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    summary: input.summary,
    meta: input.meta,
  });
  return repo.save(row);
}
