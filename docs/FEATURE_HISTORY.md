# FixLocal feature history

The per-wave development log from the original project README, kept for reference. It describes features as they were built during the course; the current setup, security model and tests are documented in the main [README](../README.md).

> Some notes below describe behaviour that has since changed (for example tokens in `localStorage`, TypeORM `synchronize`, and templates stored in the browser). See the README for how things work now.

## Suggested walkthrough (wave 10)

1. Log in as **admin** → Overview · Users · Verify · **Audit** (empty until you act).
2. Log in as **client** (`home@`) → Post a job (photos are compressed in-browser) or open an open job.
3. Log in as **pro** (`pro@`) → Browse with **area / budget** filters (optionally **Save search**) → Place a bid with an optional **visit window**.
4. Client → Accept bid → payment status becomes **held** with Deposit / Progress / Completion milestones.
5. Check the pro’s public profile **weekly availability**; propose a visit and note any soft conflict hint.
6. Professional → Start work → Mark done; client can **Release milestones** in order, or **Complete** the job to **auto-release** remaining escrow.
7. On escrow panel → **Print / Download** a milestone summary (HTML, print-to-PDF friendly).
8. **Settings** → toggle notification categories (stored on the user + localStorage).
9. Admin → Suspend a user or resolve a dispute → confirm entry on **Audit**.
10. Pro/homeowner → on an awarded job, upload **before/after** completion photos (shown on job detail).
11. Admin → open a dispute → select escrow milestones to **refund/reverse** when resolving.
12. Pro → **Analytics** — win rate, avg rating, earnings over last 6 months.
13. Pro → Portfolio → add a second daily slot and **blocked dates**; visit proposals show conflict hints.
14. Browser → installable via **PWA** (manifest + light service worker).
15. On an awarded job → **Messages** → attach an image/PDF with the paperclip.
16. Pro → **Analytics** → category mix + response cards.
17. Homeowner → open job → click a suggested **match score** for sk/rt/rs/ds explainability; check **Invite analytics** after inviting.
18. Pro → Portfolio → set **Not interested categories**; confirm soft-skip on suggestions.
19. Homeowner → save an **invite template** (or sync from Settings); print escrow invoice to PDF.
17. Homeowner → favorite a pro → pro updates availability (or admin verifies) → check notification bell.
18. Pro browse → filter by **City** + **Neighborhood** (e.g. Bengaluru · Indiranagar).

19. Pro browse → sort **Nearest** — cards show ~km from your portfolio coords.
20. Homeowner → Find pros → **Nearest** — distance badges from Bengaluru demo centre.
21. Pro → place bid with **quote notes** (and optional PDF) → homeowner bid compare shows quote card.
22. On awarded/open chat → pro sends a **structured quote** via the quote icon.
23. Watch notification bell / chat for **live** badge (SSE); disable network briefly to confirm polling fallback.
24. Admin → **Match** — open jobs vs nearby verified pros bands (none / thin / ok / strong).



25. Homeowner → Post a job → **Budget & location** → drag/click the **map pin** (Leaflet); coords save with the job.
26. Admin → **Match** — see **best score** + top pros with sk/rt/rs/ds breakdown (skills · rating · response · distance).
27. Homeowner → open job → **Suggested pros** cards with match scores.
28. Pro places a bid with a **structured quote** different from bid amount → homeowner **Accept quote → escrow**; escrow holds the **quote** amount (simulated).

29. Homeowner → open job → **Suggested pros** → **Invite** (optional message) → pro notification bell shows **Job invite**.
30. After visit is **confirmed** → **Add to calendar** downloads an `.ics` file.
31. Escrow panel shows **From quote** / **From bid** source badge after accept.


32. Homeowner → invite same pro again → server returns **Already invited** (409).
33. Pro → open invite from notification bell → lands on job **bid form** (`?invite=1#bid-form`) → optionally **Decline invite** (soft notify homeowner).
34. Confirmed visit → **Download .ics** (Asia/Kolkata TZ) · **Google Calendar** · **Outlook** links.
35. Escrow **Print** summary shows **Escrow source** (quote/bid).
36. Admin → **Audit** → add an optional **admin note**.
37. Homeowner → Find pros → open a verified profile → **Invite to job** (pick an open job).


