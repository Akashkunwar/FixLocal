# Operating FixLocal

A runbook for a single-server deployment with `docker-compose.yml`. Managed Postgres and Redis work the same way: point `DB_*` and `REDIS_URL` at them.

## First deploy

1. Create `.env` next to `docker-compose.yml`, starting from `.env.example`. You need at least:
   - `JWT_SECRET` and `FILE_URL_SECRET`: 48 random bytes each (`openssl rand -base64 48`).
   - `DB_PASSWORD`.
   - `APP_URL=https://your-domain` and `COOKIE_SECURE=true`.
   - `MAIL_PROVIDER=smtp`, `SMTP_URL=smtps://user:pass@smtp.provider:465` and `MAIL_FROM`.
   - `VITE_SITE_URL`, `VITE_LEGAL_ENTITY`, `VITE_SUPPORT_EMAIL`, `VITE_GRIEVANCE_OFFICER` and `VITE_GRIEVANCE_EMAIL`.
   - `VITE_MAP_TILE_URL` and `VITE_MAP_ATTRIBUTION` for your tile provider.
   - Optionally, `ERROR_WEBHOOK_URL` (a Slack or Discord incoming webhook, or a Sentry relay).
   - Optionally, `STORAGE_DRIVER=s3` with `S3_BUCKET` (plus `S3_ENDPOINT` and keys for R2/B2/MinIO) to keep uploads in a bucket instead of the `uploads` volume. Required before running more than one API instance. Keep the bucket private: files are always served through the API, which checks access.
2. Put HTTPS in front of the `web` container (Caddy, nginx or a cloud load balancer) and forward to port 8080.
3. Start the stack:

   ```bash
   docker compose up -d --build
   docker compose --profile backup up -d backup   # nightly database dumps
   ```

4. The API applies pending migrations on start (`MIGRATIONS_RUN=true`). It refuses to start, and logs exactly why, if a secret is weak, email isn't configured, or https is used without secure cookies.
5. Create the first admin: sign up normally on the site, verify the email, and then promote that account:

   ```bash
   docker compose exec db psql -U fixlocal -d fixlocal -c "UPDATE users SET role='ADMIN' WHERE email='you@your-domain'"
   ```

   Don't run the demo seed (`npm run seed`) against production; it creates accounts with known passwords.

## Deploying an update

```bash
git pull
docker compose up -d --build api web
docker compose ps        # api must turn "healthy" (GET /health checks the database)
```

Migrations run automatically. To roll back code, check out the previous tag and rebuild. If the newer release added a migration, revert it first. Run `npm run db:revert` from a checkout of the newer code in `backend/`, with `DB_*` pointing at production. Then start the older code.

## Backups

The `backup` service writes `fixlocal-<UTC time>.dump` (pg_dump custom format) to the `db_backups` volume every 24 hours and keeps 14 days (`BACKUP_KEEP_DAYS`). Copy the files somewhere else as well, for example:

```bash
docker run --rm -v fixlocal_db_backups:/b -v "$PWD":/out alpine sh -c 'cp /b/*.dump /out/'
# then sync ./ to S3 / another server
```

Uploaded files live in the `uploads` volume; back that up too.

### Restore

```bash
docker compose stop api
docker compose exec -T db dropdb -U fixlocal fixlocal
docker compose exec -T db createdb -U fixlocal fixlocal
docker compose exec -T db pg_restore -U fixlocal -d fixlocal --no-owner < fixlocal-YYYYMMDDTHHMMSSZ.dump
docker compose start api
```

Test a restore on a spare machine at least once before launch.

## Monitoring

- Point an uptime monitor at `https://your-domain/health`. It returns 503 when the database is unreachable and reports Redis status.
- Every unexpected 500, unhandled rejection or crash is POSTed to `ERROR_WEBHOOK_URL` with the request id. Users see the same id in the error message, so a support ticket can be matched to the log line (`docker compose logs api | grep <requestId>`).
- Logs are JSON (pino) on stdout. Ship them with your host's log driver if you need retention.

