import type { MigrationInterface, QueryRunner } from "typeorm";

/** Each user's interface and email language (en / hi). */
export class AccountLanguage1790000000007 implements MigrationInterface {
  name = 'AccountLanguage1790000000007'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "language" character varying(5) NOT NULL DEFAULT 'en'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "language"`);
  }

}
