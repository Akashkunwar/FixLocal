/** Wave 29 API/UI smoke: case studies, pro visit-day, job cadence. */
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

  // Case studies may only reference files uploaded to FixLocal (H-10): upload two photos first.
  const zlib = await import("zlib");
  const png = (shade) => {
    const crcTable = Array.from({ length: 256 }, (_, n) => {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    });
    const crc = (b) => {
      let c = 0xffffffff;
      for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    };
    const chunk = (type, data) => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length);
      const td = Buffer.concat([Buffer.from(type), data]);
      const c = Buffer.alloc(4);
      c.writeUInt32BE(crc(td));
      return Buffer.concat([len, td, c]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(4, 0);
    ihdr.writeUInt32BE(4, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    const raw = Buffer.concat(Array.from({ length: 4 }, () => Buffer.from([0, ...Array(12).fill(shade)])));
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", zlib.deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  };
  const galleryFd = new FormData();
  galleryFd.append("photos", new Blob([png(40)], { type: "image/png" }), "before.png");
  galleryFd.append("photos", new Blob([png(200)], { type: "image/png" }), "after.png");
  const galleryRes = await fetch(`${API}/api/profile/gallery`, {
    method: "POST",
    headers: { Authorization: `Bearer ${pro.token}` },
    body: galleryFd,
  });
  if (!galleryRes.ok) throw new Error(`gallery upload → ${galleryRes.status}`);
  const gallery = (await galleryRes.json()).profile.galleryUrls;
  const [beforeUrl, afterUrl] = gallery.slice(-2);
  steps.push("uploaded before/after photos");

  // Case studies upsert on profile
  const caseId = `smoke-case-${Date.now()}`;
  const updated = await apiOk("/api/profile", {
    method: "PATCH",
    token: pro.token,
    body: {
      caseStudies: [
        {
          id: caseId,
          title: "Kitchen leak before/after",
          notes: "Replaced angle valve; no drip after 24h.",
          beforeUrl,
          afterUrl,
          category: "plumbing",
        },
      ],
    },
  });
  const cases = updated.profile?.caseStudies || [];
  if (!cases.some((c) => c.id === caseId && c.title.includes("Kitchen"))) {
    throw new Error("caseStudies not persisted on profile");
  }
  steps.push("PATCH caseStudies");

  const pub = await apiOk(`/api/profile/user/${pro.user.id}`, {
    token: home.token,
  });
  const pubCases = pub.profile?.caseStudies || [];
  if (!pubCases.some((c) => c.id === caseId)) {
    throw new Error("caseStudies missing on public profile");
  }
  steps.push("public profile exposes caseStudies");

  // Soft cadence on create job (multipart-ish via JSON may fail — use FormData)
  const fd = new FormData();
  fd.append("title", `Wave29 cadence smoke ${Date.now()}`);
  fd.append(
    "description",
    "Soft recurring preference smoke test for AMC interest on office cleaning."
  );
  fd.append("category", "cleaning");
  fd.append("siteType", "office");
  fd.append("cadence", "amc");
  fd.append("cadenceNote", "Annual deep clean + quarterly touch-ups");
  fd.append("city", "Bengaluru");
  fd.append("budgetMin", "2000");
  fd.append("budgetMax", "5000");

  const createRes = await fetch(`${API}/api/jobs`, {
    method: "POST",
    headers: { Authorization: `Bearer ${home.token}` },
    body: fd,
  });
  const createText = await createRes.text();
  let created;
  try {
    created = JSON.parse(createText);
  } catch {
    created = { raw: createText };
  }
  if (!createRes.ok) {
    throw new Error(`POST /api/jobs → ${createRes.status} ${createText}`);
  }
  const job = created.job;
  if (!job?.id) throw new Error("create job missing id");
  if (job.cadence !== "amc") {
    throw new Error(`expected cadence amc, got ${JSON.stringify(job.cadence)}`);
  }
  if (!String(job.cadenceNote || "").includes("Annual")) {
    throw new Error("cadenceNote not stored");
  }
  steps.push("POST job with cadence=amc + note");

  const got = await apiOk(`/api/jobs/${job.id}`, { token: home.token });
  if (got.job?.cadence !== "amc") {
    throw new Error("GET job lost cadence");
  }
  steps.push("GET job keeps cadence");

  // Invalid cadence soft-falls to one_time on update
  const updFd = new FormData();
  updFd.append("cadence", "weekly");
  updFd.append("cadenceNote", "Every Monday");
  const updRes = await fetch(`${API}/api/jobs/${job.id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${home.token}` },
    body: updFd,
  });
  const updText = await updRes.text();
  let upd;
  try {
    upd = JSON.parse(updText);
  } catch {
    upd = { raw: updText };
  }
  if (!updRes.ok) {
    // Some installs may not expose PATCH multipart — try JSON
    const j = await api(`/api/jobs/${job.id}`, {
      method: "PATCH",
      token: home.token,
      body: { cadence: "weekly", cadenceNote: "Every Monday" },
    });
    if (!j.ok) {
      throw new Error(`PATCH job cadence failed ${updRes.status}/${j.status}`);
    }
    if (j.data.job?.cadence !== "weekly") {
      throw new Error("JSON PATCH cadence not weekly");
    }
    steps.push("PATCH job cadence=weekly (json)");
  } else {
    if (upd.job?.cadence !== "weekly") {
      throw new Error("PATCH cadence not weekly");
    }
    steps.push("PATCH job cadence=weekly");
  }

  // Source IA smoke
  const checks = [
    [
      "src/lib/caseStudies.ts",
      ["CaseStudy", "normalizeCaseStudies", "newCaseStudyId"],
    ],
    [
      "src/lib/jobCadence.ts",
      ["CADENCE_OPTIONS", "cadenceLabel", "normalizeCadence", "amc"],
    ],
    [
      "src/lib/visitPrep.ts",
      ["proVisitDayItems", "loadProVisitDayChecks", "Pack tools"],
    ],
    [
      "src/components/ProVisitDayCard.tsx",
      ["Visit-day checklist", "ProVisitDayCard", "proVisitDayItems"],
    ],
    [
      "src/components/VisitPrepCard.tsx",
      ["Visit prep", "VisitPrepCard"],
    ],
    [
      "src/pages/tradesperson/ProfilePage.tsx",
      ["Past work case studies", "caseStudies", "Add case study"],
    ],
    [
      "src/pages/ProPublicPage.tsx",
      ["Past work", "normalizeCaseStudies", "Before · After"],
    ],
    [
      "src/pages/homeowner/CreateJobPage.tsx",
      ["Job cadence", "CADENCE_OPTIONS", "aria-pressed", "cadenceNote"],
    ],
    [
      "src/pages/tradesperson/ProJobDetailPage.tsx",
      ["ProVisitDayCard", "cadenceLabel"],
    ],
    [
      "src/pages/homeowner/JobDetailPage.tsx",
      ["Cadence preference", "cadenceLabel"],
    ],
  ];

  for (const [rel, needles] of checks) {
    const src = read(rel);
    for (const n of needles) {
      if (!src.includes(n)) throw new Error(`${rel} missing ${JSON.stringify(n)}`);
    }
    steps.push(`${rel} IA smoke`);
  }

  const feHosts = [FE, "http://127.0.0.1:5173", "http://localhost:5173", "http://[::1]:5173"];
  let feOk = false;
  let feTried = [];
  for (const base of [...new Set(feHosts)]) {
    try {
      const htmlRes = await fetch(base + "/");
      feTried.push(`${base}→${htmlRes.status}`);
      if (htmlRes.ok) {
        feOk = true;
        steps.push(`FE index reachable (${base})`);
        break;
      }
    } catch (e) {
      feTried.push(`${base}→${e.cause?.code || e.message}`);
    }
  }
  if (!feOk) throw new Error(`FE unreachable: ${feTried.join("; ")}`);

  console.log("wave29:smoke OK");
  for (const s of steps) console.log(" -", s);
}

main().catch((e) => {
  console.error("wave29:smoke FAIL", e);
  process.exit(1);
});
