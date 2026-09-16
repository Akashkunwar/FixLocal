/** Wave 27 API/UI smoke: siteType chips, job templates, onboarding, soft rates, service areas. */
const API = process.env.API_URL || "http://localhost:3001";
const FE = process.env.FE_URL || "http://localhost:5173";
const PASS = process.env.SEED_PASSWORD || "Password123!";
const fs = await import("fs");
const path = await import("path");
const { fileURLToPath } = await import("url");
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

async function api(p, { method = "GET", token, body } = {}) {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { ok: res.ok, status: res.status, data };
}

async function apiOk(p, opts) {
  const r = await api(p, opts);
  if (!r.ok) {
    throw new Error(
      `${opts?.method || "GET"} ${p} → ${r.status} ${JSON.stringify(r.data)}`
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

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

async function main() {
  const steps = [];

  const home = await login("home@fixlocal.local");
  const pro = await login("pro@fixlocal.local");
  steps.push("login client + professional");

  // Browse jobs siteType filter still works
  const filtered = await apiOk("/api/jobs?siteType=residential&status=open", {
    token: pro.token,
  });
  const jobs = filtered.jobs || filtered;
  if (!Array.isArray(jobs)) throw new Error("jobs list missing");
  steps.push("browse jobs siteType=residential");

  // Find pros soft siteType filter
  const officePros = await apiOk("/api/profile/browse?siteType=office", {
    token: home.token,
  });
  if (!Array.isArray(officePros.pros || officePros)) {
    throw new Error("browse pros office missing pros array");
  }
  steps.push("find pros siteType=office soft filter");

  const resPros = await apiOk("/api/profile/browse?siteType=residential", {
    token: home.token,
  });
  if (!Array.isArray(resPros.pros || resPros)) {
    throw new Error("browse pros residential missing pros array");
  }
  steps.push("find pros siteType=residential soft filter");

  const bad = await api("/api/profile/browse?siteType=warehouse", {
    token: home.token,
  });
  if (bad.ok) throw new Error("invalid pro siteType should 400");
  steps.push("invalid browse siteType rejected");

  // Source IA smoke
  const checks = [
    [
      "src/pages/tradesperson/BrowseJobsPage.tsx",
      ["siteType", "SITE_TYPES", "OnboardingChecklist", "Professional getting started"],
    ],
    [
      "src/pages/homeowner/FindProsPage.tsx",
      ["siteType", "SITE_TYPES", "visitedPros"],
    ],
    [
      "src/pages/homeowner/CreateJobPage.tsx",
      ["templatesForGroup", "Quick templates", "applyTemplate"],
    ],
    [
      "src/lib/jobTemplates.ts",
      ["JOB_TEMPLATES_BY_GROUP", "Home repair & maintenance"],
    ],
    [
      "src/pages/homeowner/HomeownerDashboard.tsx",
      ["OnboardingChecklist", "Client getting started"],
    ],
    [
      "src/pages/tradesperson/ProfilePage.tsx",
      ["SERVICE_AREA_OPTIONS", "softRatePackages", "Soft package preview"],
    ],
    [
      "src/pages/ProPublicPage.tsx",
      ["softRatePackages", "Soft rate packages"],
    ],
    [
      "src/components/OnboardingChecklist.tsx",
      ["fixlocal:onboarding", "Dismiss"],
    ],
    ["src/lib/ratePackages.ts", ["Site visit", "Half-day", "Full day"]],
    ["src/lib/serviceAreas.ts", ["Indiranagar", "Koramangala", "joinServiceAreas"]],
  ];

  for (const [rel, needles] of checks) {
    const src = read(rel);
    for (const n of needles) {
      if (!src.includes(n)) throw new Error(`${rel} missing ${JSON.stringify(n)}`);
    }
    steps.push(`${rel} IA smoke`);
  }

  // FE reachable + module smoke when vite serves /src
  const htmlRes = await fetch(FE + "/");
  if (!htmlRes.ok) throw new Error(`FE ${FE} → ${htmlRes.status}`);
  steps.push("FE index reachable");

  const mod = await fetch(`${FE}/src/lib/jobTemplates.ts`);
  if (mod.ok) {
    const src = await mod.text();
    if (!src.includes("JOB_TEMPLATES_BY_GROUP")) {
      throw new Error("jobTemplates module missing export");
    }
    steps.push("FE jobTemplates module");
  } else {
    steps.push("FE jobTemplates not served (ok if preview build)");
  }

  console.log("wave27:smoke OK");
  for (const s of steps) console.log(" -", s);
}

main().catch((e) => {
  console.error("wave27:smoke FAIL", e);
  process.exit(1);
});
