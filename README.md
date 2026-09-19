# FixLocal

A local work marketplace. **Clients** post jobs (repairs, cleaning, office and facilities, tech, moving and more) with photos, a budget and a map pin. Admin-verified **professionals** bid. The client compares bids, negotiates, and hires. The job then moves through scheduling, chat, work, confirmation, reviews and (if needed) a dispute. Payments use **simulated escrow milestones** (Deposit 30% · Progress 40% · Completion 30%); no real money moves.

> Internal role keys are `HOMEOWNER` / `TRADESPERSON`; everything users see says **Client** / **Professional**. URLs are `/client/*` and `/professional/*` (old `/homeowner/*` and `/tradesperson/*` links redirect).

The history of features built during the course is in [docs/FEATURE_HISTORY.md](docs/FEATURE_HISTORY.md).

## Contents

- [Architecture](#architecture)
- [Quick start with Docker](#quick-start-with-docker)
- [Local development](#local-development)
- [Upgrading an existing development database](#upgrading-an-existing-development-database)
- [Configuration](#configuration)
- [Testing](#testing)
- [Security model](#security-model)
- [Project layout](#project-layout)
- [Before a real launch](#before-a-real-launch)

## Architecture

| Layer | Technology |
| --- | --- |
| Frontend | React 18, Vite, TypeScript, Tailwind CSS, React Router 7, Leaflet |
| Backend | Node.js 22, Express 5, TypeORM 0.3, PostgreSQL, zod validation, pino logging |
| Cache / live updates | Redis (optional in development): auth-state cache, rate limits, open-job cache, cross-instance chat fan-out |
| Files | Local disk (`UPLOADS_DIR`), served through `/api/files/:name` with signed, expiring URLs |
| Tests | Vitest + Supertest (API), Vitest + Testing Library (UI), Playwright (end to end) |

```
browser ──► nginx (web) ──► /api/*  ──► Express API ──► PostgreSQL
             │  serves the built SPA        │  └──────► Redis
             └─ same origin, so the refresh cookie works
```

Main ideas:

- **Auth**: a short-lived access token (15 min) kept only in memory, plus a rotating refresh token in an `httpOnly` cookie (`fl_refresh`, path `/api/auth`). Reusing an old refresh token revokes the whole session family. Changing the password, "sign out everywhere", suspension and account deletion revoke everything at once.
- **Authorization** lives in `backend/src/policies`: one place decides who can see a job (full details, listing only, or nothing), who can post in which chat thread, and who can act at each job stage. A table-driven test checks 840 action × state × actor combinations.
- **Job lifecycle** is a state machine: `open → awarded → in_progress → pending_confirmation → completed`, plus `cancelled` and `disputed`. The pro marks work done; the client confirms (or it auto-confirms after `AUTO_CONFIRM_DAYS`), which releases any remaining escrow.
- **Money** is recorded in a ledger (`ledger_entries`); earnings and admin totals come from the ledger, not from bid amounts. Accepting a bid, releasing milestones and confirming completion use row locks and optional `Idempotency-Key` headers, so double clicks and races can't double-pay.
- **Chat** is one private thread per (job, professional). Live updates use server-sent events with one-time tickets (no tokens in URLs), with polling as a fallback.
- **Schema changes** go through migrations only (`synchronize` is off).

## Quick start with Docker

Runs Postgres, Redis, the API and the web app (nginx) together.

```bash
cp .env.example .env
# put two random secrets in .env:
#   JWT_SECRET=$(openssl rand -base64 48)
#   FILE_URL_SECRET=$(openssl rand -base64 48)
docker compose up --build
```

Open http://localhost:8080. Migrations run automatically when the API starts.

The Docker stack runs in production mode, so:

- New accounts must verify their email. There is no real email provider yet, so the links are printed in the API log: `docker compose logs api | grep verify-email`.
- Demo data is not loaded. To add it (development only): `docker compose run --rm -e NODE_ENV=development api node dist/scripts/seed.js`.
- Behind HTTPS, set `COOKIE_SECURE=true` and `APP_URL=https://your-domain`.

## Local development

Prerequisites: **Node.js 22.12+**, **PostgreSQL 14+**, and optionally **Redis 6+** (the API works without it, with an in-memory fallback).

```bash
# 1. database (once)
psql postgres -c "CREATE USER fixlocal WITH PASSWORD 'fixlocal' CREATEDB;"
psql postgres -c "CREATE DATABASE fixlocal OWNER fixlocal;"

# 2. API — http://localhost:3001
cd backend
cp .env.example .env
npm install
npm run db:migrate
npm run seed           # demo accounts and sample jobs
npm run dev

# 3. web app — http://localhost:5173 (proxies /api to the API)
cd ../frontend
cp .env.example .env
npm install
npm run dev
```

`CREATEDB` is only needed so the test suites can create their own databases (`fixlocal_test`, `fixlocal_migrate`, `fixlocal_e2e`).

For local development you can set `DEV_AUTO_VERIFY_EMAIL=true` (skip email verification) and `DEV_OUTBOX=true` (see sent emails at `GET /api/dev/outbox`) in `backend/.env`. Both are ignored in production.

### Demo accounts

Created by `npm run seed`. Password: `SEED_PASSWORD` from `backend/.env` (default `Password123!`). Re-running the seed doesn't reset existing passwords unless `SEED_RESET=true`. The seed refuses to run with `NODE_ENV=production`.

| Email | Role | Notes |
| --- | --- | --- |
| admin@fixlocal.local | Admin | |
| home@fixlocal.local | Client | Priya, sample jobs |
| home2@fixlocal.local | Client | Rahul |
| pro@fixlocal.local | Professional | Arjun, verified, has a review |
| pro2@fixlocal.local | Professional | Sneha, verified |
| pro3@fixlocal.local | Professional | Vikram, pending verification |

The login page only shows these accounts when the frontend has `VITE_DEMO_MODE=true`.

## Upgrading an existing development database

Databases created before the migration setup (by the old `synchronize` option) need a one-time baseline. Your data is kept:

```bash
cd backend
npm run db:baseline    # records the baseline migration as already applied
npm run db:migrate     # applies the audit-hardening migration
```

Then restart `npm run dev`. The API refuses to start while migrations are pending (set `MIGRATIONS_RUN=true` to apply them on start instead).

What the hardening migration changes in existing data:

- Chat messages are assigned to per-professional threads. Messages on jobs that never had a bid are removed, and existing messages are marked read.
- Invites and saved templates move from JSON columns into their own tables (`job_invites`, `user_templates`), and a payment ledger (`ledger_entries`) is back-filled from existing escrow milestones.
- New constraints are added (one bid per pro per job, one accepted bid per job, one open dispute per job, money amounts non-negative).

`npm run db:revert` undoes the latest migration.

## Configuration

Every backend setting is documented in [`backend/.env.example`](backend/.env.example) and validated at startup (`backend/src/config.ts`). In production the API refuses to start with a weak `JWT_SECRET` or a missing `FILE_URL_SECRET` (32+ characters each).

Frontend settings ([`frontend/.env.example`](frontend/.env.example)):

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_URL` | empty | Leave empty: the dev server and nginx proxy `/api`, so everything is same-origin |
| `VITE_PROXY_TARGET` | `http://localhost:3001` | Where the Vite dev server sends `/api` |
| `VITE_DEMO_MODE` | `false` | Show demo accounts on the login page |
| `VITE_MAP_TILE_URL` / `VITE_MAP_ATTRIBUTION` | OpenStreetMap | OSM's public tiles are for light use only; use a provider with a production policy before launch |

## Testing

| Command | What it covers |
| --- | --- |
| `cd backend && npm test` | 160+ API tests on a throwaway database (`fixlocal_test`, Redis DB 15): every audit finding's repro, an 840-case authorization matrix, concurrency races looped 20×, upload attacks, a malformed-input fuzz test, migrations up/down/up, performance smoke |
| `cd backend && npm run test:coverage` | The same with a coverage report |
| `cd frontend && npm test` | UI unit tests: token refresh, session loss, SSE tickets, chat back-off, image re-encoding, invoice printing, templates, error boundary |
| `cd frontend && npm run test:e2e` | 20 Playwright journeys in a real browser against a real API |
| `npm run lint` / `npm run typecheck` | In both packages |

The end-to-end suite starts its own API on port **3101** with a fresh `fixlocal_e2e` database (Redis DB 14), and a Vite server on port **5174**. It never touches the development database or the servers on 3001/5173. The first run needs `npx playwright install chromium`.

The E2E journeys cover:

1. Client sign-up, email verification, and the job wizard with photos and a map pin.
2. Pro sign-up, pending verification, licence upload, admin verification, filters, saved search, and a bid with a quote PDF.
3. Bid comparison, counter-offer, pro revision, and acceptance with the escrow split.
4. A quote changing between page load and acceptance.
5. Scheduling and calendar export.
6. Private chat threads, attachments, live updates, and polling fallback.
7. Start work, before/after photos, mark done, confirm, reviews both ways, and the invoice.
8. A dispute with evidence and a refund.
9. Admin tools: stats, suspension, force-cancel, and audit rollback.
10. Invites and declines.
11. Shortlist and Find Pros filters.
12. AMC (maintenance contract) proposals.
13. Settings.
14. Session expiry and logout.
15. Mobile layout.
16. Public pages and legacy URLs.

`.github/workflows/ci.yml` runs lint, type checks, both unit suites with coverage, the E2E suite, `npm audit --audit-level=high`, and the Docker builds on every push and pull request. Dependabot keeps dependencies current.

The `frontend/scripts/*-smoke.mjs` scripts (`npm run waveNN:smoke`, `npm run e2e:*`) are **legacy** checks from the course. They read `API_URL`, `FE_URL` and `SEED_PASSWORD`, and some assume behaviour that has since changed (e.g. unverified accounts posting jobs). The suites above replace them.

## Security model

- Passwords: bcrypt (cost 12), 10–128 characters, constant-time login (no user enumeration), per-email and per-IP rate limits.
- Tokens: access token in memory only; refresh token `httpOnly`, rotated on every use, reuse detection, hashed at rest. `tokenVersion` revokes all sessions.
- Email verification is required before posting jobs or bidding. Password reset tokens are single-use and expire in one hour.
- Every request body, query and parameter is validated with zod; errors come back as `{ message, code }` and never leak stack traces.
- Uploads: file type is checked from the file's content (JPG, PNG, WebP, PDF only). Images are re-encoded (removing EXIF/GPS) and stored under random names. Private files (job photos, chat attachments, dispute evidence, licences) are served only to people allowed to see them, through signed URLs that expire; portfolio images and avatars are public.
- Contact details (email, phone, exact address, licence document) are only shown to people who need them: the hired pro, the client who hired them, and admins.
- helmet security headers, a CORS allowlist, request IDs in logs, and graceful shutdown.
- Admin actions (verification, suspension, disputes, force-cancel, weight changes) are written to an audit log.

## Project layout

```
fixlocal/
  backend/
    src/
      controllers/   request handlers
      routes/        URL → middleware → controller
      policies/      who may do what (job access, chat threads)
      domain/        job state machine, escrow, matching, time zones
      serializers/   the only way entities leave the API (no raw rows)
      middleware/    auth, validation, uploads, rate limits, idempotency, errors
      services/      files, mailer
      workers/       auto-confirm, nudges, clean-up
      migrations/    schema history
    test/            API test suites
    Dockerfile
  frontend/
    src/
      api/           typed API client (token refresh lives here)
      auth/          session state
      pages/         routes (client, professional, admin)
      components/
      lib/
    e2e/             Playwright journeys
    Dockerfile, nginx.conf
  docs/
  docker-compose.yml
  .github/           CI and Dependabot
```

## Before a real launch

These need a product or business decision and aren't done yet:

- **Payments**: escrow is simulated. A real launch needs a licensed payment gateway with escrow or marketplace payouts (for example Razorpay Route or Stripe Connect), plus refunds, KYC for payouts, invoices and tax handling.
- **Email**: messages are written to the log (console mailer). Plug a provider (SES, Postmark, SendGrid…) into `backend/src/services/mailer.ts`.
- **Identity checks**: admins review uploaded licences by hand. Consider an ID-verification service.
- **SMS / WhatsApp** notifications, if needed.
- **Hosting**: object storage for uploads (S3 or similar) instead of local disk if you run more than one API instance; managed Postgres and Redis; HTTPS; backups; monitoring and alerting.
- **Map tiles**: set `VITE_MAP_TILE_URL` to a provider whose terms allow production traffic.
- **Legal**: terms of service, privacy policy, and cookie notice.
