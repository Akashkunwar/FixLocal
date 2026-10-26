import type { MigrationInterface, QueryRunner } from "typeorm";

/** Job alerts for professionals, and the job_alert notification type. */
export class JobAlerts1790000000004 implements MigrationInterface {
  name = 'JobAlerts1790000000004'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "job_alerts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "name" character varying(80) NOT NULL, "categories" jsonb NOT NULL DEFAULT '[]', "city" character varying(80), "area" character varying(120), "lat" double precision, "lng" double precision, "radiusKm" integer, "minBudget" integer, "siteType" character varying(16), "active" boolean NOT NULL DEFAULT true, "matchCount" integer NOT NULL DEFAULT '0', "lastMatchedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_86de3f72f9720d708e6a2729a09" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_a6f526877e20fc5935bc1c526a" ON "job_alerts" ("active") `);
    await queryRunner.query(`CREATE INDEX "IDX_859419a2a5deb60a5568d145a5" ON "job_alerts" ("userId") `);
    await queryRunner.query(`ALTER TYPE "public"."notifications_type_enum" RENAME TO "notifications_type_enum_old"`);
    await queryRunner.query(`CREATE TYPE "public"."notifications_type_enum" AS ENUM('new_bid', 'bid_accepted', 'bid_rejected', 'job_status', 'dispute', 'message', 'review', 'system', 'pro_available', 'match', 'job_alert')`);
    await queryRunner.query(`ALTER TABLE "notifications" ALTER COLUMN "type" TYPE "public"."notifications_type_enum" USING "type"::"text"::"public"."notifications_type_enum"`);
    await queryRunner.query(`DROP TYPE "public"."notifications_type_enum_old"`);
    await queryRunner.query(`ALTER TABLE "job_alerts" ADD CONSTRAINT "FK_859419a2a5deb60a5568d145a58" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "job_alerts" DROP CONSTRAINT "FK_859419a2a5deb60a5568d145a58"`);
    // The older enum has no job_alert value.
    await queryRunner.query(`DELETE FROM "notifications" WHERE "type" = 'job_alert'`);
    await queryRunner.query(`CREATE TYPE "public"."notifications_type_enum_old" AS ENUM('new_bid', 'bid_accepted', 'bid_rejected', 'job_status', 'dispute', 'message', 'review', 'system', 'pro_available', 'match')`);
    await queryRunner.query(`ALTER TABLE "notifications" ALTER COLUMN "type" TYPE "public"."notifications_type_enum_old" USING "type"::"text"::"public"."notifications_type_enum_old"`);
    await queryRunner.query(`DROP TYPE "public"."notifications_type_enum"`);
    await queryRunner.query(`ALTER TYPE "public"."notifications_type_enum_old" RENAME TO "notifications_type_enum"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_859419a2a5deb60a5568d145a5"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_a6f526877e20fc5935bc1c526a"`);
    await queryRunner.query(`DROP TABLE "job_alerts"`);
  }

}
