import type { MigrationInterface, QueryRunner } from "typeorm";

/** Round 7: review replies, urgent jobs, job Q&A, GST details, open-job expiry */
export class Round71790000000010 implements MigrationInterface {
  name = 'Round71790000000010'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "job_questions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "jobId" uuid NOT NULL, "askerId" uuid, "question" character varying(500) NOT NULL, "answer" text, "answeredAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_cb3f633f3943effa64989321d74" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_aec9cae49369379fdd019d995c" ON "job_questions" ("jobId", "createdAt") `);
    await queryRunner.query(`ALTER TABLE "jobs" ADD "urgent" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "jobs" ADD "expiresAt" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "jobs" ADD "expiryWarnedAt" TIMESTAMP WITH TIME ZONE`);
    // Existing open jobs get the 30-day window from posting, but never less than a week from now, so a deploy doesn't close a backlog at once.
    await queryRunner.query(`UPDATE "jobs" SET "expiresAt" = GREATEST("createdAt" + interval '30 days', now() + interval '7 days') WHERE "status" = 'open'`);
    await queryRunner.query(`ALTER TABLE "users" ADD "businessName" character varying(120)`);
    await queryRunner.query(`ALTER TABLE "users" ADD "gstin" character varying(15)`);
    await queryRunner.query(`ALTER TABLE "reviews" ADD "reply" text`);
    await queryRunner.query(`ALTER TABLE "reviews" ADD "repliedAt" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TYPE "public"."audit_logs_action_enum" RENAME TO "audit_logs_action_enum_old"`);
    await queryRunner.query(`CREATE TYPE "public"."audit_logs_action_enum" AS ENUM('user_suspend', 'user_unsuspend', 'dispute_resolve', 'force_cancel', 'verify_tradesperson', 'admin_note', 'match_weights_update', 'best_value_blend_update', 'report_resolve', 'user_delete', 'auto_confirm', 'job_expire', 'referral_reward', 'referral_blocked', 'referral_reversed')`);
    await queryRunner.query(`ALTER TABLE "audit_logs" ALTER COLUMN "action" TYPE "public"."audit_logs_action_enum" USING "action"::"text"::"public"."audit_logs_action_enum"`);
    await queryRunner.query(`DROP TYPE "public"."audit_logs_action_enum_old"`);
    await queryRunner.query(`ALTER TABLE "job_questions" ADD CONSTRAINT "FK_82fed6afa494ee6f2124556c7d3" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "job_questions" ADD CONSTRAINT "FK_bd6ff31d3f54e28128bf92aa0de" FOREIGN KEY ("askerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "job_questions" DROP CONSTRAINT "FK_bd6ff31d3f54e28128bf92aa0de"`);
    await queryRunner.query(`ALTER TABLE "job_questions" DROP CONSTRAINT "FK_82fed6afa494ee6f2124556c7d3"`);
    await queryRunner.query(`DELETE FROM "audit_logs" WHERE "action" = 'job_expire'`);
    await queryRunner.query(`CREATE TYPE "public"."audit_logs_action_enum_old" AS ENUM('user_suspend', 'user_unsuspend', 'dispute_resolve', 'force_cancel', 'verify_tradesperson', 'admin_note', 'match_weights_update', 'best_value_blend_update', 'report_resolve', 'user_delete', 'auto_confirm', 'referral_reward', 'referral_blocked', 'referral_reversed')`);
    await queryRunner.query(`ALTER TABLE "audit_logs" ALTER COLUMN "action" TYPE "public"."audit_logs_action_enum_old" USING "action"::"text"::"public"."audit_logs_action_enum_old"`);
    await queryRunner.query(`DROP TYPE "public"."audit_logs_action_enum"`);
    await queryRunner.query(`ALTER TYPE "public"."audit_logs_action_enum_old" RENAME TO "audit_logs_action_enum"`);
    await queryRunner.query(`ALTER TABLE "reviews" DROP COLUMN "repliedAt"`);
    await queryRunner.query(`ALTER TABLE "reviews" DROP COLUMN "reply"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "gstin"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "businessName"`);
    await queryRunner.query(`ALTER TABLE "jobs" DROP COLUMN "expiryWarnedAt"`);
    await queryRunner.query(`ALTER TABLE "jobs" DROP COLUMN "expiresAt"`);
    await queryRunner.query(`ALTER TABLE "jobs" DROP COLUMN "urgent"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_aec9cae49369379fdd019d995c"`);
    await queryRunner.query(`DROP TABLE "job_questions"`);
  }

}
