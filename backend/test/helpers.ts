import crypto from "crypto";
import http from "http";
import bcrypt from "bcryptjs";
import request from "supertest";
import sharp from "sharp";
import type { Express } from "express";
import { createApp } from "../src/app";
import { AppDataSource } from "../src/data-source";
import { User, UserRole } from "../src/entities/User";
import { TradespersonProfile, VerificationStatus } from "../src/entities/TradespersonProfile";
import { signAccessToken } from "../src/auth/tokens";
import { invalidateAuthState } from "../src/auth/authState";

export const PASSWORD = "Correct-Horse-42";
// Hash once (cost 4) so factories stay fast; login still exercises bcrypt.compare.
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);

let appInstance: Express | null = null;
export function app(): Express {
  if (!appInstance) appInstance = createApp();
  return appInstance;
}

/**
 * Test servers bind to 127.0.0.1 explicitly. Letting supertest listen on all interfaces and then
 * connect to 127.0.0.1 occasionally hit another local program that owned the same port number on
 * 127.0.0.1 (seen as random 401/404 responses with empty bodies).
 * Binding to a host is asynchronous, so always wait for "listening" before using the address.
 */
export function listenLocal(): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const s = http.createServer(app());
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => resolve(s));
  });
}

let server: http.Server | null = null;

/** Started once per test file by test/setup.ts. */
export async function startTestServer() {
  if (!server) server = await listenLocal();
  return server;
}

export function testServer(): http.Server {
  if (!server) throw new Error("Test server not started; test/setup.ts starts it in beforeAll");
  return server;
}

export async function closeTestServer() {
  if (!server) return;
  const s = server;
  server = null;
  s.closeAllConnections();
  await new Promise<void>((resolve) => s.close(() => resolve()));
}

export const api = () => request(testServer());

export type TestUser = { user: User; token: string; auth: { Authorization: string } };

let seq = 0;
export function uniqueEmail(prefix = "user") {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}@test.fixlocal`;
}

export async function makeUser(
  role: UserRole,
  opts: {
    name?: string;
    verified?: boolean;
    proStatus?: VerificationStatus;
    suspended?: boolean;
    profile?: Partial<TradespersonProfile>;
    email?: string;
  } = {}
): Promise<TestUser> {
  const repo = AppDataSource.getRepository(User);
  const user = await repo.save(
    repo.create({
      email: opts.email || uniqueEmail(role.toLowerCase()),
      passwordHash: PASSWORD_HASH,
      role,
      name: opts.name || `${role.toLowerCase()} ${seq}`,
      phone: "+91 90000 00000",
      emailVerifiedAt: opts.verified === false ? null : new Date(),
      isSuspended: !!opts.suspended,
    })
  );
  if (role === UserRole.TRADESPERSON) {
    const profiles = AppDataSource.getRepository(TradespersonProfile);
    await profiles.save(
      profiles.create({
        userId: user.id,
        galleryUrls: [],
        skills: "Plumbing, leak repair, pipe fitting",
        city: "Bengaluru",
        serviceAreas: "Indiranagar, Koramangala",
        lat: 12.9784,
        lng: 77.6408,
        verificationStatus: opts.proStatus ?? VerificationStatus.VERIFIED,
        verifiedAt: new Date(),
        ...opts.profile,
      })
    );
  }
  const token = signAccessToken(user);
  return { user, token, auth: { Authorization: `Bearer ${token}` } };
}

export const client = (opts?: Parameters<typeof makeUser>[1]) => makeUser(UserRole.HOMEOWNER, opts);
export const pro = (opts?: Parameters<typeof makeUser>[1]) => makeUser(UserRole.TRADESPERSON, opts);
export const admin = (opts?: Parameters<typeof makeUser>[1]) => makeUser(UserRole.ADMIN, opts);

/** Re-issue a token after the user's tokenVersion changed. */
export async function refreshToken(u: TestUser): Promise<TestUser> {
  const user = await AppDataSource.getRepository(User).findOneOrFail({ where: { id: u.user.id } });
  await invalidateAuthState(user.id);
  const token = signAccessToken(user);
  return { user, token, auth: { Authorization: `Bearer ${token}` } };
}

export const jobInput = (overrides: Record<string, unknown> = {}) => ({
  title: "Fix leaking kitchen tap",
  description: "Tap drips all night; washer probably worn out.",
  category: "plumbing",
  budgetMin: 500,
  budgetMax: 2000,
  address: "12 Private Lane, Flat 4B",
  area: "Indiranagar",
  city: "Bengaluru",
  pincode: "560038",
  lat: 12.97891,
  lng: 77.64091,
  ...overrides,
});

export async function createJob(owner: TestUser, overrides: Record<string, unknown> = {}) {
  const res = await api().post("/api/jobs").set(owner.auth).send(jobInput(overrides));
  if (res.status !== 201) throw new Error(`createJob failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.job as { id: string; [k: string]: unknown };
}

