/**
 * Wave 11 API smoke: invite history, bulk invite, decline reason chips,
 * cooldown fields, stronger invoice parties + audit notes.
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
      title: "Wave11 invite history bulk invoice smoke",
      description: "Wave 11 smoke for invite history, bulk invite, decline chips, invoice parties.",
      category: "plumbing",
      city: "Bengaluru",
      area: "Indiranagar",
      budgetMin: 2000,
      budgetMax: 6000,
      maxBids: 5,
      lat: 12.9784,
      lng: 77.6408,
    },
  });
  const jobId = created.job?.id;
  if (!jobId) throw new Error("job create failed");
  steps.push(`job ${jobId}`);

  const sug = await apiOk(`/api/jobs/${jobId}/suggested-pros?limit=5`, {
    token: home.token,
  });
  const ids = (sug.suggestions || []).map((s) => s.userId);
  const invitees = [pro.user.id, pro2.user.id].filter((id) => ids.includes(id));
  if (invitees.length < 2) {
    // fall back to whatever suggested
    const fallback = (sug.suggestions || []).slice(0, 2).map((s) => s.userId);
    if (fallback.length < 1) throw new Error("no suggested pros");
    invitees.length = 0;
    invitees.push(...fallback);
  }
  steps.push(`bulk targets ${invitees.length}`);

  const bulk = await apiOk(`/api/jobs/${jobId}/invite-pros`, {
    method: "POST",
    token: home.token,
    body: {
      tradespersonIds: invitees,
      message: "Wave11 bulk invite",
    },
  });
  if (!bulk.sent || bulk.sent < 1) {
    throw new Error(`bulk sent=${bulk.sent} failed=${bulk.failed}`);
  }
  steps.push(`bulk sent=${bulk.sent} failed=${bulk.failed}`);

  const hist = await apiOk(`/api/jobs/${jobId}/invites`, { token: home.token });
  if (!hist.invites?.length) throw new Error("invite history empty");
  if (typeof hist.limit !== "number" || typeof hist.used !== "number") {
    throw new Error("invite quota missing");
  }
  const pending = hist.invites.filter((i) => i.status === "pending");
  if (!pending.length) throw new Error("expected pending invites");
  if (!pending[0].invitedByUserId || !pending[0].invitedAt) {
    throw new Error("invite history missing who/when");
  }
  steps.push(`history ${hist.invites.length} (used ${hist.used}/${hist.limit})`);

  // Decline with reason chip using first invitee that matches a seed pro
  const declineTarget =
    hist.invites.find((i) => i.tradespersonId === pro.user.id) ||
    hist.invites.find((i) => i.tradespersonId === pro2.user.id) ||
    hist.invites[0];
  const declineToken =
    declineTarget.tradespersonId === pro.user.id
      ? pro.token
      : declineTarget.tradespersonId === pro2.user.id
        ? pro2.token
        : null;
  if (!declineToken) throw new Error("no token for decline target");

  const declined = await apiOk(`/api/jobs/${jobId}/decline-invite`, {
    method: "POST",
    token: declineToken,
    body: { reason: "schedule", note: "Wave11 chip decline" },
  });
  if (!declined.ok) throw new Error("decline failed");
  steps.push(`declined reason=${declined.reason || "schedule"}`);

  const hist2 = await apiOk(`/api/jobs/${jobId}/invites`, { token: home.token });
  const declinedRow = hist2.invites.find(
    (i) => i.tradespersonId === declineTarget.tradespersonId && i.status === "declined"
  );
  if (!declinedRow) throw new Error("declined row missing in history");
  if (declinedRow.declineReason !== "schedule") {
    throw new Error(`declineReason ${declinedRow.declineReason}`);
  }
  if (!declinedRow.inCooldown || !declinedRow.cooldownUntil) {
    throw new Error("cooldown fields missing after decline");
  }
  steps.push(
    `cooldownUntil set remainingMs=${declinedRow.cooldownRemainingMs}`
  );

  // Re-invite should hit cooldown
  const cool = await api(`/api/jobs/${jobId}/invite-pro`, {
    method: "POST",
    token: home.token,
    body: { tradespersonId: declineTarget.tradespersonId },
  });
  if (cool.status !== 429 || cool.data.code !== "INVITE_COOLDOWN") {
    throw new Error(`expected INVITE_COOLDOWN got ${cool.status} ${cool.data.code}`);
  }
  if (cool.data.retryAfterMs == null || !cool.data.cooldownUntil) {
    throw new Error("cooldown response missing retryAfterMs/cooldownUntil");
  }
  steps.push("re-invite → 429 INVITE_COOLDOWN with countdown fields");

  // Admin audit note scoped to job for invoice snippet
  await apiOk("/api/admin/audit-notes", {
    method: "POST",
    token: admin.token,
    body: {
      note: "Wave11 smoke audit note for invoice snippet",
      targetType: "job",
      targetId: jobId,
      summary: "Wave11 invoice audit",
    },
  });
  steps.push("admin audit note on job");

  // Bid+accept with other pro for parties on payments
  const bidderId =
    declineTarget.tradespersonId === pro.user.id ? pro2.user.id : pro.user.id;
  const bidderToken = bidderId === pro.user.id ? pro.token : pro2.token;

  // Ensure bidder was invited or can still bid on open job
  await apiOk(`/api/jobs/${jobId}/bids`, {
    method: "POST",
    token: bidderToken,
    body: {
      amount: 4200,
      message: "wave11",
      etaDays: 2,
      quoteAmount: 3900,
      quoteNotes: "wave11 quote",
    },
  });
  const bids = await apiOk(`/api/jobs/${jobId}/bids`, { token: home.token });
  const myBid = (bids.bids || []).find((b) => b.tradespersonId === bidderId);
  if (!myBid) throw new Error("bid missing");
  await apiOk(`/api/bids/${myBid.id}/accept`, {
    method: "POST",
    token: home.token,
  });

  const pay = await apiOk(`/api/jobs/${jobId}/payments`, { token: home.token });
  if (!pay.parties?.homeowner?.email) throw new Error("invoice parties homeowner missing");
  if (!pay.parties?.tradesperson?.id) throw new Error("invoice parties tradesperson missing");
  if (pay.escrowSource !== "quote") throw new Error(`escrowSource ${pay.escrowSource}`);
  if (!pay.auditNotes?.length) throw new Error("auditNotes missing on payments");
  const snip = pay.auditNotes[0].snippet || "";
  if (!snip.toLowerCase().includes("wave11")) {
    throw new Error(`audit snippet unexpected: ${snip}`);
  }
  steps.push("payments parties + escrowSource + audit snippet ok");

  console.log("wave11:smoke OK");
  for (const s of steps) console.log(" -", s);
}

main().catch((e) => {
  console.error("wave11:smoke FAIL", e.message || e);
  process.exit(1);
});
