import zlib from "node:zlib";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const PASSWORD = "E2e-Password-123";
export const NEW_PASSWORD = "Another-Pass-456";
export const SEEDED = {
  admin: "admin@fixlocal.local",
  client: "home@fixlocal.local",
  client2: "home2@fixlocal.local",
  pro: "pro@fixlocal.local",
  pro2: "pro2@fixlocal.local",
  pendingPro: "pro3@fixlocal.local",
};

let counter = 0;
export const uniqueEmail = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${++counter}@e2e.test`;

type Role = "HOMEOWNER" | "TRADESPERSON";
export type ApiUser = { id: string; email: string; token: string; role: string };

/** Sign in through the API (setup only); returns a bearer token. */
export async function apiLogin(request: APIRequestContext, email: string, password = PASSWORD): Promise<ApiUser> {
  const res = await request.post("/api/auth/login", { data: { email, password } });
  expect(res.status(), await res.text()).toBe(200);
  const body = await res.json();
  return { id: body.user.id, email, token: body.token, role: body.user.role };
}

export async function apiCall<T = Record<string, unknown>>(
  request: APIRequestContext,
  who: ApiUser,
  method: "get" | "post" | "patch" | "put" | "delete",
  url: string,
  data?: unknown
): Promise<T> {
  const res = await request[method](url, { headers: { Authorization: `Bearer ${who.token}` }, data });
  const text = await res.text();
  expect(res.ok(), `${method.toUpperCase()} ${url} → ${res.status()} ${text}`).toBe(true);
  return (text ? JSON.parse(text) : {}) as T;
}

/** The newest verification / reset link sent to an address by the dev mailer. */
export async function mailLink(request: APIRequestContext, to: string, kind: "verify-email" | "reset-password") {
  let link: string | undefined;
  await expect
    .poll(async () => {
      const res = await request.get("/api/dev/outbox");
      const { emails } = (await res.json()) as { emails: { to: string; text: string }[] };
      const mail = emails.find((m) => m.to === to && m.text.includes(`/${kind}?token=`));
      link = mail?.text.match(/https?:\/\/\S+/)?.[0];
      return link;
    })
    .toBeTruthy();
  return new URL(link!).pathname + new URL(link!).search;
}

export async function registerViaApi(request: APIRequestContext, role: Role, name: string) {
  const email = uniqueEmail(role === "HOMEOWNER" ? "client" : "pro");
  const res = await request.post("/api/auth/register", { data: { email, password: PASSWORD, role, name } });
  expect(res.status(), await res.text()).toBe(201);
  const body = await res.json();
  const path = await mailLink(request, email, "verify-email");
  const token = new URLSearchParams(path.split("?")[1]).get("token");
  expect((await request.post("/api/auth/verify-email", { data: { token } })).status()).toBe(200);
  return { id: body.user.id as string, email, token: body.token as string, role };
}

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

export async function logout(page: Page) {
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login/);
}

/** A job the client posted through the API, open for bids. */
export async function postJob(request: APIRequestContext, client: ApiUser, overrides: Record<string, unknown> = {}) {
  const body = await apiCall<{ job: { id: string; title: string } }>(request, client, "post", "/api/jobs", {
    title: `E2E leaking tap ${Date.now().toString(36)}`,
    description: "The kitchen tap drips all night and the washer needs replacing.",
    category: "plumbing",
    budgetMin: 500,
    budgetMax: 3000,
    address: "12 MG Road",
    city: "Bengaluru",
    area: "Indiranagar",
    lat: 12.9719,
    lng: 77.6412,
    ...overrides,
  });
  return body.job;
}

/** A small valid PNG (solid colour) generated without extra dependencies. */
export function pngBytes(seed = 0): Buffer {
  const w = 8;
  const h = 8;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = (seed * 40 + x * 20) & 255;
      raw[o + 1] = (y * 30) & 255;
      raw[o + 2] = 128;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export const pdfBytes = () => Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

/** Map tiles are third-party; tests don't need them. */
export async function blockMapTiles(page: Page) {
  await page.route(/tile\.openstreetmap\.org|basemaps|tiles?\./, (route) => route.abort());
}

/** Post a job, have `pro` bid, and accept that bid — the job ends up "awarded". */
export async function awardedJob(request: APIRequestContext, client: ApiUser, pro: ApiUser, amount = 3000) {
  const job = await postJob(request, client);
  const { bid } = await apiCall<{ bid: { id: string; quoteRevision: number } }>(request, pro, "post", `/api/jobs/${job.id}/bids`, {
    amount,
  });
  const res = await request.post(`/api/bids/${bid.id}/accept`, {
    headers: { Authorization: `Bearer ${client.token}`, "Idempotency-Key": `e2e-${bid.id}` },
    data: { expectedAmount: amount, expectedRevision: bid.quoteRevision },
  });
  expect(res.status(), await res.text()).toBe(200);
  return { job, bid };
}
