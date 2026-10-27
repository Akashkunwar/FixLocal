import type { MigrationInterface, QueryRunner } from "typeorm";

/** Round 8 fixes from the bug scan: pending sign-up on confirmation links, credit-funded milestones, ledger and index constraints. */
export class Round81790000000011 implements MigrationInterface {
  name = 'Round81790000000011'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "payment_milestones" ADD "creditAmount" numeric(10,2) NOT NULL DEFAULT '0'`);
    await queryRunner.query(`ALTER TABLE "email_tokens" ADD "pending" jsonb`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_ledger_milestone_type" ON "ledger_entries" ("milestoneId", "type") WHERE "milestoneId" IS NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."UQ_ledger_milestone_type"`);
    await queryRunner.query(`ALTER TABLE "email_tokens" DROP COLUMN "pending"`);
    await queryRunner.query(`ALTER TABLE "payment_milestones" DROP COLUMN "creditAmount"`);
  }

}
