import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { api, awardedJob, client, jobInput, jpegWithGps, pdf, png, pro, tempFileCount, uploadedFileCount } from "./helpers";

const postJobWith = (auth: Record<string, string>, file: Buffer, name: string, contentType: string) => {
  const req = api().post("/api/jobs").set(auth);
  for (const [k, v] of Object.entries(jobInput())) req.field(k, String(v));
  return req.attach("photos", file, { filename: name, contentType });
};

const fileName = (url: string) => url.split("/api/files/")[1].split("?")[0];

describe("upload validation (C-4)", () => {
  it("rejects HTML disguised as an image and leaves nothing on disk", async () => {
    const c = await client();
    const before = await uploadedFileCount();
    const res = await postJobWith(c.auth, Buffer.from("<script>alert(document.domain)</script>"), "x.html", "image/png");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("UNSUPPORTED_FILE");
    expect(await uploadedFileCount()).toBe(before);
    expect(await tempFileCount()).toBe(0);
  });

  it("rejects SVG and declared non-image types", async () => {
    const c = await client();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect((await postJobWith(c.auth, svg, "a.svg", "image/svg+xml")).status).toBe(400);
    expect((await postJobWith(c.auth, Buffer.from("MZ"), "a.exe", "application/octet-stream")).status).toBe(400);
  });

  it("rejects a PNG header followed by junk", async () => {
    const c = await client();
    const fake = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("<html>")]);
    const res = await postJobWith(c.auth, fake, "fake.png", "image/png");
    expect(res.status).toBe(400);
    expect(await tempFileCount()).toBe(0);
  });

  it("re-encodes images with server-chosen names and strips GPS metadata (M-12)", async () => {
    const c = await client();
    const res = await postJobWith(c.auth, await jpegWithGps(), "../../evil name.html", "image/jpeg");
    expect(res.status).toBe(201);
    const url: string = res.body.job.photoUrls[0];
    expect(fileName(url)).toMatch(/^[0-9a-f-]{36}\.jpg$/);
    const file = await api().get(url);
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toBe("image/jpeg");
    expect(file.headers["x-content-type-options"]).toBe("nosniff");
    const meta = await sharp(file.body as Buffer).metadata();
    expect(meta.exif).toBeUndefined();
  });

  it("serves PDFs as downloads", async () => {
    const c = await client();
    const res = await postJobWith(c.auth, pdf(), "quote.pdf", "application/pdf");
    expect(res.status).toBe(201);
    const file = await api().get(res.body.job.photoUrls[0]);
    expect(file.headers["content-disposition"]).toMatch(/^attachment/);
  });

  it("rejects files over 5 MB", async () => {
    const c = await client();
    const big = Buffer.concat([await png(), Buffer.alloc(6 * 1024 * 1024)]);
    const res = await postJobWith(c.auth, big, "big.png", "image/png");
    expect(res.status).toBe(413);
    expect(await tempFileCount()).toBe(0);
  });
});

