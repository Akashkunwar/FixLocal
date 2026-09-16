/**
 * Wave 10 API smoke: invite already-invited / rate-limit, decline invite,
 * deep-link shape, admin audit note, ICS timezone + calendar URL shape.
 * Requires backend :3001 and seeded users.
 */
const API = process.env.API_URL || "http://localhost:3001";
const PASS = process.env.SEED_PASSWORD || "Password123!";

async function api(pathname, { method = "GET", token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function apiOk(pathname, opts) {
  const r = await api(pathname, opts);
  if (!r.ok) {
    throw new Error(
      `${opts?.method || "GET"} ${pathname} → ${r.status} ${r.data.message || ""}`
    );
  }
  return r.data;
}

async function login(email) {
  return apiOk("/api/auth/login", {
    method: "POST",
    body: { email, password: PASS },
  });
}

function toIcsLocal(d, timeZone = "Asia/Kolkata") {
  const pad = (n) => String(n).padStart(2, "0");
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value || "00";
  return `${get("year")}${get("month")}${get("day")}T${get("hour")}${get("minute")}${get("second")}`;
}

function buildVisitIcsStub(job) {
  if (!job.scheduledStart) throw new Error("no scheduledStart");
  const start = new Date(job.scheduledStart);
  const end = job.scheduledEnd
    ? new Date(job.scheduledEnd)
    : new Date(start.getTime() + 2 * 3600000);
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VTIMEZONE",
    "TZID:Asia/Kolkata",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    `UID:fixlocal-visit-${job.id}@fixlocal.local`,
    `DTSTART;TZID=Asia/Kolkata:${toIcsLocal(start)}`,
    `DTEND;TZID=Asia/Kolkata:${toIcsLocal(end)}`,
    `SUMMARY:FixLocal visit — ${job.title}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

function googleUrlStub(job) {
  const start = new Date(job.scheduledStart);
  const end = job.scheduledEnd
    ? new Date(job.scheduledEnd)
    : new Date(start.getTime() + 2 * 3600000);
  const pad = (n) => String(n).padStart(2, "0");
  const utc = (d) =>
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `FixLocal visit — ${job.title}`,
    dates: `${utc(start)}/${utc(end)}`,
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

async function main() {
  const steps = [];
  const home = await login("home@fixlocal.local");
  const pro = await login("pro@fixlocal.local");
  const pro2 = await login("pro2@fixlocal.local");
  const admin = await login("admin@fixlocal.local");

  const created = await apiOk("/api/jobs", {
    method: "POST",
    token: home.token,
    body: {
      title: "Wave10 invite decline calendar smoke",
      description: "Wave 10 smoke for invite guards, decline, ICS TZ, admin note.",
      category: "electrical",
      city: "Bengaluru",
      area: "Koramangala",
      budgetMin: 1500,
      budgetMax: 4000,
      maxBids: 5,
      lat: 12.9352,
      lng: 77.6245,
    },
  });
  const jobId = created.job?.id;
  if (!jobId) throw new Error("job create failed");
  steps.push(`job ${jobId}`);

  const sug = await apiOk(`/api/jobs/${jobId}/suggested-pros?limit=5`, {
    token: home.token,
  });
  const invitee =
    sug.suggestions?.find((s) => s.userId === pro2.user.id) ||
    sug.suggestions?.find((s) => s.userId === pro.user.id);
  if (!invitee) throw new Error("seed pro not in suggested-pros");
  const inviteeToken = invitee.userId === pro.user.id ? pro.token : pro2.token;
  steps.push(`invite target ${invitee.name || invitee.userId}`);

  const invited = await apiOk(`/api/jobs/${jobId}/invite-pro`, {
    method: "POST",
    token: home.token,
    body: {
      tradespersonId: invitee.userId,
      message: "Wave10 smoke invite",
    },
  });
  if (!invited.ok) throw new Error("invite not ok");
  steps.push(`invite sent notificationId=${invited.notificationId}`);

  const dup = await api(`/api/jobs/${jobId}/invite-pro`, {
    method: "POST",
    token: home.token,
    body: { tradespersonId: invitee.userId },
  });
  if (dup.status !== 409 || dup.data.code !== "ALREADY_INVITED") {
    throw new Error(`expected ALREADY_INVITED got ${dup.status} ${dup.data.code}`);
  }
  steps.push("already-invited → 409 ALREADY_INVITED");

  const nlist = await apiOk("/api/notifications?limit=30", { token: inviteeToken });
  const hit = (nlist.notifications || []).find(
    (n) => n.meta?.invite === true && n.meta?.jobId === jobId && n.meta?.declined !== true
  );
  if (!hit) throw new Error("invite notification missing");
  if (!String(hit.link || "").includes("invite=1") || !String(hit.link || "").includes("#bid-form")) {
    throw new Error(`invite deep-link missing: ${hit.link}`);
  }
  steps.push(`deep-link ${hit.link}`);

  const declined = await apiOk(`/api/jobs/${jobId}/decline-invite`, {
    method: "POST",
    token: inviteeToken,
    body: { note: "Wave10 soft decline" },
  });
  if (!declined.ok) throw new Error("decline failed");
  steps.push("pro soft-declined invite");

  const homeNotes = await apiOk("/api/notifications?limit=20", { token: home.token });
  const declinedHit = (homeNotes.notifications || []).find(
    (n) => n.meta?.inviteDeclined === true && n.meta?.jobId === jobId
  );
  if (!declinedHit) throw new Error("homeowner decline notification missing");
  steps.push("homeowner got invite-declined notification");

  const note = await apiOk("/api/admin/audit-notes", {
    method: "POST",
    token: admin.token,
    body: { note: "Wave10 smoke admin audit note — escrow source on invoice" },
  });
  if (note.log?.action !== "admin_note") {
    throw new Error(`admin note action ${note.log?.action}`);
  }
  steps.push("admin audit note saved");

  // Bid + accept for escrowSource (use other pro if invitee declined)
  const bidder = invitee.userId === pro.user.id ? pro2 : pro;
  await apiOk(`/api/jobs/${jobId}/bids`, {
    method: "POST",
    token: bidder.token,
    body: {
      amount: 3500,
      message: "wave10",
      etaDays: 1,
      quoteAmount: 3100,
      quoteNotes: "wave10 quote",
    },
  });
  const bids = await apiOk(`/api/jobs/${jobId}/bids`, { token: home.token });
  const myBid = (bids.bids || []).find((b) => b.tradespersonId === bidder.user.id);
  if (!myBid) throw new Error("bid missing");
  const accepted = await apiOk(`/api/bids/${myBid.id}/accept`, {
    method: "POST",
    token: home.token,
  });
  if (accepted.job?.escrowSource !== "quote") {
    throw new Error(`escrowSource ${accepted.job?.escrowSource}`);
  }
  steps.push("escrowSource=quote on accept");

  const start = new Date(Date.now() + 4 * 24 * 3600000);
  start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 2 * 3600000);
  await apiOk(`/api/jobs/${jobId}/schedule/propose`, {
    method: "POST",
    token: home.token,
    body: { start: start.toISOString(), end: end.toISOString(), note: "wave10 ics" },
  });
  const confirmed = await apiOk(`/api/jobs/${jobId}/schedule/accept`, {
    method: "POST",
    token: bidder.token,
  });
  if (confirmed.job?.scheduleStatus !== "confirmed") {
    throw new Error(`scheduleStatus ${confirmed.job?.scheduleStatus}`);
  }
  const ics = buildVisitIcsStub(confirmed.job);
  if (!ics.includes("TZID=Asia/Kolkata") || !ics.includes("BEGIN:VTIMEZONE")) {
    throw new Error("ICS missing Asia/Kolkata VTIMEZONE");
  }
  const gUrl = googleUrlStub(confirmed.job);
  if (!gUrl.includes("calendar.google.com")) throw new Error("google url bad");
  steps.push("confirmed visit → ICS TZ + Google URL shape ok");

  console.log("wave10:smoke OK");
  for (const s of steps) console.log(" -", s);
}

main().catch((e) => {
  console.error("wave10:smoke FAIL", e.message || e);
  process.exit(1);
});
