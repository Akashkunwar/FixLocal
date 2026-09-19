/**
 * Runs the legacy wave smoke scripts against the current API contract.
 *
 *   node --import ./scripts/legacy-compat.mjs scripts/wave12-smoke.mjs
 *
 * The audit fixes deliberately changed some requests (see README → Testing). This shim wraps
 * `fetch` for the scripts only and translates the old calls, so each script runs to the end
 * instead of stopping at the first changed call. The API itself is not relaxed in any way.
 */
const realFetch = globalThis.fetch.bind(globalThis);
const API = (process.env.API_URL || "http://localhost:3001").replace(/\/$/, "");

const TEMPLATE_KEYS = {
  inviteTemplates: "invite",
  counterTemplates: "counter",
  homeownerCounterTemplates: "homeownerCounter",
  introTemplates: "intro",
  namedJobTemplates: "namedJob",
};

/** Bids seen in any response, so accept calls can send the amount the client saw (C-6). */
const bids = new Map();

function remember(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 5) return;
  if (Array.isArray(value)) return value.forEach((v) => remember(v, depth + 1));
  if (typeof value.id === "string" && "quoteRevision" in value && "amount" in value) {
    bids.set(value.id, value);
  }
  for (const v of Object.values(value)) remember(v, depth + 1);
}

const pad = (pw) => (typeof pw === "string" && pw.length < 10 ? `${pw}-legacy!` : pw);

function jsonBody(init) {
  if (!init?.body || typeof init.body !== "string") return null;
  try {
    return JSON.parse(init.body);
  } catch {
    return null;
  }
}

function authHeader(init) {
  const h = new Headers(init?.headers);
  return h.get("Authorization");
}

async function readJson(res) {
  const text = await res.clone().text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

const withJson = (res, data) =>
  new Response(JSON.stringify(data), { status: res.status, statusText: res.statusText, headers: res.headers });

async function templatesFor(auth) {
  const res = await realFetch(`${API}/api/auth/me/templates`, { headers: { Authorization: auth } });
  return res.ok ? (await res.json()).templates : null;
}

async function mergeTemplates(res, auth) {
  const data = await readJson(res);
  if (!res.ok || !data?.user) return res;
  const t = await templatesFor(auth);
  if (!t) return res;
  for (const [key, kind] of Object.entries(TEMPLATE_KEYS)) data.user[key] = t[kind];
  return withJson(res, data);
}

async function compatFetch(input, init = {}) {
  const raw = typeof input === "string" ? input : input.url;
  if (!raw.startsWith(API)) return realFetch(input, init);
  const url = new URL(raw);
  const path = url.pathname;
  const method = (init.method || "GET").toUpperCase();
  const auth = authHeader(init);
  let body = jsonBody(init);

  // Password policy is now 10+ characters (M-9): pad old short test passwords consistently.
  if (body && /^\/api\/auth\/(register|login|change-password|reset-password|me)$/.test(path)) {
    for (const k of ["password", "newPassword", "currentPassword"]) if (k in body) body[k] = pad(body[k]);
    init = { ...init, body: JSON.stringify(body) };
  }

  // Streams take a one-time ticket instead of a token in the URL (H-3).
  const token = url.searchParams.get("token");
  const streamAuth = token ? `Bearer ${token}` : auth;
  const newTicket = async () => {
    const t = await realFetch(`${API}/api/auth/sse-ticket`, { method: "POST", headers: { Authorization: streamAuth } });
    url.searchParams.delete("token");
    if (t.ok) url.searchParams.set("ticket", (await t.json()).ticket);
  };
  if (token && path.endsWith("/stream")) await newTicket();

  // Accepting a bid must name the amount and quote revision the client saw (C-6).
  const accept = path.match(/^\/api\/bids\/([^/]+)\/accept$/);
  if (accept && method === "POST" && !(body && "expectedAmount" in body)) {
    const bid = bids.get(accept[1]);
    if (bid) {
      const quote = Number(bid.quoteAmount);
      body = {
        ...(body || {}),
        expectedAmount: Number.isFinite(quote) && quote > 0 ? quote : Number(bid.amount),
        expectedRevision: bid.quoteRevision ?? 0,
      };
      const headers = new Headers(init.headers);
      headers.set("Content-Type", "application/json");
      init = { ...init, headers, body: JSON.stringify(body) };
    }
  }

  // Templates moved from the user record to /api/auth/me/templates (L-7).
  if (path === "/api/auth/me" && method === "PATCH" && body && auth) {
    const rest = { ...body };
    for (const [key, kind] of Object.entries(TEMPLATE_KEYS)) {
      if (!(key in rest)) continue;
      await realFetch(`${API}/api/auth/me/templates/${kind}`, {
        method: "PUT",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify({ items: Array.isArray(rest[key]) ? rest[key] : [] }),
      });
      delete rest[key];
    }
    init = { ...init, body: JSON.stringify(rest) };
  }

  let res = await realFetch(url.toString(), init);

  // One chat thread per professional (H-2): clients/admins must name the thread.
  if (res.status === 400 && /^\/api\/messages\/[^/]+(\/stream)?$/.test(path)) {
    const err = await readJson(res);
    if (err?.code === "THREAD_REQUIRED") {
      const jobId = path.split("/")[3];
      const threads = await realFetch(`${API}/api/messages/${jobId}/threads`, {
        headers: streamAuth ? { Authorization: streamAuth } : {},
      });
      const list = threads.ok ? (await threads.json()).threads || [] : [];
      const pick = list.find((t) => t.hired) || list[0];
      if (pick) {
        url.searchParams.set("pro", pick.tradespersonId);
        if (path.endsWith("/stream")) await newTicket(); // tickets are single-use
        res = await realFetch(url.toString(), init);
      }
    }
  }

  // Pros only see bids on jobs they bid on (H-1); like the app, treat a refusal as "none of mine".
  if (res.status === 403 && method === "GET" && /^\/api\/jobs\/[^/]+\/bids$/.test(path)) {
    return new Response(JSON.stringify({ bids: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  if (path === "/api/auth/me" && auth && (method === "GET" || method === "PATCH")) {
    res = await mergeTemplates(res, auth);
  }

  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) remember(await readJson(res));
  return res;
}

globalThis.fetch = compatFetch;
