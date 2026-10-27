import type { MigrationInterface, QueryRunner } from "typeorm";

/** Job alert frequency (instant / daily digest), pending digest matches and the per-day digest claim. Alerts saved before this change keep instant delivery. */
export class JobAlertDigests1790000000006 implements MigrationInterface {
  name = 'JobAlertDigests1790000000006'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "job_alert_digests" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "digestDate" date NOT NULL, "jobCount" integer NOT NULL DEFAULT '0', "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_fa316db556039f167a668c8020d" UNIQUE ("userId", "digestDate"), CONSTRAINT "PK_9f53f5690a0a2ddb604953b38d0" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE TABLE "job_alert_matches" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "jobId" uuid NOT NULL, "alertName" character varying(80) NOT NULL, "digestId" uuid, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_02ece01bd19e201ee738b9ac82e" UNIQUE ("userId", "jobId"), CONSTRAINT "PK_8e85f4ac667fe8c53868f6038f3" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_ca9533f11154d9b42c8350cda6" ON "job_alert_matches" ("createdAt") `);
    await queryRunner.query(`CREATE INDEX "IDX_e1234656c7e8336700973bcb74" ON "job_alert_matches" ("digestId") `);
    await queryRunner.query(`ALTER TABLE "job_alerts" ADD "frequency" character varying(8) NOT NULL DEFAULT 'daily'`);
    // Existing alerts were saved when every alert was instant: keep that behaviour for them.
    await queryRunner.query(`UPDATE "job_alerts" SET "frequency" = 'instant'`);
    await queryRunner.query(`ALTER TABLE "job_alert_digests" ADD CONSTRAINT "FK_c5bceb90cb85981df0c535b9de5" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "job_alert_matches" ADD CONSTRAINT "FK_1acee60dba27bdfb8f833d461ec" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "job_alert_matches" ADD CONSTRAINT "FK_c65a5e98669e0023487a563ca5c" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "job_alert_matches" ADD CONSTRAINT "FK_e1234656c7e8336700973bcb74b" FOREIGN KEY ("digestId") REFERENCES "job_alert_digests"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "job_alert_matches" DROP CONSTRAINT "FK_e1234656c7e8336700973bcb74b"`);
    await queryRunner.query(`ALTER TABLE "job_alert_matches" DROP CONSTRAINT "FK_c65a5e98669e0023487a563ca5c"`);
    await queryRunner.query(`ALTER TABLE "job_alert_matches" DROP CONSTRAINT "FK_1acee60dba27bdfb8f833d461ec"`);
    await queryRunner.query(`ALTER TABLE "job_alert_digests" DROP CONSTRAINT "FK_c5bceb90cb85981df0c535b9de5"`);
    await queryRunner.query(`ALTER TABLE "job_alerts" DROP COLUMN "frequency"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_e1234656c7e8336700973bcb74"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ca9533f11154d9b42c8350cda6"`);
    await queryRunner.query(`DROP TABLE "job_alert_matches"`);
    await queryRunner.query(`DROP TABLE "job_alert_digests"`);
  }

}
