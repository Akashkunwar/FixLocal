import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { config, loadConfig, overrideConfig, type AppConfig } from "../src/config";
import { LocalStore, S3Store, blobStore, type BlobStore } from "../src/services/storage";
import { api, client, jobInput, png, tempFileCount, uploadedFileCount } from "./helpers";

async function readAll(store: BlobStore, name: string): Promise<string | null> {
  const f = await store.open(name);
  if (!f) return null;
  const chunks: Buffer[] = [];
  for await (const c of f.body) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString();
}

function tempFile(text: string) {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fl-store-")), "f.txt");
  fs.writeFileSync(p, text);
  return p;
}

/** Every store behaves the same: put moves the temp file, open/exists/copy/remove work, missing is null. */
async function contract(store: BlobStore) {
  const tmp = tempFile("hello");
  await store.putFile("a.txt", tmp, "text/plain");
  expect(fs.existsSync(tmp)).toBe(false);
  expect(await store.exists("a.txt")).toBe(true);
  expect(await readAll(store, "a.txt")).toBe("hello");
  await store.copy("a.txt", "b.txt");
  expect(await readAll(store, "b.txt")).toBe("hello");
  await store.remove("a.txt");
  await store.remove("a.txt"); // idempotent
  expect(await store.exists("a.txt")).toBe(false);
  expect(await store.open("a.txt")).toBeNull();
  await store.remove("b.txt");
}

describe("file storage", () => {
  it("local store meets the storage contract", async () => {
    await contract(new LocalStore(fs.mkdtempSync(path.join(os.tmpdir(), "fl-local-"))));
  });

  it("STORAGE_DRIVER=s3 needs a bucket, and keys come in pairs", () => {
    const base = { JWT_SECRET: "x" };
    expect(loadConfig(base).storageDriver).toBe("local");
    expect(() => loadConfig({ ...base, STORAGE_DRIVER: "s3" })).toThrow(/S3_BUCKET/);
    expect(() => loadConfig({ ...base, STORAGE_DRIVER: "s3", S3_BUCKET: "b", S3_ACCESS_KEY_ID: "k" })).toThrow(
      /S3_SECRET_ACCESS_KEY/
    );
    expect(loadConfig({ ...base, STORAGE_DRIVER: "s3", S3_BUCKET: "b", S3_ENDPOINT: "https://r2.example" }).s3).toMatchObject({
      bucket: "b",
      endpoint: "https://r2.example",
      region: "auto",
    });
  });
});

// Runs against any S3-compatible server when S3_TEST_ENDPOINT is set (CI starts a local one).
const endpoint = process.env.S3_TEST_ENDPOINT;
describe.skipIf(!endpoint)("S3 storage", () => {
  const bucket = `fixlocal-test-${Date.now()}`;
  const s3: NonNullable<AppConfig["s3"]> = {
    bucket,
    region: "us-east-1",
    endpoint: endpoint || null,
    accessKeyId: "test",
    secretAccessKey: "test",
    forcePathStyle: true,
    prefix: "uploads/",
  };
  let saved: AppConfig;

  beforeAll(async () => {
    const raw = new S3Client({ region: s3.region, endpoint: s3.endpoint!, forcePathStyle: true, credentials: { accessKeyId: "test", secretAccessKey: "test" } });
    await raw.send(new CreateBucketCommand({ Bucket: bucket }));
    saved = config();
  });

  afterAll(() => overrideConfig({ storageDriver: saved.storageDriver, s3: saved.s3 }));

  it("meets the storage contract", async () => {
    await contract(new S3Store(s3));
  });

  it("uploads go to the bucket, are served through the API, and nothing lands on local disk", async () => {
    overrideConfig({ storageDriver: "s3", s3 });
    expect(blobStore().driver).toBe("s3");
    const c = await client();
    const before = await uploadedFileCount();
    const req = api().post("/api/jobs").set(c.auth);
    for (const [k, v] of Object.entries(jobInput())) req.field(k, String(v));
    const res = await req.attach("photos", await png(), { filename: "p.png", contentType: "image/png" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const url: string = res.body.job.photoUrls[0];
    const name = url.split("/api/files/")[1].split("?")[0];
    expect(await blobStore().exists(name)).toBe(true);
    expect(await uploadedFileCount()).toBe(before);
    expect(await tempFileCount()).toBe(0);
    const file = await api().get(url).buffer(true);
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toBe("image/png");
    expect((file.body as Buffer).subarray(1, 4).toString()).toBe("PNG");
    overrideConfig({ storageDriver: saved.storageDriver, s3: saved.s3 });
  });
});
