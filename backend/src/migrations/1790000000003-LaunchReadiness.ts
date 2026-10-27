import type { MigrationInterface, QueryRunner } from "typeorm";

/** Launch readiness: booking cancellation details, terms acceptance, user blocks, payment provider refs. */
export class LaunchReadiness1790000000003 implements MigrationInterface {
  name = "LaunchReadiness1790000000003";

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE "user_blocks" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "blockerId" uuid NOT NULL, "blockedId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_0bae5f5cab7574a84889462187c" PRIMARY KEY ("id"))`);
    await q.query(`CREATE INDEX "IDX_18d34df8212648b698828f244f" ON "user_blocks" ("blockedId")`);
    await q.query(`CREATE UNIQUE INDEX "UQ_user_block_pair" ON "user_blocks" ("blockerId", "blockedId")`);
    await q.query(`ALTER TABLE "jobs" ADD "cancelledBy" character varying(16)`);
    await q.query(`ALTER TABLE "jobs" ADD "cancellationReason" text`);
    await q.query(`ALTER TABLE "users" ADD "termsAcceptedAt" TIMESTAMP WITH TIME ZONE`);
    await q.query(`ALTER TABLE "users" ADD "termsVersion" character varying(16)`);
    await q.query(`ALTER TABLE "ledger_entries" ADD "providerRef" character varying(80)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "ledger_entries" DROP COLUMN "providerRef"`);
    await q.query(`ALTER TABLE "users" DROP COLUMN "termsVersion"`);
    await q.query(`ALTER TABLE "users" DROP COLUMN "termsAcceptedAt"`);
    await q.query(`ALTER TABLE "jobs" DROP COLUMN "cancellationReason"`);
    await q.query(`ALTER TABLE "jobs" DROP COLUMN "cancelledBy"`);
    await q.query(`DROP INDEX "public"."UQ_user_block_pair"`);
    await q.query(`DROP INDEX "public"."IDX_18d34df8212648b698828f244f"`);
    await q.query(`DROP TABLE "user_blocks"`);
  }
}
