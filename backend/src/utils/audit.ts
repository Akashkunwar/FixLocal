import { AppDataSource } from "../data-source";
import { AuditLog, AuditAction } from "../entities/AuditLog";
import type { EntityManager } from "typeorm";

export { AuditAction };

/** Actor id for automated actions (auto-confirm, cleanup). */
export const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

export async function writeAudit(
  input: {
    actorUserId: string;
    actorEmail?: string;
    action: AuditAction;
    targetType?: string;
    targetId?: string;
    summary?: string;
    meta?: Record<string, unknown>;
  },
  manager: EntityManager = AppDataSource.manager
) {
  return manager.save(
    manager.create(AuditLog, {
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      summary: input.summary?.slice(0, 2000),
      meta: input.meta,
    })
  );
}