## Routine admin work

- **Verify pros:** Admin → Verification queue.
- **Reports and blocks:** Admin → Reports. Suspending a user signs them out everywhere.
- **Disputes:** Admin → Disputes. A ruling releases, refunds or splits the held escrow and is written to the audit log.
- **Terms update:** edit the pages, bump `TERMS_VERSION` in `backend/src/domain/legal.ts`, and deploy. Every user is asked to accept again.

## Payments (when going live)

Escrow is simulated (`SimulatedPaymentProvider`). To take real money:

1. Implement `PaymentProvider` for the gateway (see the Razorpay notes in `backend/src/services/payments.ts`).
2. Move gateway calls out of the database transaction with an outbox table and webhooks.
3. Update the Terms and bump `TERMS_VERSION`.

## SMS and WhatsApp alerts

Text alerts are **off by default** (`MESSAGING_ENABLED=false`). While off, Settings shows "Text alerts aren't switched on yet" and the API refuses phone codes and opt-ins. Turning it on with the default `log` drivers is safe: nothing leaves the server, and outside production the dev outbox (`/api/dev/outbox`, `texts`) shows what would have been sent.

**What gets texted** (only to users who verified their mobile number and opted in to that channel in Settings): a first bid on a client's job, being hired, a payment released, and job alerts (instant ones, plus the 8 AM daily digest). Messages are short: a title in the user's language (English or Hindi) and a link.

**Quiet hours:** nothing is sent between 10 PM and 8 AM IST. Texts created then wait in `outbound_messages` and the worker sends them at 8 AM. The one exception is the phone verification code, which the user asked for. Messages are de-duplicated per notification and channel, claimed with `FOR UPDATE SKIP LOCKED` (no double sends across instances), re-checked against the user's opt-in at send time, and retried up to 3 times with back-off. Sent/failed rows are deleted after 30 days.

### MSG91 (SMS)

1. Create an MSG91 account and complete **DLT registration** (required in India): register the entity, a 6-character sender ID (header) and a transactional content template.
2. Create a **Flow** in MSG91 whose template has one variable named `message` (for example `##message##`), linked to the DLT template. Both the OTP text and alert texts are sent through it.
3. Set:
   ```
   MESSAGING_ENABLED=true
   SMS_DRIVER=msg91
   MSG91_AUTH_KEY=<your auth key>
   MSG91_TEMPLATE_ID=<flow template id>
   MSG91_SENDER_ID=<6-letter sender id>   # optional if set on the flow
   ```
4. Restart the API. Startup fails with a clear error if `SMS_DRIVER=msg91` is set without the key and template.

### WhatsApp Cloud API

1. In Meta Business Manager, create a WhatsApp Business account, add and verify the sending number, and note its **Phone number ID**.
2. Create a **System User** with `whatsapp_business_messaging` permission and generate a permanent access token.
3. Create a **Utility** message template named `fixlocal_update` (or set `WHATSAPP_TEMPLATE`) with a body of one variable, e.g. `{{1}}`, in **English (`en`) and Hindi (`hi`)**, and wait for approval. Templates are required because FixLocal starts the conversation.
4. Set:
   ```
   MESSAGING_ENABLED=true
   WHATSAPP_DRIVER=cloud
   WHATSAPP_TOKEN=<system user token>
   WHATSAPP_PHONE_NUMBER_ID=<phone number id>
   WHATSAPP_TEMPLATE=fixlocal_update
   WHATSAPP_API_VERSION=v21.0
   ```
5. Phone verification codes always go by SMS, so a WhatsApp-only setup still needs `SMS_DRIVER=msg91` before real users can verify a number. (With the `log` driver in production, message text is never written to the log, so codes can't be read anywhere.)

Keep these keys in the server's secret store, never in the repo. Watch the API log for `text message failed` warnings.
