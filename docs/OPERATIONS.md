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