### Features (wave 1)

- Full UI redesign (Tailwind design system, landing, auth, role dashboards)
- Job post with photos, categories, budget, location, filters/search
- Bid place/withdraw/accept with enriched pro cards
- Status timeline (open → awarded → in progress → completed)
- Ratings & reviews after completion
- Rich tradesperson portfolio (bio, skills, rates, city, experience)
- In-job messaging
- In-app notifications (bids, accept/reject, status, disputes, messages, reviews)
- Favorites (jobs & pros)
- Public pro profile pages
- Profile/settings
- Richer seed data
- Toasts, empty/loading states, basic a11y

### Features (wave 2)

- Portfolio **image gallery** uploads (multer) + display on public pro profile
- Dispute **evidence attachments** + clearer admin resolution (notes, job status override, notify parties)
- Admin **user management** (list/search homeowners & pros, suspend/unsuspend)
- Richer admin **stats** (jobs by status, active bids, reviews, simulated GMV)
- Reliable **polling** for chat (~3s) and notification bell (~4s open / ~15s background)
- **Post-job wizard** with local draft autosave
- Pro **earnings / completed-jobs** summary on My jobs
- Homeowner bids empty state polish + Find pros CTA
- Account suspension enforced at login

### Features (wave 3)

- **Simulated escrow / payment milestones** — on bid accept, funds are **held**; Deposit → Progress → Completion releases (sequential); clear payment status for both sides
- **Pro availability / scheduling** — propose visit windows on bids or after award; homeowner/pro accept or counter; shown on job detail timeline
- **Search polish** — job facets (category, area/city, budget range); pro facets (category/skill, city, rating min, max hourly rate); optional **saved searches** (localStorage)
- **Client-side image compression** before job/gallery upload (canvas, no heavy deps)
- **Admin audit log** for suspend/unsuspend, dispute resolve, force-cancel, verify actions
- Legacy awarded jobs auto-create escrow milestones on first view

### Features (wave 4)

- **Auto-release remaining escrow** when the homeowner (or admin) marks a job **completed**
- **Mobile polish** — sticky bottom nav, larger touch targets, notification panel + escrow cards that stack cleanly on small screens
- **Pro weekly availability calendar** on portfolio + public profile, with soft **conflict hints** vs proposed visit times
- **Milestone invoice-ish summary** — printable HTML / downloadable escrow summary (no heavy PDF deps)
- **Notification preferences** in Settings (User `notificationPrefs` + localStorage); createNotification respects toggles
- Empty-state CTAs tightened (Saved, admin jobs, etc.)

### Features (wave 5)

- **Before/after completion photos** on jobs (upload when completing or after; gallery on job detail for both parties)
- **Dispute partial refunds / milestone reverse** (simulated) — admin can refund selected escrow milestones when resolving
- **PWA basics** — web manifest + service worker for an installable feel (light offline shell)
- **Pro analytics dashboard** — jobs won, win rate, avg rating, earnings over time from existing bid/job data
- **Harder availability** — multi-slot day editing + optional **blocked dates** with schedule conflict hints
- Seed/builds kept green; README walkthrough updated

### Features (wave 6)

- **Chat attachments** — image/PDF uploads on job messages (multer), shown inline in chat
- **Richer pro analytics** — category mix, avg/median response-ish hours (job post → bid), 30-day bid activity, clearer cards/charts
- **Favorite-pro alerts** — in-app notifications when a saved pro updates availability or is verified; match tips when posting a job that fits a favorited pro (and similar-job nudges)
- **Area search polish** — separate **city** + **neighborhood** facets on job browse / find-pros; soft city-match ranking; optional `lat`/`lng` on jobs & profiles (no geo libs)
- Job create wizard defaults city to Bengaluru; seed jobs tagged with city + coords
- README + smoke notes refreshed

### Features (wave 7)

