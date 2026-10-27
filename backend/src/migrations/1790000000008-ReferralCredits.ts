import type { MigrationInterface, QueryRunner } from "typeorm";

/** Referral rewards: the simulated credit ledger, one reward decision per referred account, a sign-up device hash for self-referral checks, and the referral audit actions. */
export class ReferralCredits1790000000008 implements MigrationInterface {
  name = 'ReferralCredits1790000000008'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "referral_rewards" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "referrerId" uuid, "referredId" uuid, "jobId" uuid, "status" character varying(12) NOT NULL, "reason" character varying(40), "referrerAmount" numeric(12,2) NOT NULL DEFAULT '0', "referredAmount" numeric(12,2) NOT NULL DEFAULT '0', "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "reversedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_a3be1dc8ab03f052b59d8aefbad" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_8c73f1b1b2394f8d38f807aff7" ON "referral_rewards" ("referredId") `);
    await queryRunner.query(`CREATE INDEX "IDX_9c951352b6bf10af8622eb1a1a" ON "referral_rewards" ("jobId") `);
    await queryRunner.query(`CREATE INDEX "IDX_286cb4ede00bca86b38595a4e2" ON "referral_rewards" ("referrerId", "createdAt") `);
    await queryRunner.query(`CREATE TABLE "credit_entries" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "kind" character varying(24) NOT NULL, "amount" numeric(12,2) NOT NULL, "jobId" uuid, "rewardId" uuid, "note" character varying(200), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a1974466f4738c102e78f457632" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_9ff204a7b5531c8f24d6c2a4a1" ON "credit_entries" ("jobId") `);
    await queryRunner.query(`CREATE INDEX "IDX_e37214c78318feb3480483587a" ON "credit_entries" ("userId", "createdAt") `);
    await queryRunner.query(`ALTER TABLE "users" ADD "signupDeviceHash" character varying(64)`);
    await queryRunner.query(`ALTER TYPE "public"."audit_logs_action_enum" RENAME TO "audit_logs_action_enum_old"`);
    await queryRunner.query(`CREATE TYPE "public"."audit_logs_action_enum" AS ENUM('user_suspend', 'user_unsuspend', 'dispute_resolve', 'force_cancel', 'verify_tradesperson', 'admin_note', 'match_weights_update', 'best_value_blend_update', 'report_resolve', 'user_delete', 'auto_confirm', 'referral_reward', 'referral_blocked', 'referral_reversed')`);
    await queryRunner.query(`ALTER TABLE "audit_logs" ALTER COLUMN "action" TYPE "public"."audit_logs_action_enum" USING "action"::"text"::"public"."audit_logs_action_enum"`);
    await queryRunner.query(`DROP TYPE "public"."audit_logs_action_enum_old"`);
    await queryRunner.query(`ALTER TABLE "referral_rewards" ADD CONSTRAINT "FK_387be010ec6cb36390794f53b1e" FOREIGN KEY ("referrerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "referral_rewards" ADD CONSTRAINT "FK_8c73f1b1b2394f8d38f807aff7c" FOREIGN KEY ("referredId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "credit_entries" ADD CONSTRAINT "FK_571e88441ec04d9bae6b964eae5" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "credit_entries" DROP CONSTRAINT "FK_571e88441ec04d9bae6b964eae5"`);
    await queryRunner.query(`ALTER TABLE "referral_rewards" DROP CONSTRAINT "FK_8c73f1b1b2394f8d38f807aff7c"`);
    await queryRunner.query(`ALTER TABLE "referral_rewards" DROP CONSTRAINT "FK_387be010ec6cb36390794f53b1e"`);
    await queryRunner.query(`DELETE FROM "audit_logs" WHERE "action" IN ('referral_reward', 'referral_blocked', 'referral_reversed')`);
    await queryRunner.query(`CREATE TYPE "public"."audit_logs_action_enum_old" AS ENUM('user_suspend', 'user_unsuspend', 'dispute_resolve', 'force_cancel', 'verify_tradesperson', 'admin_note', 'match_weights_update', 'best_value_blend_update', 'report_resolve', 'user_delete', 'auto_confirm')`);
    await queryRunner.query(`ALTER TABLE "audit_logs" ALTER COLUMN "action" TYPE "public"."audit_logs_action_enum_old" USING "action"::"text"::"public"."audit_logs_action_enum_old"`);
    await queryRunner.query(`DROP TYPE "public"."audit_logs_action_enum"`);
    await queryRunner.query(`ALTER TYPE "public"."audit_logs_action_enum_old" RENAME TO "audit_logs_action_enum"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "signupDeviceHash"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_e37214c78318feb3480483587a"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_9ff204a7b5531c8f24d6c2a4a1"`);
    await queryRunner.query(`DROP TABLE "credit_entries"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_286cb4ede00bca86b38595a4e2"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_9c951352b6bf10af8622eb1a1a"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_8c73f1b1b2394f8d38f807aff7"`);
    await queryRunner.query(`DROP TABLE "referral_rewards"`);
  }

}