export async function placeBid(p: TestUser, jobId: string, body: Record<string, unknown> = { amount: 1500 }) {
  const res = await api().post(`/api/jobs/${jobId}/bids`).set(p.auth).send(body);
  if (res.status !== 201) throw new Error(`placeBid failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.bid as { id: string; quoteRevision: number; amount: number; quoteAmount: number | null };
}

/** Accept with the amount/revision the client currently sees. */
export async function acceptBid(owner: TestUser, bidId: string) {
  const bid = await AppDataSource.query(`SELECT "amount", "quoteAmount", "quoteRevision" FROM "bids" WHERE "id" = $1`, [bidId]);
  const expectedAmount = Number(bid[0].quoteAmount ?? bid[0].amount);
  return api()
    .post(`/api/bids/${bidId}/accept`)
    .set(owner.auth)
    .send({ expectedAmount, expectedRevision: bid[0].quoteRevision });
}

/** Open job → accepted bid → optional start / mark-done. */
export async function awardedJob(
  opts: { stage?: "awarded" | "in_progress" | "pending_confirmation" | "completed"; amount?: number } = {}
) {
  const owner = await client();
  const worker = await pro();
  const job = await createJob(owner);
  const bid = await placeBid(worker, job.id, { amount: opts.amount ?? 1000 });
  const accepted = await acceptBid(owner, bid.id);
  if (accepted.status !== 200) throw new Error(`accept failed: ${JSON.stringify(accepted.body)}`);
  const stage = opts.stage ?? "awarded";
  if (stage !== "awarded") {
    await api().post(`/api/jobs/${job.id}/start`).set(worker.auth).expect(200);
  }
  if (stage === "pending_confirmation" || stage === "completed") {
    await api().post(`/api/jobs/${job.id}/mark-done`).set(worker.auth).expect(200);
  }
  if (stage === "completed") {
    await api().post(`/api/jobs/${job.id}/confirm`).set(owner.auth).expect(200);
  }
  return { owner, worker, job, bid };
}

export async function jpegWithGps(): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 200, g: 80, b: 40 } } })
    .jpeg()
    .withExif({
      IFD0: { Make: "TestCam", Model: "LeakyPhone" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "12/1 58/1 43/1", GPSLongitudeRef: "E", GPSLongitude: "77/1 38/1 27/1" },
    })
    .toBuffer();
}

export async function png(): Promise<Buffer> {
  return sharp({ create: { width: 20, height: 20, channels: 4, background: { r: 0, g: 128, b: 255, alpha: 1 } } })
    .png()
    .toBuffer();
}

export const pdf = () => Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

export const randomId = () => crypto.randomUUID();

export async function uploadedFileCount(): Promise<number> {
  const fs = await import("fs");
  const dir = process.env.UPLOADS_DIR!;
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((f) => !f.startsWith(".")).length;
}

export async function tempFileCount(): Promise<number> {
  const fs = await import("fs");
  const path = await import("path");
  const dir = path.join(process.env.UPLOADS_DIR!, ".tmp");
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).length;
}

export async function rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return AppDataSource.query(sql, params);
}
