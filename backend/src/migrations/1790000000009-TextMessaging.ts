import type { MigrationInterface, QueryRunner } from "typeorm";

/** SMS / WhatsApp alerts: phone verification, per-channel opt-ins and the outbound message queue. */
export class TextMessaging1790000000009 implements MigrationInterface {
  name = 'TextMessaging1790000000009'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "outbound_messages" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "channel" character varying(10) NOT NULL, "body" character varying(400) NOT NULL, "status" character varying(10) NOT NULL DEFAULT 'queued', "sendAfter" TIMESTAMP WITH TIME ZONE NOT NULL, "attempts" integer NOT NULL DEFAULT '0', "dedupeKey" character varying(120) NOT NULL, "providerRef" character varying(120), "lastError" character varying(300), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "sentAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_d8f1590a8033bc96f14a7f73cf4" UNIQUE ("dedupeKey"), CONSTRAINT "PK_0a03db3e2f04f9f33e6daa597ff" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_f65dc7007ab57e88044b8c1d6c" ON "outbound_messages" ("userId", "createdAt") `);
    await queryRunner.query(`CREATE INDEX "IDX_d37d997c2f6a54faa50cd54f58" ON "outbound_messages" ("status", "sendAfter") `);
    await queryRunner.query(`ALTER TABLE "users" ADD "phoneVerifiedAt" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "users" ADD "smsOptIn" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "users" ADD "whatsappOptIn" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "users" ADD "phoneCodeHash" character varying(64)`);
    await queryRunner.query(`ALTER TABLE "users" ADD "phoneCodeExpiresAt" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "users" ADD "phoneCodeSentAt" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "users" ADD "phoneCodeAttempts" integer NOT NULL DEFAULT '0'`);
    await queryRunner.query(`ALTER TABLE "outbound_messages" ADD CONSTRAINT "FK_22c7d170cf4b049fb5425790c22" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "outbound_messages" DROP CONSTRAINT "FK_22c7d170cf4b049fb5425790c22"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "phoneCodeAttempts"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "phoneCodeSentAt"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "phoneCodeExpiresAt"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "phoneCodeHash"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "whatsappOptIn"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "smsOptIn"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "phoneVerifiedAt"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_d37d997c2f6a54faa50cd54f58"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_f65dc7007ab57e88044b8c1d6c"`);
    await queryRunner.query(`DROP TABLE "outbound_messages"`);
  }

}