- **SSE live updates** — notification bell + job chat use `EventSource` (`/api/notifications/stream`, `/api/messages/:jobId/stream`) with JWT via `?token=`; automatic **polling fallback** if SSE fails
- **Haversine ranking** — `nearLat` / `nearLng` / `maxKm` + `sort=distance` on job browse and find-pros; cards show approximate **km** when coords exist
- **Structured quotes** — pros attach quote amount + notes + optional PDF/image on a **bid** or in **chat**; homeowners see a clear quote block on bid compare
- **Admin match-quality lite** — `/admin/match` (and overview teaser): open jobs vs nearby verified pros (same city or ≤25 km)
- `npm run wave7:smoke` API smoke for SSE / distance / quote / match-quality


### Features (wave 8)

- **Richer match scoring** — verified pros scored vs a job (skills∩category, rating, response time, distance); admin Match page shows best score + top pros; homeowners see **Suggested pros** on open job detail
- **Map pin picker** — Leaflet map on job create (click/drag pin); stores `lat`/`lng` (no PostGIS)
- **Accept quote → escrow** — when a bid has `quoteAmount`, simulated escrow prefers the quote; clearer confirm/toast copy
- **Frontend bundle split** — `React.lazy` + `Suspense` per route to shrink the main chunk
- `npm run wave8:smoke` API smoke for scores / coords / suggested-pros / quote→escrow

### Features (wave 9)

- **Invite suggested pro** — from open job detail; in-app `match` notification + optional message (`POST /api/jobs/:id/invite-pro`)
- **ICS export** — **Add to calendar** on confirmed visit schedule (client `.ics` download)
- **Escrow source** — `job.escrowSource` (`quote` | `bid`) stored on accept; shown on PaymentPanel + payments API
- Soft UX polish (invite composer, escrow source copy, match prefs hint)
- `npm run wave9:smoke` API smoke for invite / escrowSource / confirmed schedule → ICS shape


### Features (wave 10)

- **Invite guards** — server-side **already invited** (409), per-job invite cap, soft **cooldown** after decline
- **Decline invite** — pros can soft-decline; homeowner gets an in-app match notification
- **Invite deep-link** — notification opens `/tradesperson/jobs/:id?invite=1#bid-form` with banner + bid form scroll
- **Calendar links** — Google + Outlook deeplinks; ICS uses **Asia/Kolkata** `VTIMEZONE` / `TZID`
- **Escrow source on invoice** — printable/downloadable milestone summary shows quote vs bid source
- **Admin audit notes** — optional freeform notes on Audit (`POST /api/admin/audit-notes`)
- **Invite from Find Pros profile** — homeowners invite a verified pro to an open job from the public profile page
- `npm run wave10:smoke` API smoke for invite guards / decline / deep-link / admin note / ICS TZ

### Features (wave 11)

- **Invite history** on homeowner job detail — who was invited, by whom, when, pending vs declined, optional decline reason/note
- **Cooldown countdown UI** after a pro declines (1h soft cooldown from `declinedAt`)
- **Decline reason chips** — Busy / Schedule conflict / Too far / Rate mismatch / Not my specialty / Other (+ optional note)
- **Stronger invoice** — parties (homeowner + pro), escrow source, recent job-scoped audit note snippets
- **Bulk invite** — select multiple suggested pros, one shared message + confirm; server `POST /api/jobs/:id/invite-pros` is rate-limit aware
- `GET /api/jobs/:id/invites` for invite history + quota
- Bugfix: invite cooldown now keyed off `declinedAt` (not original invite `createdAt`)
- `npm run wave11:smoke` API smoke for history / bulk / decline chips / invoice parties+audit







### Features (wave 24)

- **Invite + pro counter-template create/edit in Settings** — same pattern as homeowner notes: add / edit / remove chips beyond defaults + Sync to User (`inviteTemplates`, `counterTemplates`)
- **Named best-value blend presets** — Match-heavy (70/30) · Price-heavy (30/70) · Balanced + SLA (50/35/15) on Admin → Match; audited like manual blend saves
- **Live blend preview** — Admin → Match previews the current (or draft) blend against a sample of open jobs with competing bids (top ranked bids via `GET /api/admin/best-value-blend/preview`)
- Soft polish on Settings/Match copy; `npm run wave24:smoke` API smoke for template upsert / blend presets / live preview

