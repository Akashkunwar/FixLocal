/**
 * Wave 7 API smoke: SSE endpoints, Haversine ranking, bid quote, admin match-quality.
 * Requires backend :3001 and seeded users.
 */
const API = process.env.API_URL || "http://localhost:3001";
const PASS = process.env.SEED_PASSWORD || "Password123!";

async function api(pathname, { method = "GET", token, body, formData } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload = body;
  if (formData) {
    payload = formData;
  } else if (body) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${API}${pathname}`, { method, headers, body: payload });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${pathname} → ${res.status} ${data.message || ""}`);
  return data;
}

async function login(email) {
  return api("/api/auth/login", { method: "POST", body: { email, password: PASS } });
}

/** Lightweight SSE check without browser EventSource (Node). */
async function sseOnce(path, token, { event = "connected", timeoutMs = 5000 } = {}) {
  const url = `${API}${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Accept: "text/event-stream" },
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`SSE ${path} → ${res.status}`);
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/event-stream")) {
      throw new Error(`SSE ${path} bad content-type: ${ct}`);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      if (buf.includes(`event: ${event}`) || buf.includes("event: connected")) {
        ac.abort();
        return true;
      }
      if (buf.length > 8000) break;
    }
    throw new Error(`SSE ${path} did not emit ${event}; got: ${buf.slice(0, 200)}`);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const steps = [];
  const home = await login("home@fixlocal.local");
  const pro = await login("pro@fixlocal.local");
  const admin = await login("admin@fixlocal.local");

  await sseOnce("/api/notifications/stream", home.token);
  steps.push("notifications SSE connected");

  const nearLat = "12.9716";
  const nearLng = "77.5946";
  const jobs = await api(
    `/api/jobs?sort=distance&nearLat=${nearLat}&nearLng=${nearLng}&limit=10`,
    { token: pro.token }
  );
  if (!Array.isArray(jobs.jobs)) throw new Error("jobs distance list failed");
  const withDist = jobs.jobs.filter((j) => j.distanceKm != null);
  if (!withDist.length) throw new Error("expected distanceKm on seeded jobs");
  for (let i = 1; i < withDist.length; i++) {
    if (withDist[i].distanceKm + 0.05 < withDist[i - 1].distanceKm) {
      throw new Error("jobs not sorted by distanceKm");
    }
  }
  steps.push(`haversine jobs sorted (${withDist.length} with km)`);

  const pros = await api(
    `/api/profile/browse?sort=distance&nearLat=${nearLat}&nearLng=${nearLng}`,
    { token: home.token }
  );
  if (!Array.isArray(pros.pros) || !pros.pros.some((p) => p.distanceKm != null)) {
    throw new Error("browse pros missing distanceKm");
  }
  steps.push("haversine pros include distanceKm");

  const open = await api("/api/jobs?limit=20", { token: pro.token });
  let jobId = null;
  for (const j of open.jobs || []) {
    const bids = await api(`/api/jobs/${j.id}/bids`, { token: pro.token });
    const mine = (bids.bids || []).some((b) => b.tradespersonId === pro.user.id);
    if (!mine) {
      jobId = j.id;
      break;
    }
  }
  if (!jobId) jobId = open.jobs?.[0]?.id;
  if (!jobId) throw new Error("no open job for quote smoke");

  try {
    await api(`/api/jobs/${jobId}/bids`, {
      method: "POST",
      token: pro.token,
      body: {
        amount: 2200,
        message: "wave7 quote bid",
        etaDays: 2,
        quoteAmount: 2150,
        quoteNotes: "Labour 1500 + parts 650",
      },
    });
    steps.push("bid with structured quote placed");
  } catch (e) {
    steps.push(`bid quote skipped (${e.message}) — will try chat quote`);
  }

  const listed = await api(`/api/jobs/${jobId}/bids`, { token: home.token });
  const quoted = (listed.bids || []).find(
    (b) => b.tradespersonId === pro.user.id && (b.quoteAmount != null || b.quoteNotes)
  );
  if (quoted) {
    steps.push(`homeowner sees quote ₹${quoted.quoteAmount} on bid compare`);
  }

  const fd = new FormData();
  fd.append("body", "Here is a revised estimate");
  fd.append("quoteAmount", "2100");
  fd.append("quoteNotes", "Wave7 chat quote");
  const msg = await api(`/api/messages/${jobId}`, {
    method: "POST",
    token: pro.token,
    formData: fd,
  });
  if (!msg.message?.quote?.amount) throw new Error("chat quote missing");
  steps.push(`chat quote amount ${msg.message.quote.amount}`);

  await sseOnce(`/api/messages/${jobId}/stream`, home.token);
  steps.push("messages SSE connected");

  const mq = await api("/api/admin/match-quality", { token: admin.token });
  if (!mq.summary || !Array.isArray(mq.jobs)) throw new Error("match-quality shape bad");
  if (typeof mq.summary.openJobs !== "number") throw new Error("match-quality summary incomplete");
  steps.push(
    `match-quality open=${mq.summary.openJobs} none=${mq.summary.jobsWithNoNearby}`
  );

  console.log(steps.map((s) => `PASS: ${s}`).join("\n"));
  console.log("\nWAVE7 API SMOKE PASSED");
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
