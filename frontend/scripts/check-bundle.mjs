// Fails the build if key chunks grow past their budgets (raw, minified bytes). Run after `vite build`.
import fs from "node:fs";
import path from "node:path";

const dir = path.resolve(import.meta.dirname, "../dist/assets");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
const KB = 1024;
const budgets = [
  { chunk: "index", max: 60 * KB, why: "app shell loaded on every page" },
  { chunk: "react-vendor", max: 300 * KB, why: "React + router" },
  { chunk: "CreateJobPage", max: 40 * KB, why: "job wizard; Leaflet must stay lazy" },
  { chunk: "JobDetailPage", max: 120 * KB, why: "client job page" },
];

let failed = false;
for (const b of budgets) {
  const file = files.find((f) => f.startsWith(`${b.chunk}-`));
  if (!file) {
    console.error(`✗ no chunk named ${b.chunk}`);
    failed = true;
    continue;
  }
  const size = fs.statSync(path.join(dir, file)).size;
  const ok = size <= b.max;
  failed ||= !ok;
  console.log(`${ok ? "✓" : "✗"} ${b.chunk.padEnd(14)} ${(size / KB).toFixed(1).padStart(6)} kB / ${b.max / KB} kB  (${b.why})`);
}
const entry = files.find((f) => f.startsWith("index-"));
if (entry && /leaflet\.css|L\.tileLayer/.test(fs.readFileSync(path.join(dir, entry), "utf8"))) {
  console.error("✗ Leaflet ended up in the entry chunk");
  failed = true;
}
process.exit(failed ? 1 : 0);