### Features (wave 23)

- **Custom homeowner note create/edit in Settings** — add / edit / remove counter-note chips beyond defaults + Sync to User (`homeownerCounterTemplates`)
- **Admin audit on `best_value_blend`** — dedicated `best_value_blend_update` audit rows with before/after snapshots; **Rollback blend** on Admin → Audit (`POST /api/admin/best-value-blend/rollback`)
- **Optional third blend weight** — fold **response SLA + availability heat** into best-value (`slaHeatPct`; 0 = off); Admin → Match toggle / weight; why-value drawer shows `sh` bar
- Soft polish on bid compare + Match admin copy; `npm run wave23:smoke` API smoke for note upsert path / blend audit+rollback / slaHeatPct / listBids blend

### Features (wave 22)

- **Homeowner counter-note templates on User** — request-revise chips sync like invite/pro templates (`homeownerCounterTemplates` on Settings + `/api/auth/me`)
- **Admin-tunable best-value blend** — `best_value_blend` AppConfig (match % vs lower-hold %); Admin → Match; returned on `GET .../bids` as `bestValueBlend`
- **Why best value drawer** — per-bid explain (matchNorm · priceNorm · weights) + optional **per-bid counter sparkline**
- **Availability-first match preset** — fourth preset with **heatWeight 20** (skills 20 / rating 15 / response 30 / distance 35)
- **Soft peer counter amount hint** — from clean peer best-value holds on request-revise
- Soft polish; `npm run wave22:smoke` API smoke for templates / blend / availability preset / listBids blend

### Features (wave 21)

- **Heat weight in match presets + audit rollback** — Balanced / Speed / Quality presets each bake a `heatWeight` (10 / 15 / 8); applying a preset sets heat; audit `before`/`after` snapshots include heat; rollback restores weights **and** heat when the snapshot is clean
- **Admin Match table heatBoost** — match-quality top pros show `heatBoost` / `rankedScore` (and heat badge in Admin → Match)
- **Best value bid blend** — homeowner bid compare blends match/ranked score (55%) with lower simulated escrow hold (45%); “Best value” cards + badge when ≥2 competing bids look clean
- **Counter negotiation timeline / sparkline** — job detail plots suggested counter amounts over time across bids
- **Homeowner counter-note templates** — request-revise chips (budget tight / smaller scope / flexible timing / meet in middle) fill notes cleanly (defaults only, no new schema)
- Soft polish on match/audit copy; `npm run wave21:smoke` API smoke for presets+heat rollback / match-quality heatBoost / bid matchScore / counter timeline

### Features (wave 20)

- **Inline escrow what-if on bid compare** — Deposit / Progress / Completion panel on each bid (not only accept confirm); optional try-₹ amount; **side-by-side** cards when ≥2 competing active bids look clean
- **Admin-tunable heat weight** — `match_heat_weight` in AppConfig (default **10**, max 20); Admin → Match slider; suggested-pros `heatBoost` / `rankedScore` / `heatWeight` respect it
- **Per-job counter analytics** — `GET /api/bids/counter-analytics?jobId=` cards on homeowner job detail (sent / addressed / declined / avg address time)
- **Counter template chips on decline** — pro declines homeowner counter via chip UI (busy / materials / floor / freeform); no `window.prompt`
- Soft polish on bid compare copy; `npm run wave20:smoke` API smoke for heat weight / what-if compare / per-job analytics / decline templates

### Features (wave 19)

