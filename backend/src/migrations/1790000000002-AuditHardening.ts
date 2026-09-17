import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Security / integrity hardening from the September 2026 audit.
 * Hand-written (not generated) so existing data survives:
 * timestamps are converted in place, data is cleaned before constraints are added,
 * and new tables are backfilled from the old representations.
 */
export class AuditHardening1790000000002 implements MigrationInterface {
  name = "AuditHardening1790000000002";

  public async up(q: QueryRunner): Promise<void> {
    // ---------- new tables ----------
    await q.query(`CREATE TABLE "chat_thread_reads" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "jobId" uuid NOT NULL, "threadTradespersonId" uuid NOT NULL, "userId" uuid NOT NULL, "lastReadAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_c8f93f174ad160068e66b731f1e" PRIMARY KEY ("id"))`);
    await q.query(`CREATE UNIQUE INDEX "UQ_chat_read_participant" ON "chat_thread_reads" ("jobId", "threadTradespersonId", "userId")`);
    await q.query(`CREATE TABLE "ledger_entries" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "jobId" uuid NOT NULL, "milestoneId" uuid, "type" character varying(16) NOT NULL, "amount" numeric(12,2) NOT NULL, "payeeUserId" uuid, "payerUserId" uuid, "actorUserId" uuid, "note" text, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_ledger_amount" CHECK ("amount" >= 0), CONSTRAINT "PK_6efcb84411d3f08b08450ae75d5" PRIMARY KEY ("id"))`);
    await q.query(`CREATE INDEX "IDX_3c01e80a14a578d059a5f15483" ON "ledger_entries" ("payeeUserId", "type")`);
    await q.query(`CREATE INDEX "IDX_8146b67050d18cfcf13002314c" ON "ledger_entries" ("jobId", "createdAt")`);
    await q.query(`CREATE TABLE "job_invites" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "jobId" uuid NOT NULL, "tradespersonId" uuid NOT NULL, "invitedByUserId" uuid NOT NULL, "message" text, "source" character varying(16) NOT NULL DEFAULT 'suggested', "shortlistRank" integer, "smartScore" double precision, "status" character varying(16) NOT NULL DEFAULT 'pending', "inviteCount" integer NOT NULL DEFAULT '1', "lastInvitedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "declineReason" character varying(32), "declineNote" text, "declinedAt" TIMESTAMP WITH TIME ZONE, "openedAt" TIMESTAMP WITH TIME ZONE, "clickedAt" TIMESTAMP WITH TIME ZONE, "notificationId" uuid, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_763a2eac1e49bf36864f62a1d3a" PRIMARY KEY ("id"))`);
    await q.query(`CREATE INDEX "IDX_14dc2bea1d842de5b599181dd5" ON "job_invites" ("tradespersonId", "createdAt")`);
    await q.query(`CREATE UNIQUE INDEX "UQ_invite_job_pro" ON "job_invites" ("jobId", "tradespersonId")`);
    await q.query(`CREATE TABLE "idempotency_keys" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "key" character varying(128) NOT NULL, "method" character varying(8) NOT NULL, "path" character varying(255) NOT NULL, "statusCode" integer, "responseBody" jsonb, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_8ad20779ad0411107a56e53d0f6" PRIMARY KEY ("id"))`);
    await q.query(`CREATE INDEX "IDX_39829cdd18d40184d32a8a4abe" ON "idempotency_keys" ("createdAt")`);
    await q.query(`CREATE UNIQUE INDEX "UQ_idempotency_user_key" ON "idempotency_keys" ("userId", "key")`);
    await q.query(`CREATE TABLE "uploads" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(255) NOT NULL, "ownerUserId" uuid NOT NULL, "kind" character varying(24) NOT NULL, "jobId" uuid, "threadTradespersonId" uuid, "bidId" uuid, "mime" character varying(64) NOT NULL, "size" integer NOT NULL DEFAULT '0', "originalName" character varying(255), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_ffad67416eddf7b3489e1063bf3" UNIQUE ("name"), CONSTRAINT "PK_d1781d1eedd7459314f60f39bd3" PRIMARY KEY ("id"))`);
    await q.query(`CREATE INDEX "IDX_a3b1802a1d6970bf65b82cdc05" ON "uploads" ("ownerUserId")`);
    await q.query(`CREATE INDEX "IDX_66125f79936f3ae5d0837a33e2" ON "uploads" ("jobId")`);
    await q.query(`CREATE TABLE "refresh_tokens" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "tokenHash" character varying(64) NOT NULL, "familyId" uuid NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "revokedAt" TIMESTAMP WITH TIME ZONE, "replacedById" uuid, "userAgent" character varying(255), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_c25bc63d248ca90e8dcc1d92d06" UNIQUE ("tokenHash"), CONSTRAINT "PK_7d8bee0204106019488c4c50ffa" PRIMARY KEY ("id"))`);
    await q.query(`CREATE INDEX "IDX_40e9a8b923a1b3fb4429a5c624" ON "refresh_tokens" ("familyId")`);
    await q.query(`CREATE INDEX "IDX_610102b60fea1455310ccd299d" ON "refresh_tokens" ("userId")`);
    await q.query(`CREATE TABLE "email_tokens" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "type" character varying(16) NOT NULL, "tokenHash" character varying(64) NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "usedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_3c9d0517a29ae032a37e258d517" UNIQUE ("tokenHash"), CONSTRAINT "PK_08abb3fa348e894c274a6730d35" PRIMARY KEY ("id"))`);
    await q.query(`CREATE INDEX "IDX_aa5917bcee5cc8579c2f390892" ON "email_tokens" ("userId", "type")`);
    await q.query(`CREATE TABLE "reports" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "reporterId" uuid NOT NULL, "targetType" character varying(16) NOT NULL, "targetId" uuid NOT NULL, "reason" text NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'open', "resolutionNote" text, "resolvedByUserId" uuid, "resolvedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_d9013193989303580053c0b5ef6" PRIMARY KEY ("id"))`);
    await q.query(`CREATE INDEX "IDX_781a2c0adee4125f1f6906a14a" ON "reports" ("status", "createdAt")`);
    await q.query(`CREATE TABLE "user_templates" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "kind" character varying(24) NOT NULL, "position" integer NOT NULL DEFAULT '0', "data" jsonb NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_cd89a4d91ee0a470b735a51c00f" PRIMARY KEY ("id"))`);
    await q.query(`CREATE INDEX "IDX_3bbe62922631151b362f7de11d" ON "user_templates" ("userId", "kind", "position")`);

    // ---------- timestamps: convert in place (keeps data) ----------
    const tsColumns: Record<string, string[]> = {
      tradesperson_profiles: ["createdAt", "updatedAt"],
      bids: ["createdAt", "updatedAt"],
      disputes: ["createdAt", "updatedAt"],
      payment_milestones: ["createdAt", "updatedAt"],
      jobs: ["createdAt", "updatedAt"],
      users: ["createdAt", "updatedAt"],
      reviews: ["createdAt"],
      messages: ["createdAt"],
      notifications: ["createdAt"],
      favorites: ["createdAt"],
      audit_logs: ["createdAt"],
      app_configs: ["createdAt", "updatedAt"],
    };
    for (const [table, cols] of Object.entries(tsColumns)) {
      for (const col of cols) {
        await q.query(`ALTER TABLE "${table}" ALTER COLUMN "${col}" TYPE TIMESTAMP WITH TIME ZONE`);
      }
    }

    // ---------- users ----------
    await q.query(`ALTER TABLE "users" ADD "tokenVersion" integer NOT NULL DEFAULT '0'`);
    await q.query(`ALTER TABLE "users" ADD "emailVerifiedAt" TIMESTAMP WITH TIME ZONE`);
    await q.query(`ALTER TABLE "users" ADD "timezone" character varying(64) NOT NULL DEFAULT 'Asia/Kolkata'`);
    await q.query(`ALTER TABLE "users" ADD "deletedAt" TIMESTAMP WITH TIME ZONE`);
    // Accounts created before email verification existed are treated as verified.
    await q.query(`UPDATE "users" SET "emailVerifiedAt" = "createdAt"`);
    await q.query(`
      UPDATE "users" u SET "email" = lower(trim(u."email"))
      WHERE u."email" <> lower(trim(u."email"))
        AND NOT EXISTS (SELECT 1 FROM "users" o WHERE o."email" = lower(trim(u."email")))`);

    // Templates move from JSON columns to their own table.
    const templateCols: [string, string][] = [
      ["inviteTemplates", "invite"],
      ["counterTemplates", "counter"],
      ["homeownerCounterTemplates", "homeownerCounter"],
      ["introTemplates", "intro"],
      ["namedJobTemplates", "namedJob"],
    ];
    for (const [col, kind] of templateCols) {
      await q.query(`
        INSERT INTO "user_templates" ("userId", "kind", "position", "data")
        SELECT u."id", '${kind}', t.ord - 1, t.item
        FROM "users" u
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(u."${col}") = 'array' THEN u."${col}" ELSE '[]'::jsonb END
        ) WITH ORDINALITY AS t(item, ord)
        WHERE jsonb_typeof(t.item) = 'object'`);
      await q.query(`ALTER TABLE "users" DROP COLUMN "${col}"`);
    }

    // ---------- jobs ----------
    await q.query(`ALTER TYPE "public"."jobs_status_enum" RENAME TO "jobs_status_enum_old"`);
    await q.query(`CREATE TYPE "public"."jobs_status_enum" AS ENUM('open', 'bidding_closed', 'awarded', 'in_progress', 'pending_confirmation', 'completed', 'cancelled', 'disputed')`);
    await q.query(`ALTER TABLE "jobs" ALTER COLUMN "status" DROP DEFAULT`);
    await q.query(`ALTER TABLE "jobs" ALTER COLUMN "status" TYPE "public"."jobs_status_enum" USING "status"::"text"::"public"."jobs_status_enum"`);
    await q.query(`ALTER TABLE "jobs" ALTER COLUMN "status" SET DEFAULT 'open'`);
    await q.query(`DROP TYPE "public"."jobs_status_enum_old"`);
    await q.query(`ALTER TABLE "jobs" ADD "pendingConfirmationAt" TIMESTAMP WITH TIME ZONE`);
    await q.query(`ALTER TABLE "jobs" ADD "photoConsent" boolean NOT NULL DEFAULT false`);
    // Clean values the old API accepted without validation.
    await q.query(`UPDATE "jobs" SET "maxBids" = LEAST(50, GREATEST(1, "maxBids")) WHERE "maxBids" < 1 OR "maxBids" > 50`);
    await q.query(`UPDATE "jobs" SET "budgetMin" = NULL WHERE "budgetMin" < 0`);
    await q.query(`UPDATE "jobs" SET "budgetMax" = NULL WHERE "budgetMax" < 0`);
    await q.query(`UPDATE "jobs" SET "budgetMin" = "budgetMax", "budgetMax" = "budgetMin" WHERE "budgetMin" > "budgetMax"`);
    await q.query(`UPDATE "jobs" SET "lat" = NULL, "lng" = NULL WHERE "lat" < -90 OR "lat" > 90 OR "lng" < -180 OR "lng" > 180`);
    await q.query(`UPDATE "jobs" SET "escrowAmount" = NULL WHERE "escrowAmount" < 0`);
    await q.query(`CREATE INDEX "IDX_af924c25aab35b33928211bb1f" ON "jobs" ("status", "createdAt")`);
    await q.query(`CREATE INDEX "IDX_e44ace7ce1b22b846b9f76de58" ON "jobs" ("homeownerId", "createdAt")`);

    // ---------- tradesperson profiles ----------
    await q.query(`UPDATE "tradesperson_profiles" SET "yearsExperience" = NULL WHERE "yearsExperience" < 0 OR "yearsExperience" > 80`);
    await q.query(`UPDATE "tradesperson_profiles" SET "hourlyRateMin" = NULL WHERE "hourlyRateMin" < 0`);
    await q.query(`UPDATE "tradesperson_profiles" SET "hourlyRateMax" = NULL WHERE "hourlyRateMax" < 0`);
    await q.query(`UPDATE "tradesperson_profiles" SET "lat" = NULL, "lng" = NULL WHERE "lat" < -90 OR "lat" > 90 OR "lng" < -180 OR "lng" > 180`);

    // ---------- bids ----------
    await q.query(`ALTER TABLE "bids" ADD "quoteRevision" integer NOT NULL DEFAULT '0'`);
    await q.query(`UPDATE "bids" SET "quoteRevision" = jsonb_array_length("quoteHistory") WHERE jsonb_typeof("quoteHistory") = 'array'`);
    await q.query(`UPDATE "bids" SET "etaDays" = NULL WHERE "etaDays" < 0 OR "etaDays" > 365`);
    // Keep one bid per (job, pro): the accepted one if any, otherwise the earliest.
    await q.query(`
      DELETE FROM "bids" b
      USING (
        SELECT "id", row_number() OVER (
          PARTITION BY "jobId", "tradespersonId"
          ORDER BY ("status" = 'accepted') DESC, "createdAt" ASC, "id" ASC
        ) AS rn
        FROM "bids"
      ) ranked
      WHERE b."id" = ranked."id" AND ranked.rn > 1
        AND NOT EXISTS (SELECT 1 FROM "jobs" j WHERE j."acceptedBidId" = b."id")`);
    // Only the job's recorded accepted bid stays accepted.
    await q.query(`
      UPDATE "bids" b SET "status" = 'rejected'
      FROM "jobs" j
      WHERE b."jobId" = j."id" AND b."status" = 'accepted'
        AND j."acceptedBidId" IS DISTINCT FROM b."id"
        AND EXISTS (SELECT 1 FROM "bids" o WHERE o."jobId" = b."jobId" AND o."status" = 'accepted' AND o."id" <> b."id")`);
    await q.query(`CREATE UNIQUE INDEX "UQ_bid_one_accepted_per_job" ON "bids" ("jobId") WHERE "status" = 'accepted'`);
    await q.query(`CREATE UNIQUE INDEX "UQ_bid_job_pro" ON "bids" ("jobId", "tradespersonId")`);

    // ---------- disputes ----------
    await q.query(`ALTER TABLE "disputes" ADD "previousJobStatus" character varying(32)`);
    await q.query(`
      UPDATE "disputes" d SET "status" = 'resolved', "resolution" = 'no_action',
        "resolutionNotes" = 'Closed automatically: duplicate open dispute on the same job', "resolvedAt" = now()
      FROM (
        SELECT "id", row_number() OVER (PARTITION BY "jobId" ORDER BY "createdAt", "id") AS rn
        FROM "disputes" WHERE "status" = 'open'
      ) ranked
      WHERE d."id" = ranked."id" AND ranked.rn > 1`);
    await q.query(`CREATE UNIQUE INDEX "UQ_dispute_one_open_per_job" ON "disputes" ("jobId") WHERE "status" = 'open'`);
    await q.query(`CREATE INDEX "IDX_d424abda2f57327eb459d23d51" ON "disputes" ("jobId")`);

    // ---------- payment milestones ----------
    await q.query(`
      DELETE FROM "payment_milestones" m
      USING (
        SELECT "id", row_number() OVER (PARTITION BY "jobId", "sequence" ORDER BY "createdAt", "id") AS rn
        FROM "payment_milestones"
      ) ranked
      WHERE m."id" = ranked."id" AND ranked.rn > 1`);
    await q.query(`CREATE UNIQUE INDEX "UQ_milestone_job_sequence" ON "payment_milestones" ("jobId", "sequence")`);

    // Ledger backfill from milestone state.
    await q.query(`
      INSERT INTO "ledger_entries" ("jobId", "milestoneId", "type", "amount", "payerUserId", "payeeUserId", "note", "createdAt")
      SELECT m."jobId", m."id", 'hold', m."amount", j."homeownerId", b."tradespersonId", 'Backfilled from milestone', m."createdAt"
      FROM "payment_milestones" m
      JOIN "jobs" j ON j."id" = m."jobId"
      LEFT JOIN "bids" b ON b."id" = j."acceptedBidId"`);
    await q.query(`
      INSERT INTO "ledger_entries" ("jobId", "milestoneId", "type", "amount", "payerUserId", "payeeUserId", "actorUserId", "note", "createdAt")
      SELECT m."jobId", m."id", 'release', m."amount", j."homeownerId", b."tradespersonId", m."releasedByUserId", 'Backfilled from milestone', COALESCE(m."releasedAt", m."updatedAt")
      FROM "payment_milestones" m
      JOIN "jobs" j ON j."id" = m."jobId"
      LEFT JOIN "bids" b ON b."id" = j."acceptedBidId"
      WHERE m."status" = 'released'`);
    await q.query(`
      INSERT INTO "ledger_entries" ("jobId", "milestoneId", "type", "amount", "payerUserId", "payeeUserId", "actorUserId", "note", "createdAt")
      SELECT m."jobId", m."id", 'refund', m."amount", j."homeownerId", b."tradespersonId", m."refundedByUserId", COALESCE(m."refundNote", 'Backfilled from milestone'), COALESCE(m."refundedAt", m."updatedAt")
      FROM "payment_milestones" m
      JOIN "jobs" j ON j."id" = m."jobId"
      LEFT JOIN "bids" b ON b."id" = j."acceptedBidId"
      WHERE m."status" = 'refunded'`);

    // ---------- reviews ----------
    await q.query(`ALTER TABLE "reviews" ADD "direction" character varying(16) NOT NULL DEFAULT 'client_to_pro'`);
    await q.query(`ALTER TABLE "reviews" ADD "revieweeId" uuid`);
    await q.query(`UPDATE "reviews" SET "revieweeId" = "tradespersonId"`);
    await q.query(`ALTER TABLE "reviews" ALTER COLUMN "revieweeId" SET NOT NULL`);
    await q.query(`UPDATE "reviews" SET "rating" = LEAST(5, GREATEST(1, "rating")) WHERE "rating" < 1 OR "rating" > 5`);
    await q.query(`ALTER TABLE "reviews" DROP CONSTRAINT "FK_c3c015435fedbf60baee6eac0ec"`);
    await q.query(`ALTER TABLE "reviews" DROP CONSTRAINT "UQ_c3c015435fedbf60baee6eac0ec"`);
    await q.query(`ALTER TABLE "reviews" ADD CONSTRAINT "FK_c3c015435fedbf60baee6eac0ec" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    await q.query(`CREATE INDEX "IDX_c8f626e1e943aabb0f90fb8ee6" ON "reviews" ("revieweeId")`);
    await q.query(`CREATE UNIQUE INDEX "UQ_review_job_direction" ON "reviews" ("jobId", "direction")`);

    // ---------- messages: one thread per (job, professional) ----------
    await q.query(`ALTER TABLE "messages" ADD "threadTradespersonId" uuid`);
    await q.query(`
      UPDATE "messages" m SET "threadTradespersonId" = m."senderId"
      FROM "users" u WHERE u."id" = m."senderId" AND u."role" = 'TRADESPERSON'`);
    await q.query(`
      UPDATE "messages" m SET "threadTradespersonId" = b."tradespersonId"
      FROM "jobs" j JOIN "bids" b ON b."id" = j."acceptedBidId"
      WHERE m."jobId" = j."id" AND m."threadTradespersonId" IS NULL`);
    await q.query(`
      UPDATE "messages" m SET "threadTradespersonId" = first_bid."tradespersonId"
      FROM (
        SELECT DISTINCT ON ("jobId") "jobId", "tradespersonId"
        FROM "bids" ORDER BY "jobId", ("status" = 'active') DESC, "createdAt" ASC
      ) first_bid
      WHERE m."jobId" = first_bid."jobId" AND m."threadTradespersonId" IS NULL`);
    // Messages on jobs that never had a bid were never visible to any professional.
    await q.query(`DELETE FROM "messages" WHERE "threadTradespersonId" IS NULL`);
    await q.query(`ALTER TABLE "messages" ALTER COLUMN "threadTradespersonId" SET NOT NULL`);
    await q.query(`
      INSERT INTO "chat_thread_reads" ("jobId", "threadTradespersonId", "userId", "lastReadAt")
      SELECT DISTINCT m."jobId", m."threadTradespersonId", p.uid, now()
      FROM "messages" m
      JOIN "jobs" j ON j."id" = m."jobId"
      CROSS JOIN LATERAL (VALUES (j."homeownerId"), (m."threadTradespersonId")) AS p(uid)
      ON CONFLICT DO NOTHING`);
    await q.query(`ALTER TABLE "messages" DROP COLUMN "readAt"`);
    await q.query(`CREATE INDEX "IDX_a70f81c325235e00402fe68ac3" ON "messages" ("jobId", "threadTradespersonId", "createdAt")`);

    // ---------- invites: from notification rows to a real table ----------
    await q.query(`
      WITH inv AS (
        SELECT n.*, (n."meta"->>'jobId')::uuid AS job_id
        FROM "notifications" n
        WHERE n."type" = 'match' AND n."meta"->>'invite' = 'true'
          AND n."meta"->>'jobId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      ),
      latest AS (
        SELECT DISTINCT ON (job_id, "userId") * FROM inv ORDER BY job_id, "userId", "createdAt" DESC
      ),
      agg AS (
        SELECT job_id, "userId", count(*) AS cnt, min("createdAt") AS first_at, max("createdAt") AS last_at,
               min(NULLIF("meta"->>'openedAt', '')) AS opened_at,
               max(NULLIF("meta"->>'clickedAt', '')) AS clicked_at,
               bool_or("read") AS any_read
        FROM inv GROUP BY job_id, "userId"
      )
      INSERT INTO "job_invites" ("jobId", "tradespersonId", "invitedByUserId", "message", "source", "shortlistRank", "smartScore",
                                 "status", "inviteCount", "lastInvitedAt", "declineReason", "declineNote", "declinedAt",
                                 "openedAt", "clickedAt", "notificationId", "createdAt", "updatedAt")
      SELECT l.job_id, l."userId",
             COALESCE(CASE WHEN l."meta"->>'fromUserId' ~* '^[0-9a-f-]{36}$' THEN (l."meta"->>'fromUserId')::uuid END, j."homeownerId"),
             NULLIF(l."meta"->>'message', ''),
             COALESCE(NULLIF(l."meta"->>'source', ''), 'suggested'),
             CASE WHEN l."meta"->>'shortlistRank' ~ '^[0-9]+$' THEN (l."meta"->>'shortlistRank')::int END,
             CASE WHEN l."meta"->>'smartScore' ~ '^-?[0-9.]+$' THEN (l."meta"->>'smartScore')::float END,
             CASE WHEN l."meta"->>'declined' = 'true' THEN 'declined' ELSE 'pending' END,
             a.cnt, a.last_at,
             NULLIF(l."meta"->>'declineReason', ''),
             NULLIF(l."meta"->>'declineNote', ''),
             CASE WHEN l."meta"->>'declined' = 'true' THEN COALESCE((NULLIF(l."meta"->>'declinedAt', ''))::timestamptz, l."createdAt") END,
             a.opened_at::timestamptz,
             COALESCE(a.clicked_at::timestamptz, CASE WHEN a.any_read THEN a.last_at END),
             l."id", a.first_at, now()
      FROM latest l
      JOIN agg a ON a.job_id = l.job_id AND a."userId" = l."userId"
      JOIN "jobs" j ON j."id" = l.job_id
      JOIN "users" u ON u."id" = l."userId"
      ON CONFLICT DO NOTHING`);

    // ---------- uploads: register every legacy file reference ----------
    const mime = (col: string) => `
      CASE lower(substring(${col} from '\\.([A-Za-z0-9]+)$'))
        WHEN 'jpg' THEN 'image/jpeg' WHEN 'jpeg' THEN 'image/jpeg' WHEN 'png' THEN 'image/png'
        WHEN 'webp' THEN 'image/webp' WHEN 'gif' THEN 'image/gif' WHEN 'pdf' THEN 'application/pdf'
        ELSE 'application/octet-stream' END`;
    const legacyName = (expr: string) => `substring(${expr} from '^/uploads/([^/?#]+)$')`;
    const insertUploads = async (selectSql: string) => {
      await q.query(`
        INSERT INTO "uploads" ("name", "ownerUserId", "kind", "jobId", "threadTradespersonId", "bidId", "mime")
        SELECT DISTINCT ON (src.name) src.name, src.owner, src.kind, src.job_id, src.thread_id, src.bid_id, ${mime("src.name")}
        FROM (${selectSql}) src
        WHERE src.name IS NOT NULL AND src.owner IS NOT NULL
        ON CONFLICT ("name") DO NOTHING`);
    };
    const arr = (col: string) =>
      `jsonb_array_elements_text(CASE WHEN jsonb_typeof(${col}) = 'array' THEN ${col} ELSE '[]'::jsonb END)`;
    // Public kinds first so a file shared by a case study stays viewable.
    await insertUploads(`
      SELECT ${legacyName("cs->>'beforeUrl'")} AS name, p."userId" AS owner, 'case_study' AS kind, NULL::uuid AS job_id, NULL::uuid AS thread_id, NULL::uuid AS bid_id
      FROM "tradesperson_profiles" p CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p."caseStudies") = 'array' THEN p."caseStudies" ELSE '[]'::jsonb END) cs
      UNION ALL
      SELECT ${legacyName("cs->>'afterUrl'")}, p."userId", 'case_study', NULL, NULL, NULL
      FROM "tradesperson_profiles" p CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p."caseStudies") = 'array' THEN p."caseStudies" ELSE '[]'::jsonb END) cs`);
    await insertUploads(`
      SELECT ${legacyName("g.v")} AS name, p."userId" AS owner, 'gallery' AS kind, NULL::uuid AS job_id, NULL::uuid AS thread_id, NULL::uuid AS bid_id
      FROM "tradesperson_profiles" p CROSS JOIN LATERAL ${arr('p."galleryUrls"')} AS g(v)`);
    await insertUploads(`
      SELECT ${legacyName('u."avatarUrl"')} AS name, u."id" AS owner, 'avatar' AS kind, NULL::uuid AS job_id, NULL::uuid AS thread_id, NULL::uuid AS bid_id
      FROM "users" u WHERE u."avatarUrl" IS NOT NULL`);
    await insertUploads(`
      SELECT ${legacyName('p."licenseDocUrl"')} AS name, p."userId" AS owner, 'license' AS kind, NULL::uuid AS job_id, NULL::uuid AS thread_id, NULL::uuid AS bid_id
      FROM "tradesperson_profiles" p WHERE p."licenseDocUrl" IS NOT NULL`);
    await insertUploads(`
      SELECT ${legacyName("x.v")} AS name, j."homeownerId" AS owner, 'job_photo' AS kind, j."id" AS job_id, NULL::uuid AS thread_id, NULL::uuid AS bid_id
      FROM "jobs" j CROSS JOIN LATERAL ${arr('j."photoUrls"')} AS x(v)`);
    await insertUploads(`
      SELECT ${legacyName("x.v")} AS name, j."homeownerId" AS owner, 'completion' AS kind, j."id" AS job_id, NULL::uuid AS thread_id, NULL::uuid AS bid_id
      FROM "jobs" j CROSS JOIN LATERAL ${arr('j."beforePhotoUrls" || j."afterPhotoUrls"')} AS x(v)`);
    await insertUploads(`
      SELECT ${legacyName("x.v")} AS name, d."raisedByUserId" AS owner, 'evidence' AS kind, d."jobId" AS job_id, NULL::uuid AS thread_id, NULL::uuid AS bid_id
      FROM "disputes" d CROSS JOIN LATERAL ${arr('d."evidenceUrls"')} AS x(v)`);
    await insertUploads(`
      SELECT ${legacyName("x.v")} AS name, m."senderId" AS owner, 'chat' AS kind, m."jobId" AS job_id, m."threadTradespersonId" AS thread_id, NULL::uuid AS bid_id
      FROM "messages" m CROSS JOIN LATERAL ${arr('m."attachmentUrls"')} AS x(v)
      UNION ALL
      SELECT ${legacyName(`m."quote"->>'attachmentUrl'`)}, m."senderId", 'chat', m."jobId", m."threadTradespersonId", NULL
      FROM "messages" m WHERE m."quote" IS NOT NULL`);
    await insertUploads(`
      SELECT ${legacyName('b."quoteAttachmentUrl"')} AS name, b."tradespersonId" AS owner, 'quote' AS kind, b."jobId" AS job_id, NULL::uuid AS thread_id, b."id" AS bid_id
      FROM "bids" b WHERE b."quoteAttachmentUrl" IS NOT NULL
      UNION ALL
      SELECT ${legacyName("h->>'attachmentUrl'")}, b."tradespersonId", 'quote', b."jobId", NULL, b."id"
      FROM "bids" b CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(b."quoteHistory") = 'array' THEN b."quoteHistory" ELSE '[]'::jsonb END) h`);

    // Rewrite stored references to the authorized file route.
    const jsonCols: [string, string][] = [
      ["jobs", "photoUrls"],
      ["jobs", "beforePhotoUrls"],
      ["jobs", "afterPhotoUrls"],
      ["disputes", "evidenceUrls"],
      ["messages", "attachmentUrls"],
      ["messages", "quote"],
      ["bids", "quoteHistory"],
      ["tradesperson_profiles", "galleryUrls"],
      ["tradesperson_profiles", "caseStudies"],
    ];
    for (const [table, col] of jsonCols) {
      await q.query(`UPDATE "${table}" SET "${col}" = replace("${col}"::text, '"/uploads/', '"/api/files/')::jsonb WHERE "${col}"::text LIKE '%"/uploads/%'`);
    }
    const textCols: [string, string][] = [
      ["users", "avatarUrl"],
      ["bids", "quoteAttachmentUrl"],
      ["tradesperson_profiles", "licenseDocUrl"],
    ];
    for (const [table, col] of textCols) {
      await q.query(`UPDATE "${table}" SET "${col}" = '/api/files/' || substring("${col}" from 10) WHERE "${col}" LIKE '/uploads/%'`);
    }

    // ---------- audit enum ----------
    await q.query(`ALTER TYPE "public"."audit_logs_action_enum" RENAME TO "audit_logs_action_enum_old"`);
    await q.query(`CREATE TYPE "public"."audit_logs_action_enum" AS ENUM('user_suspend', 'user_unsuspend', 'dispute_resolve', 'force_cancel', 'verify_tradesperson', 'admin_note', 'match_weights_update', 'best_value_blend_update', 'report_resolve', 'user_delete', 'auto_confirm')`);
    await q.query(`ALTER TABLE "audit_logs" ALTER COLUMN "action" TYPE "public"."audit_logs_action_enum" USING "action"::"text"::"public"."audit_logs_action_enum"`);
    await q.query(`DROP TYPE "public"."audit_logs_action_enum_old"`);

    // ---------- check constraints (data cleaned above) ----------
    await q.query(`ALTER TABLE "tradesperson_profiles" ADD CONSTRAINT "CHK_profile_years" CHECK ("yearsExperience" IS NULL OR ("yearsExperience" >= 0 AND "yearsExperience" <= 80))`);
    await q.query(`ALTER TABLE "tradesperson_profiles" ADD CONSTRAINT "CHK_profile_rates" CHECK (("hourlyRateMin" IS NULL OR "hourlyRateMin" >= 0) AND ("hourlyRateMax" IS NULL OR "hourlyRateMax" >= 0))`);
    await q.query(`ALTER TABLE "tradesperson_profiles" ADD CONSTRAINT "CHK_profile_lng" CHECK ("lng" IS NULL OR ("lng" >= -180 AND "lng" <= 180))`);
    await q.query(`ALTER TABLE "tradesperson_profiles" ADD CONSTRAINT "CHK_profile_lat" CHECK ("lat" IS NULL OR ("lat" >= -90 AND "lat" <= 90))`);
    await q.query(`ALTER TABLE "bids" ADD CONSTRAINT "CHK_bid_eta" CHECK ("etaDays" IS NULL OR ("etaDays" >= 0 AND "etaDays" <= 365))`);
    await q.query(`ALTER TABLE "bids" ADD CONSTRAINT "CHK_bid_quote_amount" CHECK ("quoteAmount" IS NULL OR "quoteAmount" > 0)`);
    await q.query(`ALTER TABLE "bids" ADD CONSTRAINT "CHK_bid_amount" CHECK ("amount" > 0)`);
    await q.query(`ALTER TABLE "payment_milestones" ADD CONSTRAINT "CHK_milestone_amount" CHECK ("amount" >= 0)`);
    await q.query(`ALTER TABLE "jobs" ADD CONSTRAINT "CHK_job_escrow" CHECK ("escrowAmount" IS NULL OR "escrowAmount" >= 0)`);
    await q.query(`ALTER TABLE "jobs" ADD CONSTRAINT "CHK_job_lng" CHECK ("lng" IS NULL OR ("lng" >= -180 AND "lng" <= 180))`);
    await q.query(`ALTER TABLE "jobs" ADD CONSTRAINT "CHK_job_lat" CHECK ("lat" IS NULL OR ("lat" >= -90 AND "lat" <= 90))`);
    await q.query(`ALTER TABLE "jobs" ADD CONSTRAINT "CHK_job_budget_order" CHECK ("budgetMin" IS NULL OR "budgetMax" IS NULL OR "budgetMin" <= "budgetMax")`);
    await q.query(`ALTER TABLE "jobs" ADD CONSTRAINT "CHK_job_budget_max" CHECK ("budgetMax" IS NULL OR "budgetMax" >= 0)`);
    await q.query(`ALTER TABLE "jobs" ADD CONSTRAINT "CHK_job_budget_min" CHECK ("budgetMin" IS NULL OR "budgetMin" >= 0)`);
    await q.query(`ALTER TABLE "jobs" ADD CONSTRAINT "CHK_job_max_bids" CHECK ("maxBids" >= 1 AND "maxBids" <= 50)`);
    await q.query(`ALTER TABLE "reviews" ADD CONSTRAINT "CHK_review_rating" CHECK ("rating" >= 1 AND "rating" <= 5)`);

    // ---------- foreign keys ----------
    await q.query(`ALTER TABLE "job_invites" ADD CONSTRAINT "FK_0f588f5e548b7bc8f01c8e8d8c3" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    await q.query(`ALTER TABLE "job_invites" ADD CONSTRAINT "FK_cf00c5e5fd5696788766a6668ec" FOREIGN KEY ("tradespersonId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    await q.query(`ALTER TABLE "refresh_tokens" ADD CONSTRAINT "FK_610102b60fea1455310ccd299de" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    await q.query(`ALTER TABLE "email_tokens" ADD CONSTRAINT "FK_0a5e6c81093655b770eabd04600" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    await q.query(`ALTER TABLE "user_templates" ADD CONSTRAINT "FK_efe7f18d7a8af80d9cab84711f3" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "user_templates" DROP CONSTRAINT "FK_efe7f18d7a8af80d9cab84711f3"`);
    await q.query(`ALTER TABLE "email_tokens" DROP CONSTRAINT "FK_0a5e6c81093655b770eabd04600"`);
    await q.query(`ALTER TABLE "refresh_tokens" DROP CONSTRAINT "FK_610102b60fea1455310ccd299de"`);
    await q.query(`ALTER TABLE "job_invites" DROP CONSTRAINT "FK_cf00c5e5fd5696788766a6668ec"`);
    await q.query(`ALTER TABLE "job_invites" DROP CONSTRAINT "FK_0f588f5e548b7bc8f01c8e8d8c3"`);

    for (const [table, name] of [
      ["reviews", "CHK_review_rating"],
      ["jobs", "CHK_job_max_bids"],
      ["jobs", "CHK_job_budget_min"],
      ["jobs", "CHK_job_budget_max"],
      ["jobs", "CHK_job_budget_order"],
      ["jobs", "CHK_job_lat"],
      ["jobs", "CHK_job_lng"],
      ["jobs", "CHK_job_escrow"],
      ["payment_milestones", "CHK_milestone_amount"],
      ["bids", "CHK_bid_amount"],
      ["bids", "CHK_bid_quote_amount"],
      ["bids", "CHK_bid_eta"],
      ["tradesperson_profiles", "CHK_profile_lat"],
      ["tradesperson_profiles", "CHK_profile_lng"],
      ["tradesperson_profiles", "CHK_profile_rates"],
      ["tradesperson_profiles", "CHK_profile_years"],
    ]) {
      await q.query(`ALTER TABLE "${table}" DROP CONSTRAINT "${name}"`);
    }

    await q.query(`CREATE TYPE "public"."audit_logs_action_enum_old" AS ENUM('user_suspend', 'user_unsuspend', 'dispute_resolve', 'force_cancel', 'verify_tradesperson', 'admin_note', 'match_weights_update', 'best_value_blend_update')`);
    await q.query(`DELETE FROM "audit_logs" WHERE "action" IN ('report_resolve', 'user_delete', 'auto_confirm')`);
    await q.query(`ALTER TABLE "audit_logs" ALTER COLUMN "action" TYPE "public"."audit_logs_action_enum_old" USING "action"::"text"::"public"."audit_logs_action_enum_old"`);
    await q.query(`DROP TYPE "public"."audit_logs_action_enum"`);
    await q.query(`ALTER TYPE "public"."audit_logs_action_enum_old" RENAME TO "audit_logs_action_enum"`);

    // File references back to the legacy static path.
    for (const [table, col] of [
      ["jobs", "photoUrls"],
      ["jobs", "beforePhotoUrls"],
      ["jobs", "afterPhotoUrls"],
      ["disputes", "evidenceUrls"],
      ["messages", "attachmentUrls"],
      ["messages", "quote"],
      ["bids", "quoteHistory"],
      ["tradesperson_profiles", "galleryUrls"],
      ["tradesperson_profiles", "caseStudies"],
    ]) {
      await q.query(`UPDATE "${table}" SET "${col}" = replace("${col}"::text, '"/api/files/', '"/uploads/')::jsonb WHERE "${col}"::text LIKE '%"/api/files/%'`);
    }
    for (const [table, col] of [
      ["users", "avatarUrl"],
      ["bids", "quoteAttachmentUrl"],
      ["tradesperson_profiles", "licenseDocUrl"],
    ]) {
      await q.query(`UPDATE "${table}" SET "${col}" = '/uploads/' || substring("${col}" from 12) WHERE "${col}" LIKE '/api/files/%'`);
    }

    await q.query(`DROP INDEX "public"."IDX_a70f81c325235e00402fe68ac3"`);
    await q.query(`ALTER TABLE "messages" ADD "readAt" TIMESTAMP WITH TIME ZONE`);
    await q.query(`ALTER TABLE "messages" DROP COLUMN "threadTradespersonId"`);

    await q.query(`DROP INDEX "public"."UQ_review_job_direction"`);
    await q.query(`DROP INDEX "public"."IDX_c8f626e1e943aabb0f90fb8ee6"`);
    await q.query(`DELETE FROM "reviews" WHERE "direction" <> 'client_to_pro'`);
    await q.query(`ALTER TABLE "reviews" ADD CONSTRAINT "UQ_c3c015435fedbf60baee6eac0ec" UNIQUE ("jobId")`);
    await q.query(`ALTER TABLE "reviews" DROP COLUMN "revieweeId"`);
    await q.query(`ALTER TABLE "reviews" DROP COLUMN "direction"`);

    await q.query(`DROP INDEX "public"."UQ_milestone_job_sequence"`);
    await q.query(`DROP INDEX "public"."IDX_d424abda2f57327eb459d23d51"`);
    await q.query(`DROP INDEX "public"."UQ_dispute_one_open_per_job"`);
    await q.query(`ALTER TABLE "disputes" DROP COLUMN "previousJobStatus"`);
    await q.query(`DROP INDEX "public"."UQ_bid_job_pro"`);
    await q.query(`DROP INDEX "public"."UQ_bid_one_accepted_per_job"`);
    await q.query(`ALTER TABLE "bids" DROP COLUMN "quoteRevision"`);

    await q.query(`DROP INDEX "public"."IDX_e44ace7ce1b22b846b9f76de58"`);
    await q.query(`DROP INDEX "public"."IDX_af924c25aab35b33928211bb1f"`);
    await q.query(`ALTER TABLE "jobs" DROP COLUMN "photoConsent"`);
    await q.query(`ALTER TABLE "jobs" DROP COLUMN "pendingConfirmationAt"`);
    await q.query(`CREATE TYPE "public"."jobs_status_enum_old" AS ENUM('open', 'bidding_closed', 'awarded', 'in_progress', 'completed', 'cancelled', 'disputed')`);
    await q.query(`ALTER TABLE "jobs" ALTER COLUMN "status" DROP DEFAULT`);
    await q.query(`UPDATE "jobs" SET "status" = 'in_progress' WHERE "status" = 'pending_confirmation'`);
    await q.query(`ALTER TABLE "jobs" ALTER COLUMN "status" TYPE "public"."jobs_status_enum_old" USING "status"::"text"::"public"."jobs_status_enum_old"`);
    await q.query(`ALTER TABLE "jobs" ALTER COLUMN "status" SET DEFAULT 'open'`);
    await q.query(`DROP TYPE "public"."jobs_status_enum"`);
    await q.query(`ALTER TYPE "public"."jobs_status_enum_old" RENAME TO "jobs_status_enum"`);

    const templateCols: [string, string][] = [
      ["inviteTemplates", "invite"],
      ["counterTemplates", "counter"],
      ["homeownerCounterTemplates", "homeownerCounter"],
      ["introTemplates", "intro"],
      ["namedJobTemplates", "namedJob"],
    ];
    for (const [col, kind] of templateCols) {
      await q.query(`ALTER TABLE "users" ADD "${col}" jsonb`);
      await q.query(`
        UPDATE "users" u SET "${col}" = t.items
        FROM (
          SELECT "userId", jsonb_agg("data" ORDER BY "position") AS items
          FROM "user_templates" WHERE "kind" = '${kind}' GROUP BY "userId"
        ) t
        WHERE t."userId" = u."id"`);
    }
    await q.query(`ALTER TABLE "users" DROP COLUMN "deletedAt"`);
    await q.query(`ALTER TABLE "users" DROP COLUMN "timezone"`);
    await q.query(`ALTER TABLE "users" DROP COLUMN "emailVerifiedAt"`);
    await q.query(`ALTER TABLE "users" DROP COLUMN "tokenVersion"`);

    const tsColumns: Record<string, string[]> = {
      tradesperson_profiles: ["createdAt", "updatedAt"],
      bids: ["createdAt", "updatedAt"],
      disputes: ["createdAt", "updatedAt"],
      payment_milestones: ["createdAt", "updatedAt"],
      jobs: ["createdAt", "updatedAt"],
      users: ["createdAt", "updatedAt"],
      reviews: ["createdAt"],
      messages: ["createdAt"],
      notifications: ["createdAt"],
      favorites: ["createdAt"],
      audit_logs: ["createdAt"],
      app_configs: ["createdAt", "updatedAt"],
    };
    for (const [table, cols] of Object.entries(tsColumns)) {
      for (const col of cols) {
        await q.query(`ALTER TABLE "${table}" ALTER COLUMN "${col}" TYPE TIMESTAMP WITHOUT TIME ZONE`);
      }
    }

    for (const t of [
      "user_templates",
      "reports",
      "email_tokens",
      "refresh_tokens",
      "uploads",
      "idempotency_keys",
      "job_invites",
      "ledger_entries",
      "chat_thread_reads",
    ]) {
      await q.query(`DROP TABLE "${t}"`);
    }
  }
}
