/**
 * Wave 17 API smoke: quote-Δ deep-link notify, homeowner counter-offer,
 * Find Pros minHeat filter, pro alert on revised-quote view.
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

  const created = await apiOk("/api/jobs", {
    method: "POST",
    token: home.token,
    body: {
      title: "Wave17 deep-link + counter + heat",
      description: "Wave 17 smoke for quote deep-link, counter-offer, minHeat, quote-viewed.",
      category: "plumbing",
      city: "Bengaluru",
      area: "Indiranagar",
      budgetMin: 2000,
      budgetMax: 8000,
      maxBids: 5,
      lat: 12.9784,
      lng: 77.6408,
    },
  });
  const jobId = created.job?.id;
  if (!jobId) throw new Error("job create failed");
  steps.push(`job ${jobId}`);

  const placed = await apiOk(`/api/jobs/${jobId}/bids`, {
    method: "POST",
    token: pro.token,
    body: {
      amount: 5200,
      message: "wave17 bid",
      etaDays: 2,
      quoteAmount: 5000,
      quoteNotes: "Initial wave17 quote",
    },
  });
  const bidId = placed.bid?.id;
  if (!bidId) throw new Error("bid missing");
  steps.push(`bid ${bidId}`);

  // Revise → deep-link notify
  const revised = await apiOk(`/api/bids/${bidId}/quote`, {
    method: "PATCH",
    token: pro.token,
    body: {
      quoteAmount: 4700,
      quoteNotes: "Revised wave17 quote",
    },
  });
  if (Number(revised.bid?.quoteAmount) !== 4700) throw new Error("quote not revised");
  if (Number(revised.quoteDiff?.amountDelta) !== -300) {
    throw new Error(`expected Δ -300 got ${revised.quoteDiff?.amountDelta}`);
  }
  steps.push(`quote revised Δ=${revised.quoteDiff.amountDelta}`);

  const homeNotes = await apiOk("/api/notifications?limit=30", { token: home.token });
  const homeList = homeNotes.notifications || homeNotes.items || [];
  const arr = Array.isArray(homeList) ? homeList : [];
  const reviseNote = arr.find(
    (n) => n.meta?.quoteRevised === true && n.meta?.bidId === bidId
  );
  if (!reviseNote) throw new Error("quote revise notification missing");
  const link = String(reviseNote.link || "");
  if (!link.includes(`bid=${bidId}`) || !link.includes(`#bid-${bidId}`)) {
    throw new Error(`deep-link missing on notify link: ${link}`);
  }
  if (Number(reviseNote.meta?.amountDelta) !== -300) {
    throw new Error("notify amountDelta wrong");
  }
  steps.push(`deep-link notify ${link}`);

  // Counter-offer / request revise
  const counter = await apiOk(`/api/bids/${bidId}/counter-offer`, {
    method: "POST",
    token: home.token,
    body: {
      suggestedAmount: 4200,
      notes: "Wave17 please revise toward 4200",
    },
  });
  if (!counter.bid?.counterOffer) throw new Error("counterOffer missing");
  if (Number(counter.bid.counterOffer.suggestedAmount) !== 4200) {
    throw new Error("suggestedAmount mismatch");
  }
  if (counter.bid.counterOffer.status !== "pending") {
    throw new Error("counter status not pending");
  }
  steps.push(`counter-offer ₹${counter.bid.counterOffer.suggestedAmount}`);

  const proNotes = await apiOk("/api/notifications?limit=30", { token: pro.token });
  const proList = Array.isArray(proNotes.notifications || proNotes.items)
    ? proNotes.notifications || proNotes.items
    : [];
  const counterNote = proList.find(
    (n) => n.meta?.counterOffer === true && n.meta?.bidId === bidId
  );
  if (!counterNote) throw new Error("pro counter-offer notify missing");
  if (Number(counterNote.meta?.suggestedAmount) !== 4200) {
    throw new Error("counter notify suggestedAmount wrong");
  }
  const clink = String(counterNote.link || "");
  if (!clink.includes("counter=1")) {
    throw new Error(`counter deep-link missing: ${clink}`);
  }
  steps.push("pro counter notify ok");

  // Quote viewed → pro alert (first time only)
  const viewed = await apiOk(`/api/bids/${bidId}/quote-viewed`, {
    method: "POST",
    token: home.token,
  });
  if (!viewed.viewed) throw new Error("quote-viewed viewed=false");
  if (!viewed.notified) throw new Error("expected notified=true on first view");
  steps.push("quote-viewed notified");

  const viewed2 = await apiOk(`/api/bids/${bidId}/quote-viewed`, {
    method: "POST",
    token: home.token,
  });
  if (viewed2.notified) throw new Error("duplicate quote-viewed notify");
  steps.push("quote-viewed deduped");

  const proNotes2 = await apiOk("/api/notifications?limit=40", { token: pro.token });
  const proList2 = Array.isArray(proNotes2.notifications || proNotes2.items)
    ? proNotes2.notifications || proNotes2.items
    : [];
  const viewNote = proList2.find(
    (n) => n.meta?.quoteViewed === true && n.meta?.bidId === bidId
  );
  if (!viewNote) throw new Error("pro quote-viewed notify missing");
  steps.push("pro quote-viewed notify ok");

  // Addressing counter via revise should mark addressed
  const addressed = await apiOk(`/api/bids/${bidId}/quote`, {
    method: "PATCH",
    token: pro.token,
    body: { quoteAmount: 4200, quoteNotes: "Meeting counter wave17" },
  });
  // Reload bid list to see counter status
  const bids = await apiOk(`/api/jobs/${jobId}/bids`, { token: home.token });
  const bidRow = (bids.bids || []).find((b) => b.id === bidId);
  if (!bidRow) throw new Error("bid row missing after address");
  if (bidRow.counterOffer?.status !== "addressed") {
    throw new Error(`expected counter addressed got ${bidRow.counterOffer?.status}`);
  }
  if (Number(addressed.bid?.quoteAmount) !== 4200) throw new Error("address revise failed");
  steps.push("counter addressed via revise");

  // minHeat browse filter
  const browseAll = await apiOk("/api/profile/browse?verified=1", { token: home.token });
  const allPros = browseAll.pros || [];
  if (!allPros.length) throw new Error("browse empty");
  const withHeat = allPros.filter((p) => p.availabilityHeat?.clean);
  if (!withHeat.length) {
    steps.push("minHeat: no clean heat in seed — skip strict filter assert");
  } else {
    const scores = withHeat.map((p) => Number(p.availabilityHeat.score || 0));
    const maxScore = Math.max(...scores);
    const threshold = Math.max(1, Math.min(50, maxScore));
    const filtered = await apiOk(
      `/api/profile/browse?verified=1&minHeat=${threshold}`,
      { token: home.token }
    );
    const fps = filtered.pros || [];
    for (const p of fps) {
      const sc = Number(p.availabilityHeat?.score || 0);
      if (!p.availabilityHeat?.clean || sc < threshold) {
        throw new Error(`minHeat leak: score=${sc} threshold=${threshold}`);
      }
    }
    steps.push(`minHeat>=${threshold} → ${fps.length}/${allPros.length} pros`);
  }

  // Soft: absurdly high heat returns empty or fewer
  const high = await apiOk("/api/profile/browse?verified=1&minHeat=99", {
    token: home.token,
  });
  const highN = (high.pros || []).length;
  if (highN > allPros.length) throw new Error("minHeat 99 returned more than unfiltered");
  steps.push(`minHeat=99 → ${highN}`);

  console.log("wave17:smoke OK");
  for (const s of steps) console.log(" -", s);
}

main().catch((e) => {
  console.error("wave17:smoke FAIL", e.message || e);
  process.exit(1);
});