- **Counter accept/reject analytics + time-to-address SLA** — `GET /api/bids/counter-analytics` (also `/api/jobs/counter-analytics`, `/api/profile/counter-analytics`): sent / addressed / declined rates, avg/median hours to address or decline, after-address accept vs reject; homeowner dashboard + pro Analytics cards
- **Heat-aware suggested-pros ranking** — `GET /api/jobs/:id/suggested-pros` adds `availabilityHeat`, `heatBoost` (0–N via admin heat weight), `rankedScore`; sorts by ranked score
- **Escrow “what-if” calculator** — `GET|POST /api/bids/:id/escrow-what-if?amount=` previews Deposit / Progress / Completion split before accept; confirm dialog shows the split
- **Pro counter templates** — busy / materials / won’t-go-below-X starters; Settings sync to User `counterTemplates`; decline-counter uses template chips (wave 20; no browser prompt)
- **Configurable nudge hours** — User `quoteViewNudgeHours` (1–168) in Settings; viewed-no-reply uses per-pro preference (else env/`4`)
- `npm run wave19:smoke` API smoke for analytics / heat rank / what-if / templates / nudge hours

### Features (wave 18)

- **Counter-offer history + decline** — prior counters archived on replace; pro can `POST /api/bids/:id/counter-offer/decline`; homeowner **suggested −10% / −15% / −20%** presets on request-revise
- **Find Pros heat sort** — `sort=heat` on `GET /api/profile/browse` (clean + higher score first)
- **Shortlist invite heat gate** — when availability heat is **clean**, invite-from-shortlist requires heat ≥ N (default **25**); unclean schedules are not blocked
- **Viewed but no reply** — soft in-app flag + one-shot nudge after quote-viewed with no revise for `QUOTE_VIEW_NUDGE_HOURS` (default **4**); `POST /api/bids/:id/viewed-no-reply`
- **Soft escrow hold preview** — accepting after an **addressed** counter with a different final amount returns `escrow.softHoldPreview` (simulated payments only)
- `npm run wave18:smoke` API smoke for history / decline / heat sort / shortlist gate / nudge / escrow preview

### Features (wave 17)

- **Quote-Δ deep-link** — revise notify opens `/homeowner/jobs/:id?bid=:bidId#bid-:bidId` and highlights the bid card
- **Homeowner counter-offer / request revise** — suggest amount + notes on open bids (`POST /api/bids/:id/counter-offer`); pro notified with deep-link; revising the quote marks the counter **addressed**
- **Find Pros min heat** — filter by availability heat score (`minHeat` / `minAvailabilityScore` on `GET /api/profile/browse`)
- Soft **pro alert when homeowner views a revised quote** (`POST /api/bids/:id/quote-viewed`, deduped per revision)
- Soft polish on empty Find Pros copy; `npm run wave17:smoke` API smoke for deep-link / counter / minHeat / quote-viewed

### Features (wave 16)

- **Quote revision diff UI** — amount Δ (+/−) and notes before→after on homeowner bid compare; pro sees latest Δ
- **Quote revise notify with delta** — homeowner alert includes amount/notes change summary (`meta.amountDelta`, `notesChanged`)
- **Shortlist invite funnel** — rank → invite → bid analytics on job detail + homeowner dashboard (`GET /api/jobs/:id/shortlist-invite-analytics`, aggregate `/api/jobs/shortlist-invite-analytics`)
- **Invite source tagging** — shortlist invites store `source` + `shortlistRank` (+ smartScore) for funnel accuracy
- **Availability calendar heat** — 7-day heat strip on Find Pros cards from `weeklyAvailability`
- Soft **best time to invite** hint when weekly schedule is clean
- `npm run wave16:smoke` API smoke for quote Δ notify / shortlist funnel / browse heat+hint

### Features (wave 15)


- **Shortlist smart rank** — when inviting from shortlist on an open job, pros are ranked by live match score + tag boost vs the job category (`GET /api/jobs/:id/shortlist-ranked`)
- **Quote revision history** — pros can revise structured quotes on active bids; prior amounts/notes are stored and shown on homeowner bid compare (`PATCH /api/bids/:id/quote`)
- **Find Pros “available this week”** — combo filter with response SLA using `weeklyAvailability` / `blockedDates`
- **SLA sparkline** — simple CSS/SVG bar+line trend on pro Analytics (plus weekly spark buckets from the API)
- **Match preset rollback** — Admin Audit can restore a clean `before` snapshot from a `match_weights_update` row (`POST /api/admin/match-weights/rollback`)
- `npm run wave15:smoke` API smoke for rank / quote history / avail+SLA / sparkline / rollback

