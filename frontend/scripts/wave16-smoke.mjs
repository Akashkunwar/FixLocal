/**
 * Wave 16 API smoke: quote revise Δ notify, shortlist invite funnel
 * (rank→invite→bid), Find Pros availability heat + best-invite hint.
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
      `${opts?.method || "GET"} ${pathname} → ${r.status} ${r.data.message || JSON.stringify(r.data)}`
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

  // Ensure shortlist
  await apiOk("/api/favorites", {
    method: "POST",
    token: home.token,
    body: { targetType: "pro", targetId: pro.user.id },
  });
  steps.push("shortlist ensured");

  const created = await apiOk("/api/jobs", {
    method: "POST",
    token: home.token,
    body: {
      title: "Wave16 quote diff + shortlist funnel",
      description: "Wave 16 smoke for quote Δ notify, shortlist funnel, availability heat.",
      category: "plumbing",
      city: "Bengaluru",
      area: "Indiranagar",
      budgetMin: 2500,
      budgetMax: 9000,
      maxBids: 5,
      lat: 12.9784,
      lng: 77.6408,
    },
  });
  const jobId = created.job?.id;
  if (!jobId) throw new Error("job create failed");
  steps.push(`job ${jobId}`);

  // Ranked shortlist + invite with source/rank
  const ranked = await apiOk(`/api/jobs/${jobId}/shortlist-ranked`, { token: home.token });
  const hit = (ranked.shortlist || []).find((p) => p.userId === pro.user.id);
  if (!hit) throw new Error("pro not on ranked shortlist");
  const rankIdx = ranked.shortlist.findIndex((p) => p.userId === pro.user.id);
  const shortlistRank = rankIdx + 1;

  const invited = await apiOk(`/api/jobs/${jobId}/invite-pro`, {
    method: "POST",
    token: home.token,
    body: {
      tradespersonId: pro.user.id,
      message: "wave16 shortlist invite",
      source: "shortlist",
      shortlistRank,
      smartScore: hit.smartScore,
    },
  });
  if (invited.source !== "shortlist") throw new Error("invite source not shortlist");
  if (Number(invited.shortlistRank) !== shortlistRank) {
    throw new Error(`shortlistRank mismatch ${invited.shortlistRank}`);
  }
  steps.push(`shortlist invite rank=#${shortlistRank}`);

  // Bid + quote revise with delta
  const placed = await apiOk(`/api/jobs/${jobId}/bids`, {
    method: "POST",
    token: pro.token,
    body: {
      amount: 6100,
      message: "wave16 bid",
      etaDays: 2,
      quoteAmount: 6000,
      quoteNotes: "Initial wave16 quote",
    },
  });
  const bidId = placed.bid?.id;
  if (!bidId) throw new Error("bid missing");

  const revised = await apiOk(`/api/bids/${bidId}/quote`, {
    method: "PATCH",
    token: pro.token,
    body: {
      quoteAmount: 5500,
      quoteNotes: "Revised wave16 quote (parts cheaper)",
    },
  });
  if (Number(revised.bid?.quoteAmount) !== 5500) throw new Error("quote not updated");
  const diff = revised.quoteDiff;
  if (!diff) throw new Error("quoteDiff missing in revise response");
  if (Number(diff.previousAmount) !== 6000) throw new Error("previousAmount expected 6000");
  if (Number(diff.newAmount) !== 5500) throw new Error("newAmount expected 5500");
  if (Number(diff.amountDelta) !== -500) throw new Error(`amountDelta expected -500 got ${diff.amountDelta}`);
  if (diff.notesChanged !== true) throw new Error("notesChanged expected true");
  steps.push(`quoteDiff Δ=${diff.amountDelta} notesChanged=${diff.notesChanged}`);

  // Homeowner notifications should mention delta
  const notes = await apiOk("/api/notifications?limit=20", { token: home.token });
  const list = notes.notifications || notes.items || notes || [];
  const arr = Array.isArray(list) ? list : [];
  const hitNote = arr.find(
    (n) =>
      n.meta?.quoteRevised === true &&
      n.meta?.bidId === bidId &&
      Number(n.meta?.amountDelta) === -500
  );
  if (!hitNote) {
    // soft: some installs paginate differently
    const anyRevise = arr.find((n) => n.meta?.quoteRevised === true && n.meta?.bidId === bidId);
    if (!anyRevise) throw new Error("quote revise notification missing");
    if (Number(anyRevise.meta?.amountDelta) !== -500) {
      throw new Error("notification amountDelta missing/wrong");
    }
  }
  steps.push("homeowner quote Δ notify ok");

  // Shortlist funnel
  const funnel = await apiOk(`/api/jobs/${jobId}/shortlist-invite-analytics`, {
    token: home.token,
  });
  if (!funnel.funnel || funnel.funnel.length < 3) throw new Error("funnel stages missing");
  if (funnel.ranked < 1) throw new Error("ranked < 1");
  if (funnel.invited < 1) throw new Error("invited < 1");
  if (funnel.bidAfter < 1) throw new Error("bidAfter < 1");
  steps.push(
    `funnel ranked=${funnel.ranked} invited=${funnel.invited} bid=${funnel.bidAfter} rates=${funnel.inviteRate}/${funnel.bidRate}`
  );

  const agg = await apiOk("/api/jobs/shortlist-invite-analytics", { token: home.token });
  if (!agg.funnel || agg.ranked < 1) throw new Error("aggregate shortlist funnel bad");
  steps.push(`agg funnel invited=${agg.invited} bid=${agg.bidAfter}`);

  // Browse heat + best invite hint
  const browse = await apiOk("/api/profile/browse?verified=1", { token: home.token });
  const pros = browse.pros || [];
  if (!pros.length) throw new Error("browse empty");
  const withHeat = pros.filter((p) => p.availabilityHeat && p.availabilityHeat.clean);
  if (!withHeat.length) {
    // seed pros usually have weeklyAvailability — fail soft only if none at all have the field
    const anyField = pros.some((p) => p.availabilityHeat != null);
    if (!anyField) throw new Error("availabilityHeat missing on browse results");
    steps.push(`browse heat present but none clean (n=${pros.length})`);
  } else {
    const sample = withHeat[0];
    if (!Array.isArray(sample.availabilityHeat.days) || sample.availabilityHeat.days.length !== 7) {
      throw new Error("heat days must be length 7");
    }
    steps.push(
      `browse heat n=${withHeat.length} sampleScore=${sample.availabilityHeat.score} hint=${
        sample.bestInviteHint ? "yes" : "no"
      }`
    );
    // Soft: if clean, hint should usually exist when hours > 0
    if (sample.availabilityHeat.totalHours > 0 && !sample.bestInviteHint) {
      throw new Error("expected bestInviteHint when clean + hours > 0");
    }
  }

  console.log("wave16:smoke OK");
  for (const s of steps) console.log(" -", s);
}

main().catch((e) => {
  console.error("wave16:smoke FAIL", e.message || e);
  process.exit(1);
});
