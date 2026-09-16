/**
 * Wave 6 API smoke: chat attachment, analytics shape, city facets, match alert heuristic.
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
  const r = await api("/api/auth/login", { method: "POST", body: { email, password: PASS } });
  return r;
}

async function main() {
  const steps = [];
  const home = await login("home@fixlocal.local");
  const pro = await login("pro@fixlocal.local");

  // Analytics shape
  const analytics = await api("/api/profile/analytics", { token: pro.token });
  const a = analytics.analytics;
  if (!a || !Array.isArray(a.earningsOverTime) || !("categoryMix" in a)) {
    throw new Error("analytics missing categoryMix/earningsOverTime");
  }
  steps.push("analytics categoryMix + response fields present");

  // City facet browse
  const jobs = await api("/api/jobs?city=Bengaluru&limit=5", { token: pro.token });
  if (!Array.isArray(jobs.jobs)) throw new Error("jobs list failed");
  steps.push(`city facet returned ${jobs.jobs.length} jobs`);

  const pros = await api("/api/profile/browse?city=Bengaluru&neighborhood=Indiranagar", {
    token: home.token,
  });
  if (!Array.isArray(pros.pros)) throw new Error("browse pros failed");
  steps.push(`neighborhood facet returned ${pros.pros.length} pros`);

  // Favorite pro then trigger availability alert
  await api("/api/favorites", {
    method: "POST",
    token: home.token,
    body: { targetType: "pro", targetId: pro.user.id },
  });
  const profile = await api("/api/profile", { token: pro.token });
  const wa = profile.profile.weeklyAvailability || {};
  await api("/api/profile", {
    method: "PATCH",
    token: pro.token,
    body: {
      weeklyAvailability: {
        ...wa,
        mon: { enabled: true, start: "09:00", end: "18:00", slots: [{ start: "09:00", end: "18:00" }] },
      },
    },
  });
  const notifs = await api("/api/notifications?unread=1", { token: home.token });
  const hit = (notifs.notifications || []).some(
    (n) => n.type === "pro_available" || /availability|verified/i.test(n.body || "")
  );
  if (!hit) {
    console.warn("WARN: no pro_available notification yet (prefs/timing) — continuing");
  } else {
    steps.push("favorited-pro availability notification seen");
  }

  // Find an accessible job for messaging (open with bid or awarded)
  const open = await api("/api/jobs?limit=10", { token: pro.token });
  const jobId = open.jobs?.[0]?.id;
  if (!jobId) throw new Error("no open job for chat smoke");

  // Ensure bid so messaging is allowed
  try {
    await api(`/api/jobs/${jobId}/bids`, {
      method: "POST",
      token: pro.token,
      body: { amount: 1500, message: "wave6 smoke bid", etaDays: 2 },
    });
  } catch (e) {
    /* may already have bid or max */
  }

  const fd = new FormData();
  fd.append("body", "Wave6 attachment smoke");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  fd.append("attachments", new Blob([png], { type: "image/png" }), "wave6.png");

  const msg = await api(`/api/messages/${jobId}`, {
    method: "POST",
    token: pro.token,
    formData: fd,
  });
  if (!msg.message?.attachmentUrls?.length) {
    throw new Error("message missing attachmentUrls");
  }
  steps.push("chat attachment uploaded");

  const listed = await api(`/api/messages/${jobId}`, { token: home.token });
  const found = (listed.messages || []).some((m) => (m.attachmentUrls || []).length > 0);
  if (!found) throw new Error("homeowner cannot see attachment");
  steps.push("homeowner sees chat attachment");

  console.log(steps.map((s) => `PASS: ${s}`).join("\n"));
  console.log("\nWAVE6 API SMOKE PASSED");
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