### Features (wave 14)

- **SLA trends (7 / 30 days)** on pro Analytics; clean trends also shown on homeowner bid compare
- **Shortlist notes & tags** on Favorites; **bulk invite from shortlist** on open job detail (and Favorites deep-link)
- **Match weight presets** — Balanced / Speed-biased / Quality-biased on Admin → Match; **audit log** on every weight change
- **Find Pros** filter by response SLA tier or max response hours (with SLA badges on results)
- Soft **shortlist SLA-improve** notify when a saved pro’s reply tier gets faster (deduped 7d)
- `npm run wave14:smoke` API smoke for trends / notes-tags / presets+audit / SLA browse / shortlist bulk


### Features (wave 13)

- **Response SLA badges** — invite→bid (preferred) and/or job→bid latency on bid cards, public pro profiles, suggested pros, and pro analytics (`lightning` / `fast` / `same_day` / `steady` / `slow`)
- **Homeowner shortlist** — saved pros (favorites) as a cross-job shortlist; **Invite from shortlist** on open job detail
- **Admin-tunable match weights** — persist sk/rt/rs/ds JSON in `app_configs` (default **35 / 25 / 20 / 20**); editable on Admin → Match
- Soft polish: Match score drawer respects live weights; analytics SLA chip
- `npm run wave13:smoke` API smoke for SLA / shortlist / match weights


### Features (wave 12)

- **Invite analytics** for homeowners — per-job + aggregate: invites sent, declined, opened/clicked (deep-link / notification read), bid-after-invite rates
- **Match score explainability** — click a suggested pro’s score to open a drawer with **sk / rt / rs / ds** bars and hints
- **Invite templates / saved messages** — localStorage starters + job/user saves; Settings sync to User `inviteTemplates`
- **Stronger printable invoice** — print-CSS polish (A4, color-adjust, parties, dark totals, status pills); print-to-PDF HTML (no jsPDF)
- **Pro not-interested categories** — soft-skip those categories from suggested pros (direct invite still allowed)
- Invite history badges for opened / bid-after
- `npm run wave12:smoke` API smoke for analytics / open tracking / soft-skip / templates / score breakdown


### Project layout

```
fixlocal/
  backend/     Express + TypeORM API
  frontend/    React + Vite app
  docs/        Project report
```

### Notes

- Redis: `brew services start redis` and keep `REDIS_URL` in `backend/.env`. If Redis is down, the API still works.
- Admin cannot self-register; use the seed account.
- Do not commit secrets; `.env` is local.
- Uploads are stored under `backend/uploads/` and served at `/uploads/...`.

### Wave 25 — marketplace pivot (Client / Professional + categories)
- User-facing copy: **Client** / **Professional** (internal roles unchanged)
- Landing rewritten for general work marketplace (not home-repairs-only)
- Categories expanded: cleaning, construction, office & facilities, tech services, moving (+ existing home-repair specialties)
- Demo account labels + seed jobs for new lead categories
- `npm run wave25:smoke` — categories API + copy smoke


### Wave 26 — marketplace IA (Client / Professional routes)
- Route aliases: **`/client/*`** + **`/professional/*`** dual-mounted with legacy `/homeowner` / `/tradesperson`
- Post-job UX: lead-group chips → specialty chips; optional **residential / office** site tag
- Register role explainers: “I post work” (Client) / “I bid on work” (Professional)
- Pro portfolio skills as specialty checkboxes (plus freeform extras)
- Landing category deep-links → filtered Find Pros / Browse jobs (`?category=`)
- Copy audit: UI keeps Client/Professional; internal keys stay HOMEOWNER/TRADESPERSON
- `npm run wave26:smoke` — siteType API + route/IA smoke


