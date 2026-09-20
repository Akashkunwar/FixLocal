/**
 * Wave 9 API smoke: invite suggested pro, escrowSource on payments, schedule confirm + ICS shape.
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
  if (!res.ok) throw new Error(`${method} ${pathname} → ${res.status} ${data.message || ""}`);
  return data;
}

async function login(email) {
  return api("/api/auth/login", { method: "POST", body: { email, password: PASS } });
}

function buildVisitIcsStub(job) {
  if (!job.scheduledStart) throw new Error("no scheduledStart");
  const start = new Date(job.scheduledStart);
  const end = job.scheduledEnd
    ? new Date(job.scheduledEnd)
    : new Date(start.getTime() + 2 * 3600000);
  const pad = (n) => String(n).padStart(2, "0");
  const utc = (d) =>
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    `UID:fixlocal-visit-${job.id}@fixlocal.local`,
    `DTSTART:${utc(start)}`,
    `DTEND:${utc(end)}`,
    `SUMMARY:FixLocal visit — ${job.title}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

async function main() {
  const steps = [];
  const home = await login("home@fixlocal.local");
  const pro = await login("pro@fixlocal.local");
  const pro2 = await login("pro2@fixlocal.local");

  const created = await api("/api/jobs", {
    method: "POST",
    token: home.token,
    body: {
      title: "Wave9 invite + escrow source smoke",
      description: "Wave 9 smoke job for invite, escrowSource, and ICS export checks.",
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
  if (!created.job?.id) throw new Error("job create failed");
  const jobId = created.job.id;
  steps.push(`job ${jobId}`);

  const sug = await api(`/api/jobs/${jobId}/suggested-pros?limit=5`, { token: home.token });
  if (!sug.suggestions?.length) throw new Error("suggested-pros empty");
  const invitee =
    sug.suggestions.find((s) => s.userId === pro2.user.id) ||
    sug.suggestions.find((s) => s.userId === pro.user.id);
  if (!invitee) throw new Error("seed pro/pro2 not in suggested-pros");
  const inviteeToken = invitee.userId === pro.user.id ? pro.token : pro2.token;
  steps.push(`invite target ${invitee.name || invitee.userId} score=${invitee.score}`);

  const invited = await api(`/api/jobs/${jobId}/invite-pro`, {
    method: "POST",
    token: home.token,
    body: {
      tradespersonId: invitee.userId,
      message: "Wave9 smoke invite — flexible this week",
    },
  });
  if (!invited.ok) throw new Error("invite not ok");
  steps.push(`invite sent to ${invitee.name || invitee.userId} notificationId=${invited.notificationId}`);

  const nlist = await api("/api/notifications?limit=30", { token: inviteeToken });
  const arr = nlist.notifications || [];
  const hit = arr.find((n) => n.meta?.invite === true && n.meta?.jobId === jobId);
  if (!hit) throw new Error("invite notification not found for invitee");
  steps.push("invitee sees in-app invite notification");

  const quoteAmt = 3200;
  await api(`/api/jobs/${jobId}/bids`, {
    method: "POST",
    token: pro.token,
    body: {
      amount: 3500,
      message: "wave9 escrow source",
      etaDays: 1,
      quoteAmount: quoteAmt,
      quoteNotes: "Quoted labour + parts",
    },
  });

  const bids = await api(`/api/jobs/${jobId}/bids`, { token: home.token });
  const myBid = (bids.bids || []).find((b) => b.tradespersonId === pro.user.id);
  if (!myBid) throw new Error("bid missing");

  const accepted = await api(`/api/bids/${myBid.id}/accept`, {
    method: "POST",
    token: home.token,
  });
  if (accepted.escrow?.source !== "quote") {
    throw new Error(`accept escrow.source expected quote got ${accepted.escrow?.source}`);
  }
  if (accepted.job?.escrowSource !== "quote") {
    throw new Error(`job.escrowSource expected quote got ${accepted.job?.escrowSource}`);
  }
  steps.push(`accept stored escrowSource=quote amount=${accepted.escrow.amount}`);

  const pays = await api(`/api/jobs/${jobId}/payments`, { token: home.token });
  if (pays.escrowSource !== "quote") {
    throw new Error(`payments.escrowSource expected quote got ${pays.escrowSource}`);
  }
  if (Math.abs(Number(pays.escrowAmount) - quoteAmt) > 0.01) {
    throw new Error(`payments amount ${pays.escrowAmount} != ${quoteAmt}`);
  }
  steps.push("payments API returns escrowSource=quote");

  // Schedule propose + accept for ICS
  const start = new Date(Date.now() + 3 * 24 * 3600000);
  start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 2 * 3600000);
  await api(`/api/jobs/${jobId}/schedule/propose`, {
    method: "POST",
    token: home.token,
    body: { start: start.toISOString(), end: end.toISOString(), note: "wave9 ics" },
  });
  const confirmed = await api(`/api/jobs/${jobId}/schedule/accept`, {
    method: "POST",
    token: pro.token,
  });
  if (confirmed.job?.scheduleStatus !== "confirmed") {
    throw new Error(`scheduleStatus ${confirmed.job?.scheduleStatus}`);
  }
  const ics = buildVisitIcsStub(confirmed.job);
  if (!ics.includes("BEGIN:VEVENT") || !ics.includes("DTSTART:")) {
    throw new Error("ICS stub missing VEVENT/DTSTART");
  }
  steps.push("confirmed visit → ICS shape ok");

  console.log("wave9:smoke OK");
  for (const s of steps) console.log(" -", s);
}

main().catch((e) => {
  console.error("wave9:smoke FAIL", e.message || e);
  process.exit(1);
});
