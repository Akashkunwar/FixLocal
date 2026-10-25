# FixLocal launch readiness

Review date: 25 October 2026 · Branch `launch-readiness-2026-10-25` (stacks on PR #29)

## Verdict

**Code: ready for a closed pilot / soft launch.** Every launch blocker that can be fixed in code is fixed and tested.

**Business: not ready for a public launch that takes real money.** Seven items need the owner (Kunwar), not code. They are listed under [Needs Kunwar](#needs-kunwar-before-a-public-launch). The most important are a payment gateway with KYC, a real email provider, legal review of the Terms and Privacy drafts, and production hosting with backups.

| Launch type | Go? | Condition |
| --- | --- | --- |
| Invite-only pilot with simulated payments | **Go** | Set `MAIL_PROVIDER=smtp` and `SMTP_URL`, HTTPS with `COOKIE_SECURE=true`, a Grievance Officer in the `VITE_*` build args, and turn on the `backup` profile |
| Public launch, still simulated payments | Go after legal review | Publish the reviewed Terms and Privacy pages; add a production map-tile provider |
| Public launch with real payments | **No-go** until a gateway is wired | Razorpay Route (or similar) KYC, adapter behind `PaymentProvider`, outbox for gateway calls, GST invoices |

Legend: **P0** = launch blocker, **P1** = fix before or right after launch, **P2** = nice to have. **Code** = fixable here. **Kunwar** = needs a business decision, an account or a contract.

## What was fixed this round (P0 / P1, code)

| # | Area | Gap | Pri | Fix |
| --- | --- | --- | --- | --- |
| 1 | Escrow | A client could "confirm completion" straight from **awarded**, releasing 100% of escrow before any work started | P0 | `confirm` and `complete` are now allowed only from `in_progress` or `pending_confirmation` (409 otherwise). The UI hides the button until work starts. Admin dispute rulings can still complete a job |
| 2 | Escrow | No way to call off a hired job before it starts. Money stayed held forever, or the only option was a dispute | P0 | `POST /api/jobs/:id/cancel-booking` (client or hired pro, awarded only). One transaction cancels the job and refunds every held milestone; a deposit already released stays with the pro. Races refund exactly once. The other side is notified |
| 3 | Legal | No Terms of Service, Privacy Policy or consent record | P0 | `/terms` and `/privacy` (India / DPDP Act drafts). Sign-up requires a ticked checkbox (`acceptTerms: true`), stored as `termsAcceptedAt` and `termsVersion`. Older accounts see an accept banner (`POST /api/auth/accept-terms`) |
| 4 | Email | Only a console mailer existed, so verification and reset emails never reached anyone in production | P0 | SMTP provider (`MAIL_PROVIDER=smtp`, `SMTP_URL`, `MAIL_FROM`). Production refuses to start with the console mailer unless `ALLOW_CONSOLE_MAIL=true`. Mail failures are logged and reported, never thrown at the user |
| 5 | Config | Production could run with an https `APP_URL` but insecure cookies | P1 | Startup check: https `APP_URL` requires `COOKIE_SECURE=true` |
| 6 | Observability | No error tracking; 500 responses gave nothing to quote to support | P1 | `ERROR_WEBHOOK_URL` receives every unexpected 500, unhandled rejection and uncaught exception (JSON, with request id, route and user id). 500 bodies include `requestId` |
| 7 | Reliability | `uncaughtException` was not handled | P1 | It is now logged as fatal, reported, and the process exits so the orchestrator restarts it |
| 8 | Abuse | Job posting and bidding had no rate limit | P1 | `jobPosts` 20/h and `bids` 60/h per user (IP fallback); `blocks` 30/h; `exports` 5/h |
| 9 | Trust & safety | No way to block an abusive user | P1 | `/api/blocks`. A block stops bids, invites and new messages in both directions (existing threads become read-only). There is a Block button on pro profiles and job pages, and the blocked list in Settings |
| 10 | Privacy (DPDP) | No way to get a copy of your data | P1 | `GET /api/auth/me/export` downloads everything held about you as JSON (account, profile, jobs, bids, messages, reviews, notifications, favourites, blocks, reports, disputes, ledger, files). Rate limited, `no-store`, and leak-checked by the test suite |
| 11 | Notifications | Important events were in-app only | P1 | New bid, hired, job status and dispute notifications are also emailed to verified addresses, with a one-switch opt-out in Settings |
| 12 | Payments | Escrow was wired directly to the database, so a real gateway couldn't be added later | P1 | `PaymentProvider` interface (simulated by default). Every ledger row now carries an idempotent `providerRef`. A provider failure rolls back the hire. Razorpay mapping documented in `services/payments.ts` |
| 13 | Deploy | No backups | P1 | Opt-in `backup` service in `docker-compose.yml` (nightly `pg_dump`, 14-day retention). Restore runbook in [OPERATIONS.md](OPERATIONS.md) |
| 14 | UX / SEO | Unknown URLs silently redirected to `/`; no robots or sitemap; one title for every page | P1 | 404 page; per-page titles (WCAG 2.4.2); canonical and Open Graph tags; build-time `sitemap.xml` and `robots.txt` (`VITE_SITE_URL`); `lang="en-IN"` |
| 15 | Security | Production bundles linked public source maps | P2 | Maps are `hidden` and deleted from the served image |

Schema changes are in migration `1790000000003-LaunchReadiness` (up and down), which adds:

- the `user_blocks` table
- `jobs.cancelledBy` and `jobs.cancellationReason`
- `users.termsAcceptedAt` and `users.termsVersion`
- `ledger_entries.providerRef`

`migrations.test.ts` proves it runs up, down and up again with no drift from the entities.

## Full checklist

Status: ✅ done · 🟡 partial / acceptable for pilot · ❌ open.

### Security (OWASP Top 10)

| Item | Status | Notes |
| --- | --- | --- |
| A01 Broken access control | ✅ | Role guard on every route. An 896-case authz matrix (actors × job states × actions) covers it, including the new cancel-booking action. `readonly-gets.test.ts` fails if a new GET route isn't covered |
| A02 Crypto failures | ✅ | bcrypt cost 12. Refresh tokens are hashed at rest and rotated, with reuse detection. Private files use signed, expiring URLs |
| A03 Injection | ✅ | TypeORM parameters only. zod validates every body, query and param (`.strict()`). The fuzz test sends malformed input |
| A04 Insecure design | ✅ | Escrow state machine, stage-gated releases, idempotency keys on money moves, and confirm only after work starts (fixed) |
| A05 Misconfiguration | ✅ | Startup validation refuses weak secrets, console mail and https with insecure cookies. helmet sets API headers; nginx sets the web CSP, `frame-ancestors 'none'` and a Permissions-Policy |
| A06 Vulnerable components | ✅ | `npm audit --audit-level=high` in CI; Dependabot |
| A07 Auth failures | ✅ | Per-email and per-IP login limits, constant-time login, a 10–128 character password policy, email verification before posting or bidding, and single-use reset links valid for 1 hour |
| A07 Account enumeration on register | 🟡 P2 | Sign-up says "email already registered". The usual fix (a generic reply plus an email to the owner) hurts sign-up UX, so it is left for a product call |
| A08 Integrity | ✅ | Docker builds come from lockfiles. Migrations are versioned |
| A09 Logging | ✅ | pino JSON logs with X-Request-Id, an admin audit log, and the error webhook (new) |
| A10 SSRF | ✅ | No user-supplied URLs are fetched server-side |
| Uploads | ✅ | Type is sniffed from content; images are re-encoded (EXIF stripped); random names; private by default |
| Sessions / JWT | ✅ | The access token lives in memory; the refresh cookie is httpOnly with configurable SameSite (lax by default); `tokenVersion` supports logout everywhere |
| Rate limits | ✅ | Auth, uploads, messages, reports, job posts, bids, blocks and exports. Redis-backed with an in-memory fallback |
| CSRF | ✅ | Bearer access token. The refresh cookie only mints tokens for the same origin (CORS allowlist plus SameSite) |

### Data integrity

| Item | Status | Notes |
| --- | --- | --- |
| Transactions around money moves | ✅ | Accept, release, confirm, dispute rulings and cancel-booking each run in one transaction with row locks |
| Escrow ledger | ✅ | Append-only `ledger_entries`, unique per milestone and movement, each with a `providerRef` |
| Migrations | ✅ | `MIGRATIONS_RUN=true` applies migrations on deploy; tested up, down and up |
| State machine | ✅ | One table of allowed transitions, unit-tested per action |
| External gateway calls inside DB transactions | 🟡 P1 when real payments arrive | The simulated provider is synchronous. A real gateway needs an outbox/webhook pattern (documented in `payments.ts`) |

### Reliability

| Item | Status | Notes |
| --- | --- | --- |
| Error handling | ✅ | Central handler; `{ message, code, requestId }`; no stack traces in responses |
| Health checks | ✅ | `/health` checks the DB (503 when it is down) and reports Redis; Docker HEALTHCHECK |
| Graceful shutdown | ✅ | SIGTERM drains HTTP, workers and SSE, then the DB |
| Redis down | ✅ | Cache and rate limits fall back to memory; health reports `unavailable` |
| Background jobs idempotent | ✅ | Auto-confirm and nudges use conditional updates (crash test proves it) |
| Process crashes | ✅ | `unhandledRejection` is reported; `uncaughtException` is reported and the process restarts |

### Observability

| Item | Status | Notes |
| --- | --- | --- |
| Structured logs and request ids | ✅ | pino-http; `X-Request-Id` exposed to the browser |
| Error tracking | ✅ | `ERROR_WEBHOOK_URL` (Slack, Discord or a Sentry relay) |
| Metrics, uptime alerts | ❌ Kunwar | Point an uptime monitor at `/health`. Add APM if needed |

### Performance

| Item | Status | Notes |
| --- | --- | --- |
| N+1 queries | ✅ | Query-count budget test per request |
| Indexes | ✅ | Unique and lookup indexes on the hot paths (bids per job, threads, ledger, blocks); the 300 ms perf budget test guards regressions |
| Pagination | ✅ | Job lists, notifications, admin lists |
| Bundle size | 🟡 P2 | Main chunk 253 KB (78 KB gzip); routes are lazy-loaded; the wizard chunk is 175 KB because of Leaflet |

### Deployability

| Item | Status | Notes |
| --- | --- | --- |
| Dockerfiles | ✅ | Multi-stage, non-root API, nginx web |
| Env validation | ✅ | zod at startup, extended this round |
| CI/CD | ✅ | lint, typecheck, unit (coverage), API, e2e, audit and Docker builds |
| Backups | ✅ (opt-in) | `docker compose --profile backup up -d`; restore steps in OPERATIONS.md. Off-site copies are on Kunwar |
| Uploads on local disk | 🟡 P1 Kunwar | Fine on one server. For several API instances, move to S3-compatible storage |

### Legal and trust

| Item | Status | Notes |
| --- | --- | --- |
| Terms of Service | ✅ draft | Needs legal review (Kunwar) |
| Privacy Policy (DPDP Act 2023) | ✅ draft | Needs legal review and a named Grievance Officer (IT Rules 2021) |
| Cookie notice | ✅ | Only an essential sign-in cookie is used; the Privacy Policy says so, so no consent banner is required |
| Consent record | ✅ | `termsAcceptedAt` and `termsVersion`; bump `TERMS_VERSION` to re-prompt everyone |
| Account deletion | ✅ | Settings → Delete account (anonymises the account) |
| Data export | ✅ | Settings → Download my data |
| Report user / job / message | ✅ | Existing; admin moderation queue |
| Block user | ✅ | New |
| Admin moderation | ✅ | Suspend, force-cancel, verify pros, rule on disputes, with an audit log |
| Cancellation and refund rules | ✅ | Written in the Terms and enforced in code |

### Product completeness (local services marketplace)

| Item | Status |
| --- | --- |
| Post a job (wizard, photos, map pin), invite pros, bids with quote PDFs, compare and counter, hire | ✅ |
| Verified pros (licence upload and admin review), portfolios, reviews both ways, match score | ✅ |
| Milestone escrow, stage gates, auto-confirm, disputes with evidence, invoices | ✅ simulated |
| Chat per pro with attachments and live updates; notifications (in-app and email) | ✅ |
| Scheduling and calendar export, AMC contracts, saved searches, templates, shortlist | ✅ |
| Cancellation before start, blocking, data export, Terms consent | ✅ new |
| Real payouts, GST invoices, SMS/WhatsApp, ID verification service | ❌ Kunwar |

### SEO, PWA, accessibility, locale

| Item | Status | Notes |
| --- | --- | --- |
| Page titles, meta description, canonical, Open Graph | ✅ | `VITE_SITE_URL` sets absolute URLs |
| robots.txt and sitemap.xml | ✅ | Generated at build; private areas disallowed |
| SSR or prerendering for job and pro pages | 🟡 P2 | SPA only. Category hubs, Terms and Privacy are in the sitemap; Google renders JS |
| PWA | ✅ | Manifest, icons, service worker |
| WCAG AA | 🟡 | Labelled controls, switches with `role="switch"`, focus styles, per-page titles. A full manual screen-reader audit is still a good idea |
| India locale | ✅ | ₹ with en-IN grouping; IST default time zone; `lang="en-IN"` |

## Needs Kunwar before a public launch

1. **Payment gateway and KYC.** Open a Razorpay Route (or Cashfree, or Stripe Connect India) account, complete KYC, and decide on fees and GST. Then add a `RazorpayProvider` behind `PaymentProvider` with webhooks and an outbox. Payments are simulated until then, and the Terms say so.
2. **Email provider.** Choose one (SES, Postmark, SendGrid, Zoho) and set `MAIL_PROVIDER=smtp`, `SMTP_URL` and `MAIL_FROM`, with SPF/DKIM on the domain.
3. **Legal review** of `/terms` and `/privacy`. Set the build args `VITE_LEGAL_ENTITY`, `VITE_SUPPORT_EMAIL`, `VITE_GRIEVANCE_OFFICER` and `VITE_GRIEVANCE_EMAIL`.
4. **Domain and hosting.** Set up the domain, HTTPS, managed Postgres and Redis (or the compose stack on a VM), `APP_URL`, `COOKIE_SECURE=true` and `VITE_SITE_URL`.
5. **Backups off the host.** Turn on the `backup` profile and sync the volume to S3 or another server. Test a restore.
6. **Map tiles.** Choose a production tile provider (`VITE_MAP_TILE_URL`); OSM's public servers are not for production traffic.
7. **Object storage** for uploads if you run more than one API instance.
8. **Monitoring.** Set up an uptime check on `/health` and an `ERROR_WEBHOOK_URL` destination (Slack or Discord channel).

## Remaining code items (P2, not blocking)

- Generic sign-up response to stop account enumeration.
- Prerendered public pro profile pages for SEO.
- A manual WCAG pass with a screen reader.
- An S3 storage adapter.
- Splitting Leaflet out of the job-wizard chunk.
