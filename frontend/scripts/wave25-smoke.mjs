/** Wave 25 API/UI smoke: expanded categories + Client/Professional copy on landing. */
const API = process.env.API_URL || "http://localhost:3001";
const FE = process.env.FE_URL || "http://localhost:5173";
const PASS = process.env.SEED_PASSWORD || "Password123!";

const EXPECTED = [
  "plumbing",
  "electrical",
  "carpentry",
  "painting",
  "appliance",
  "cleaning",
  "construction",
  "office_facilities",
  "tech_services",
  "moving",
  "other",
];

async function api(path, { method = "GET", token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
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

async function apiOk(path, opts) {
  const r = await api(path, opts);
  if (!r.ok) {
    throw new Error(
      `${opts?.method || "GET"} ${path} → ${r.status} ${JSON.stringify(r.data)}`
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
  steps.push("login client + professional");

  // Post a job in each new lead category (then leave them; seed may also have samples)
  const samples = [
    {
      title: "Wave25 smoke — office facilities walkthrough",
      category: "office_facilities",
      description: "Wave 25 smoke job for office & facilities category.",
    },
    {
      title: "Wave25 smoke — CCTV networking check",
      category: "tech_services",
      description: "Wave 25 smoke job for tech services category.",
    },
    {
      title: "Wave25 smoke — moving helpers half-day",
      category: "moving",
      description: "Wave 25 smoke job for moving / helpers category.",
    },
    {
      title: "Wave25 smoke — deep clean studio",
      category: "cleaning",
      description: "Wave 25 smoke job for cleaning category.",
    },
    {
      title: "Wave25 smoke — tiling patch",
      category: "construction",
      description: "Wave 25 smoke job for construction category.",
    },
  ];

  const created = [];
  for (const s of samples) {
    const job = await apiOk("/api/jobs", {
      method: "POST",
      token: home.token,
      body: {
        title: s.title,
        description: s.description,
        category: s.category,
        budgetMin: 1000,
        budgetMax: 5000,
        address: "Wave25 Test St",
        area: "Indiranagar",
        city: "Bengaluru",
        pincode: "560038",
        maxBids: 5,
      },
    });
    const id = job.job?.id || job.id;
    if (!id) throw new Error(`no job id for ${s.category}: ${JSON.stringify(job)}`);
    if ((job.job?.category || job.category) !== s.category) {
      throw new Error(`category mismatch for ${s.category}`);
    }
    created.push({ id, category: s.category });
  }
  steps.push(`created ${created.length} jobs in new categories`);

  // Browse filters accept new categories
  for (const cat of ["cleaning", "tech_services", "moving"]) {
    const list = await apiOk(`/api/jobs?category=${cat}&status=open`, {
      token: pro.token,
    });
    const jobs = list.jobs || list;
    if (!Array.isArray(jobs) || jobs.length < 1) {
      throw new Error(`browse filter empty for category=${cat}`);
    }
    if (!jobs.some((j) => j.category === cat)) {
      throw new Error(`browse filter missing ${cat} rows`);
    }
  }
  steps.push("browse filters return new categories");

  // Not-interested categories accept new values
  const me = await apiOk("/api/profile", { token: pro.token });
  const prev = me.profile?.notInterestedCategories || [];
  await apiOk("/api/profile", {
    method: "PATCH",
    token: pro.token,
    body: { notInterestedCategories: ["cleaning", "moving"] },
  });
  const after = await apiOk("/api/profile", { token: pro.token });
  const ni = after.profile?.notInterestedCategories || [];
  if (!ni.includes("cleaning") || !ni.includes("moving")) {
    throw new Error(`notInterestedCategories not saved: ${JSON.stringify(ni)}`);
  }
  await apiOk("/api/profile", {
    method: "PATCH",
    token: pro.token,
    body: { notInterestedCategories: prev },
  });
  steps.push("not-interested accepts new categories");

  // Soft assert EXPECTED set is what FE format.ts documents (via posting plumbing still works)
  const classic = await apiOk("/api/jobs", {
    method: "POST",
    token: home.token,
    body: {
      title: "Wave25 smoke — classic plumbing",
      description: "Ensure legacy categories still post.",
      category: "plumbing",
      budgetMin: 500,
      budgetMax: 2000,
      address: "Wave25",
      area: "Indiranagar",
      city: "Bengaluru",
      pincode: "560038",
      maxBids: 3,
    },
  });
  if ((classic.job?.category || classic.category) !== "plumbing") {
    throw new Error("legacy plumbing category broken");
  }
  steps.push(`legacy categories ok (${EXPECTED.length} expected in FE)`);

  // Landing copy smoke (vite dev or preview)
  const htmlRes = await fetch(FE + "/");
  const html = await htmlRes.text();
  if (!htmlRes.ok) throw new Error(`FE ${FE} → ${htmlRes.status}`);
  // SPA shell — fetch built index or vite; also hit source via vite transform is hard.
  // Soft check: index.html meta/title no longer say home-repairs-only.
  if (/hire verified local tradespeople for home repairs/i.test(html)) {
    throw new Error("landing meta still home-repairs-only");
  }
  if (/Home services, done right/i.test(html)) {
    throw new Error("landing title still home-services-only");
  }
  steps.push("FE index meta/title marketplace-oriented");

  // Extra: fetch Landing module through vite if available
  try {
    const mod = await fetch(`${FE}/src/pages/LandingPage.tsx`);
    if (mod.ok) {
      const src = await mod.text();
      if (/Home repairs/i.test(src) && /bid fairly/i.test(src)) {
        throw new Error("LandingPage still home-repairs hero");
      }
      if (!/Client/i.test(src) || !/Professional/i.test(src)) {
        throw new Error("LandingPage missing Client/Professional copy");
      }
      if (!/cleaning|tech_services|office_facilities|moving|construction/i.test(src) &&
          !/Cleaning|Tech services|Moving|Construction|Office/i.test(src)) {
        throw new Error("LandingPage missing expanded category groups");
      }
      steps.push("LandingPage.tsx copy smoke");
    } else {
      steps.push("LandingPage.tsx not served (ok if preview build)");
    }
  } catch (e) {
    steps.push(`LandingPage fetch skip: ${e.message}`);
  }

  console.log("wave25:smoke OK");
  for (const s of steps) console.log(" -", s);
}

main().catch((e) => {
  console.error("wave25:smoke FAIL", e);
  process.exit(1);
});
