# FixLocal — Project Report

Application Development Lab (BSCS4010)  
May 2026 Term

| | |
| --- | --- |
| Name | Akash Kumar |
| Student email | 22f2000946@ds.study.iitm.ac.in |
| Roll number | 22f2000946 |
| Project name | FixLocal |

---

## 1. What this project is

FixLocal is a simple web app for home repairs.

If a tap is leaking or a fan is not working, people usually message someone on WhatsApp. There is no clear job details, no photo, and no record of the price. FixLocal tries to make this a bit more organised.

A homeowner posts a job. A tradesperson (plumber, electrician, etc.) can bid on that job after admin verifies them. The homeowner picks one bid. The job then moves from awarded to in progress to completed. If there is a problem, a dispute can be opened and admin can look at it.

I built this as a full stack local app. Backend and frontend are separate, as the course asked.

## 2. Who uses it

There are three roles.

**Admin**

- Cannot register from the website. The account is created by the seed script.
- Verifies tradespeople so they can bid.
- Can suspend a tradesperson.
- Can see some simple stats (users, open jobs, pending verifications, disputes).
- Can resolve disputes.
- Can force-cancel a job if needed.

**Homeowner**

- Can register and login.
- Can post a job with title, description, category, area, dates, and an optional photo.
- Can see bids on their own jobs and accept one bid.
- Can mark a job as completed.
- Can open a dispute.

**Tradesperson**

- Can register and login.
- Can fill a profile (skills, service areas).
- Can browse open jobs and search / filter them.
- Can bid only after admin verifies them.
- Can start work and mark it completed on a job that was awarded to them.

Each role has a different home page after login. A user cannot open another role’s pages.

## 3. Main features

### Login and access

- Register as homeowner or tradesperson.
- Login with email and password.
- Passwords are stored using hashing (bcrypt).
- After login, the app uses a JWT token.
- Backend checks the token and the role on protected APIs. This is not only done in the frontend.

### Jobs

Job is the main thing in this project. A homeowner owns the job.

A job has:

- title and description
- category (plumbing, electrical, carpentry, painting, appliance, other)
- preferred dates
- budget range (optional)
- area / address
- photo (optional)
- status (open, awarded, in progress, completed, cancelled, disputed)

The homeowner can edit or cancel a job only while it is still open.

### Bidding

- Only a verified tradesperson can bid.
- One tradesperson can place only one bid on one job.
- There is a max bids limit on the job.
- Other tradespeople cannot see competing bid amounts until the job is awarded.
- Homeowner accepts one bid. Other bids are rejected.
- Tradesperson can withdraw a bid while the job is still open.

### After a bid is accepted

- Job status becomes awarded.
- Payment status is set to `simulated_paid`. This is only a flag for the demo. There is no real payment.
- Tradesperson can start work (in progress) and then mark completed.
- Homeowner can also mark completed.

### Disputes

- Homeowner or tradesperson can open a dispute on an awarded / in progress / completed job.
- Admin can resolve it (favour homeowner, favour tradesperson, or no action) and add a note.

### Search and filter

On the jobs list, users can:

- search by keyword
- filter by category
- filter by date
- sort
- use pages (pagination)

Homeowners see their own jobs. Tradespeople see open jobs (or their own awarded work).

## 4. Tech stack

I used the stack given in the course.

| Part | What I used | Why |
| --- | --- | --- |
| Backend | Node.js + Express | To make REST APIs |
| Database | PostgreSQL | To store users, jobs, bids, disputes |
| ORM | TypeORM | Tables are created from entity files. I did not make tables by hand in pgAdmin. |
| Auth | JWT + bcrypt | Login token and hashed passwords |
| Frontend | React (Vite) | Separate UI that calls my APIs |
| File upload | multer | Job photos saved in an uploads folder |
| Cache | Redis (optional) | Cache for open jobs list. If Redis is down, the app still works. |

Backend folder and frontend folder are separate.

## 5. Database

Main tables / entities:

1. **User** — email, hashed password, role
2. **TradespersonProfile** — one profile per tradesperson (skills, verification status)
3. **Job** — posted by a homeowner
4. **Bid** — a tradesperson bidding on a job
5. **Dispute** — linked to a job

Simple relations:

- One user (homeowner) can have many jobs.
- One job can have many bids.
- One tradesperson has one profile.
- One job can have one dispute.

TypeORM creates this when the backend starts (`synchronize` in development).

## 6. How the folders are arranged

```
fixlocal/
  backend/     Express API, TypeORM entities, routes, controllers
  frontend/    React pages for admin, homeowner, tradesperson
  docs/        this report
```

Backend has:

- `entities` — database models
- `routes` — API paths
- `controllers` — the logic
- `middleware` — auth, role check, file upload

Frontend has separate pages for each role. Protected routes send the user away if they are not logged in or if they have the wrong role.

## 7. Extra features

These are extra, not the basic requirement:

- Admin must verify a tradesperson before they can bid.
- Bid amounts are hidden from other tradespeople until award.
- Redis cache for the open jobs list (optional).
- Simulated payment flag when a bid is accepted.

## 8. How to run (short)

1. Start PostgreSQL and create database `fixlocal`.
2. In `backend`: copy `.env.example` to `.env`, then `npm install`, `npm run seed`, `npm run dev`.
3. In `frontend`: copy `.env.example` to `.env`, then `npm install`, `npm run dev`.
4. Open http://localhost:5173

Demo password: `Password123!`

- admin@fixlocal.local
- home@fixlocal.local
- pro@fixlocal.local

More detail is in the README.

## 9. What works and what does not

What works:

- Register / login for homeowner and tradesperson
- Admin verify
- Post job with photo
- Bid, accept, complete
- Search and filter
- Dispute
- Redis optional cache
- App runs on local machine

What I did not do:

- Real payment (Razorpay etc.) — only a simulated flag
- Email / SMS notifications
- Mobile app
- Deploy to a public server (course said local demo)

The UI is simple CSS. I focused more on the backend rules (who can do what) than on making it look fancy.

## 10. GitHub

Code is in the GitHub repo linked in the submission form.