describe("file access (C-4)", () => {
  it("requires a valid signature or an authorized bearer token", async () => {
    const owner = await client();
    const res = await postJobWith(owner.auth, await png(), "p.png", "image/png");
    const signed: string = res.body.job.photoUrls[0];
    const bare = `/api/files/${fileName(signed)}`;

    expect((await api().get(signed)).status).toBe(200);
    expect((await api().get(bare)).status).toBe(401);
    expect((await api().get(`${bare}?exp=9999999999&sig=forged`)).status).toBe(401);
    const expired = signed.replace(/exp=\d+/, "exp=1000");
    expect((await api().get(expired)).status).toBe(401);
    expect((await api().get(bare).set(owner.auth)).status).toBe(200);
    expect((await api().get(bare).set((await client()).auth)).status).toBe(403);
    // Verified pros can see an open job's photos.
    expect((await api().get(bare).set((await pro()).auth)).status).toBe(200);
    // Legacy /uploads path goes through the same checks.
    expect((await api().get(`/uploads/${fileName(signed)}`)).status).toBe(401);
    expect((await api().get("/api/files/..%2F..%2Fpackage.json")).status).toBe(404);
  });

  it("completion photos are private to the parties, and nobody else can upload them", async () => {
    const { owner, worker, job } = await awardedJob({ stage: "in_progress" });
    const outsider = await client();
    const before = await uploadedFileCount();
    const denied = await api()
      .post(`/api/jobs/${job.id}/completion-photos`)
      .set(outsider.auth)
      .attach("after", await png(), { filename: "a.png", contentType: "image/png" });
    expect(denied.status).toBe(403);
    expect(await uploadedFileCount()).toBe(before);
    expect(await tempFileCount()).toBe(0);

    const ok = await api()
      .post(`/api/jobs/${job.id}/completion-photos`)
      .set(worker.auth)
      .attach("before", await png(), { filename: "b.png", contentType: "image/png" })
      .attach("after", await png(), { filename: "a.png", contentType: "image/png" });
    expect(ok.status).toBe(200);
    const afterUrl: string = ok.body.added.after[0];
    const bare = `/api/files/${fileName(afterUrl)}`;
    expect((await api().get(bare).set(owner.auth)).status).toBe(200);
    expect((await api().get(bare).set((await pro()).auth)).status).toBe(403);

    // The client can't delete the pro's evidence.
    const del = await api().delete(`/api/jobs/${job.id}/completion-photos`).set(owner.auth).send({ url: afterUrl, kind: "after" });
    expect(del.body.code).toBe("NOT_UPLOADER");
    const mine = await api().delete(`/api/jobs/${job.id}/completion-photos`).set(worker.auth).send({ url: afterUrl, kind: "after" });
    expect(mine.status).toBe(200);
    expect((await api().get(bare).set(owner.auth)).status).toBe(404);
  });

  it("evidence can't be removed during a dispute (M-7)", async () => {
    const { owner, worker, job } = await awardedJob({ stage: "in_progress" });
    const up = await api()
      .post(`/api/jobs/${job.id}/completion-photos`)
      .set(worker.auth)
      .attach("after", await png(), { filename: "a.png", contentType: "image/png" });
    await api().post(`/api/jobs/${job.id}/disputes`).set(owner.auth).field("reason", "Bad work").expect(201);
    const res = await api()
      .delete(`/api/jobs/${job.id}/completion-photos`)
      .set(worker.auth)
      .send({ url: up.body.added.after[0], kind: "after" });
    expect(res.body.code).toBe("EVIDENCE_LOCKED");
  });

  it("dispute evidence is visible to parties only", async () => {
    const { owner, worker, job } = await awardedJob({ stage: "in_progress" });
    const res = await api()
      .post(`/api/jobs/${job.id}/disputes`)
      .set(owner.auth)
      .field("reason", "Leak is back")
      .attach("evidence", await png(), { filename: "leak.png", contentType: "image/png" })
      .attach("evidence", pdf(), { filename: "invoice.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(201);
    expect(res.body.dispute.evidenceUrls).toHaveLength(2);
    const bare = `/api/files/${fileName(res.body.dispute.evidenceUrls[0])}`;
    expect((await api().get(bare)).status).toBe(401);
    expect((await api().get(bare).set(worker.auth)).status).toBe(200);
    expect((await api().get(bare).set((await pro()).auth)).status).toBe(403);
  });

  it("gallery photos are public; licence documents are private", async () => {
    const p = await pro();
    const gallery = await api()
      .post("/api/profile/gallery")
      .set(p.auth)
      .attach("photos", await png(), { filename: "g.png", contentType: "image/png" });
    expect(gallery.status).toBe(200);
    const g: string = gallery.body.profile.galleryUrls[0];
    expect(g).not.toContain("sig=");
    expect((await api().get(g)).status).toBe(200);

    const lic = await api().post("/api/profile/license").set(p.auth).attach("file", pdf(), { filename: "id.pdf", contentType: "application/pdf" });
    expect(lic.status).toBe(200);
    const bare = `/api/files/${fileName(lic.body.profile.licenseDocUrl)}`;
    expect((await api().get(bare)).status).toBe(401);
    expect((await api().get(bare).set((await client()).auth)).status).toBe(403);
    expect((await api().get(bare).set(p.auth)).status).toBe(200);
    const pub = await api().get(`/api/profile/user/${p.user.id}`).set((await client()).auth);
    expect(pub.body.profile).not.toHaveProperty("licenseDocUrl");

    const removed = await api().delete("/api/profile/gallery").set(p.auth).send({ url: g });
    expect(removed.body.profile.galleryUrls).toEqual([]);
    expect((await api().get(g)).status).toBe(404);
  });

  it("profiles can't reference files that aren't theirs or external URLs", async () => {
    const p = await pro();
    const other = await pro();
    const up = await api().post("/api/profile/gallery").set(other.auth).attach("photos", await png(), { filename: "g.png", contentType: "image/png" });
    const theirs = up.body.profile.galleryUrls[0];
    const cases = [
      { galleryUrls: ["https://evil.example/x.png"] },
      { galleryUrls: [theirs] },
      { caseStudies: [{ id: "c1", title: "Stolen", beforeUrl: theirs }] },
      { caseStudies: [{ id: "c1", title: "External", beforeUrl: "javascript:alert(1)" }] },
    ];
    for (const body of cases) {
      const res = await api().patch("/api/profile").set(p.auth).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("job photos can be removed by the owner (file deleted)", async () => {
    const c = await client();
    const created = await postJobWith(c.auth, await png(), "p.png", "image/png");
    const job = created.body.job;
    const url = job.photoUrls[0].split("?")[0];
    const res = await api().patch(`/api/jobs/${job.id}`).set(c.auth).send({ removePhotoUrls: [url] });
    expect(res.body.job.photoUrls).toEqual([]);
    expect((await api().get(url).set(c.auth)).status).toBe(404);
    const other = await client();
    const before = await uploadedFileCount();
    const denied = await api()
      .patch(`/api/jobs/${job.id}`)
      .set(other.auth)
      .attach("photos", await png(), { filename: "x.png", contentType: "image/png" });
    expect(denied.status).toBe(403);
    expect(await uploadedFileCount()).toBe(before);
  });
});
