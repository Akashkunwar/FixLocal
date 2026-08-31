# FixLocal

This is my App Dev Lab (BSCS4010) project.

FixLocal is a website for local home repairs. A homeowner can post a job like plumbing or electrical work. A tradesperson can bid on open jobs after admin verifies them. The homeowner can accept one bid. Admin can also look at disputes if something goes wrong.

There are two folders:

- `backend` — Node.js + Express API
- `frontend` — React app

## What you need

- Node.js 20 or above
- PostgreSQL
- npm
- Redis is optional (the app still works without it)

## Database setup

Create a user and database (one time):

```bash
psql postgres -c "CREATE USER fixlocal WITH PASSWORD 'fixlocal';"
psql postgres -c "CREATE DATABASE fixlocal OWNER fixlocal;"
```

If you use Docker:

```bash
docker run --name fixlocal-pg -e POSTGRES_USER=fixlocal -e POSTGRES_PASSWORD=fixlocal -e POSTGRES_DB=fixlocal -p 5432:5432 -d postgres:15
```

Tables are created by TypeORM when the backend starts. You do not have to make tables by hand.

## Backend

```bash
cd backend
cp .env.example .env
npm install
npm run seed
npm run dev
```

Backend runs at http://localhost:3001

You can check it with: `curl http://localhost:3001/health`

## Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Frontend runs at http://localhost:5173

## Demo logins

Password for all of these is `Password123!`

| Email | Role |
| --- | --- |
| admin@fixlocal.local | Admin |
| home@fixlocal.local | Homeowner |
| pro@fixlocal.local | Tradesperson |

Admin cannot register from the website. That account is created by the seed script.

## How to try the app

1. Login as admin and verify the tradesperson (`pro@fixlocal.local`).
2. Logout. Login as homeowner. Post a job. You can also add a photo.
3. Logout. Login as tradesperson. Open the job and place a bid.
4. Login as homeowner again and accept the bid.
5. Mark the job as completed.
6. If you want, open a dispute. Admin can resolve it.

## Roles

- **Admin** — verify or suspend tradespeople, see stats, handle disputes, cancel a job if needed
- **Homeowner** — post jobs, accept a bid, complete a job, open a dispute
- **Tradesperson** — bid on open jobs (only after verification), start work, mark work completed

## Extra things I added

- Redis can cache the open jobs list. If Redis is not running, the API still works using Postgres only.
- When a bid is accepted, payment is marked as `simulated_paid`. There is no real payment.

To use Redis (optional):

```bash
brew services start redis
```

Then keep `REDIS_URL=redis://127.0.0.1:6379` in `backend/.env`.

## Project report

See `docs/project-report.md`.
