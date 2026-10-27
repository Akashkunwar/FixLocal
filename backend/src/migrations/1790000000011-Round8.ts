import type { MigrationInterface, QueryRunner } from "typeorm";

/** Round 8 fixes: pending sign-up on confirmation links, indexes and constraints from the bug scan. */
export class Round81790000000011 implements MigrationInterface {
  name = 'Round81790000000011'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "email_tokens" ADD "pending" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "email_tokens" DROP COLUMN "pending"`);
  }

}