### Wave 27 — IA / product (no scoring/match math)
- **Site-type filter chips** on Browse jobs + Find professionals (residential / office; API soft filter for pros)
- **Job templates per lead group** on post-job (prefill title / description / specialty / site)
- **Guided Client / Professional onboarding checklist** (dismissible, localStorage)
- **Soft package / rate cards** on professional portfolio + public profile (visit / half-day / full-day from hourly range)
- **Service-area multi-select chips** for professionals (Bengaluru neighborhoods + freeform)
- `npm run wave27:smoke` — siteType browse/find + IA source smoke


### Wave 28 — IA / product (no scoring/match math)
- **Editable custom rate packages** on professional portfolio (beyond soft hourly estimates) + public profile
- **Lead-group hub pages** from landing (`/categories/:groupSlug`) with specialties + Client/Professional CTAs
- **Client visit-prep cards** on scheduled/confirmed jobs (soft checklist, localStorage)
- **Pro intro / first-message templates** in empty job chat + Settings sync (`introTemplates`)
- Soft polish: empty-state playbooks; **a11y** `aria-pressed` / `role="group"` on site + service-area chips
- `npm run wave28:smoke` — custom packages API + hub route + introTemplates + IA source smoke


### Wave 29 — IA / product (no scoring/match math)
- **Past-work case-study cards** on professional portfolio + public profile (before/after URLs + notes; gallery quick-pick)
- **Pro visit-day checklist** on awarded/scheduled jobs (mirrors client VisitPrepCard; localStorage)
- **Soft job cadence** on post-job: one-time / weekly / monthly / AMC (+ optional note; store only, no full recurring engine)
- Soft polish: cadence badges/notes on client + professional job detail
- `npm run wave29:smoke` — caseStudies API + cadence create/patch + IA source smoke


### Wave 30 — IA / product (no scoring/match math)
- **Client “Repeat this job”** from completed jobs — prefills post-job wizard (title/category/siteType/cadence + location/budget soft copy); banner on create wizard; also on client dashboard cards
- **Case-study one-click publish** — awarded professional publishes before/after completion photos to portfolio (`POST /api/jobs/:id/publish-case-study`)
- **Soft AMC / recurring proposal card** on awarded jobs — pro proposes package + cadence; client accept / decline / counter reply (`POST .../amc-proposal`, `.../reply`); store only, no billing engine
- Soft polish: Client/Professional copy; dashboard repeat affordance
- `npm run wave30:smoke` — AMC propose/reply + publish-case-study + IA source smoke

### Wave 31 — IA / product (no scoring/match math)
- **AMC proposal pick-from portfolio rate packages** — one-click fill package name + amounts from custom / soft rate cards on the professional AMC form
- **Named client job templates library** — save completed jobs by name (beyond one-shot repeat); apply on post-job; User sync + Settings
- **Soft next-visit reminder / calendar hint** when AMC accepted — suggested date from cadence + `.ics` / Google Calendar (tentative; no schedule write)
- **Case-study photo pair picker** when multiple before/after photos exist — choose which URLs to publish
- Soft polish: Client/Professional copy; `npm run wave31:smoke` — rate-package fill IA + named templates API + AMC accept ICS + pair picker + source smoke

### Wave 32 — IA / product (no scoring/match math)
- **Client-initiated “Request AMC” card** — inverse of pro propose on awarded jobs (`POST /api/jobs/:id/amc-request` + pro `.../amc-request/reply` accept/decline/counter); soft only, no billing engine
- **One-click portfolio package → bid quote fill** — professional bid form fills amount + structured quote from custom / soft rate packages
- **Named-template search / filter by specialty** on post-job (library chips + All / specialty filters)
- Soft polish: **case-study draft** autosave (title/notes localStorage) + **multi-event ICS stub** when AMC accepted and a visit is scheduled
- Soft polish: Client/Professional copy; `npm run wave32:smoke` — AMC request/reply + bid package fill IA + named-template filter + multi-ICS + source smoke








- Escrow is entirely simulated for demos/labs.
- PWA: `frontend/public/manifest.webmanifest` + `sw.js`. Dev SW may need a hard refresh after updates.

See also `docs/project-report.md`.
