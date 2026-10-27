import type { MigrationInterface, QueryRunner } from "typeorm";

/** Round 8 fixes from the bug scan: pending sign-up on confirmation links, credit-funded milestones, ledger and index constraints. */
export class Round81790000000011 implements MigrationInterface {
  name = 'Round81790000000011'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "payment_milestones" ADD "creditAmount" numeric(10,2) NOT NULL DEFAULT '0'`);
    await queryRunner.query(`ALTER TABLE "jobs" ADD "urgentSince" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "email_tokens" ADD "pending" jsonb`);
    await queryRunner.query(`CREATE INDEX "IDX_f4a5f57a9b1c3868ee03e34025" ON "bids" ("tradespersonId", "createdAt") `);
    await queryRunner.query(`CREATE INDEX "IDX_bids_quote_view_nudge" ON "bids" ("quoteViewedAt") WHERE "status" = 'active' AND "quoteViewedNudgeSentAt" IS NULL`);
    await queryRunner.query(`CREATE INDEX "IDX_jobs_open_expires" ON "jobs" ("expiresAt") WHERE "status" = 'open'`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_ledger_milestone_type" ON "ledger_entries" ("milestoneId", "type") WHERE "milestoneId" IS NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."UQ_ledger_milestone_type"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_jobs_open_expires"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_bids_quote_view_nudge"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_f4a5f57a9b1c3868ee03e34025"`);
    await queryRunner.query(`ALTER TABLE "email_tokens" DROP COLUMN "pending"`);
    await queryRunner.query(`ALTER TABLE "jobs" DROP COLUMN "urgentSince"`);
    await queryRunner.query(`ALTER TABLE "payment_milestones" DROP COLUMN "creditAmount"`);
  }

}
