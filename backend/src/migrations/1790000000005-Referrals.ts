import type { MigrationInterface, QueryRunner } from "typeorm";

/** Referral codes: each user's invite code and who invited them. */
export class Referrals1790000000005 implements MigrationInterface {
  name = 'Referrals1790000000005'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "referralCode" character varying(12)`);
    await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "UQ_b7f8278f4e89249bb75c9a15899" UNIQUE ("referralCode")`);
    await queryRunner.query(`ALTER TABLE "users" ADD "referredById" uuid`);
    await queryRunner.query(`CREATE INDEX "IDX_1142607b5a447cd5ce23ef7798" ON "users" ("referredById") `);
    await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "FK_1142607b5a447cd5ce23ef7798f" FOREIGN KEY ("referredById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_1142607b5a447cd5ce23ef7798f"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_1142607b5a447cd5ce23ef7798"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "referredById"`);
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "UQ_b7f8278f4e89249bb75c9a15899"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "referralCode"`);
  }

}
