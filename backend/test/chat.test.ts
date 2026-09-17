import { describe, expect, it } from "vitest";
import type { AddressInfo } from "net";
import { acceptBid, admin, api, app, client, createJob, placeBid, png, pro } from "./helpers";

async function openJobWithTwoBidders() {
  const owner = await client();
  const p1 = await pro({ name: "Pro One" });
  const p2 = await pro({ name: "Pro Two" });
  const job = await createJob(owner);
  const b1 = await placeBid(p1, job.id);
  const b2 = await placeBid(p2, job.id);
  return { owner, p1, p2, job, b1, b2 };
}

describe("private chat threads (H-2)", () => {
  it("each pro only sees their own conversation", async () => {
    const { owner, p1, p2, job } = await openJobWithTwoBidders();
    await api().post(`/api/messages/${job.id}`).set(p1.auth).send({ body: "PRO1 PRIVATE: I can go down to 1800" }).expect(201);
    await api().post(`/api/messages/${job.id}?pro=${p2.user.id}`).set(owner.auth).send({ body: "Hi pro two" }).expect(201);

    const asP2 = await api().get(`/api/messages/${job.id}`).set(p2.auth);
    expect(asP2.body.messages.map((m: { body: string }) => m.body)).toEqual(["Hi pro two"]);
    // Asking for someone else's thread still returns your own.
    const sneaky = await api().get(`/api/messages/${job.id}?pro=${p1.user.id}`).set(p2.auth);
    expect(JSON.stringify(sneaky.body)).not.toContain("PRO1 PRIVATE");

    const asOwner = await api().get(`/api/messages/${job.id}?pro=${p1.user.id}`).set(owner.auth);
    expect(asOwner.body.messages[0].body).toContain("PRO1 PRIVATE");
    expect(asOwner.body.messages[0].sender).toEqual({ id: p1.user.id, name: "Pro One", role: "TRADESPERSON" });

    const threads = await api().get(`/api/messages/${job.id}/threads`).set(owner.auth);
    expect(threads.body.threads).toHaveLength(2);
    const t1 = threads.body.threads.find((t: { tradespersonId: string }) => t.tradespersonId === p1.user.id);
    expect(t1).toMatchObject({ unread: 1, total: 1, access: "write" });
  });

  it("the client must say which pro when the job isn't awarded", async () => {
    const { owner, job } = await openJobWithTwoBidders();
    const res = await api().get(`/api/messages/${job.id}`).set(owner.auth);
    expect(res.body.code).toBe("THREAD_REQUIRED");
    const bad = await api().post(`/api/messages/${job.id}?pro=${(await pro()).user.id}`).set(owner.auth).send({ body: "hi" });
    expect(bad.status).toBe(403);
  });

  it("notifies the other side when the client writes (not just when a pro does)", async () => {
    const { owner, p1, job } = await openJobWithTwoBidders();
    await api().post(`/api/messages/${job.id}?pro=${p1.user.id}`).set(owner.auth).send({ body: "When can you come?" }).expect(201);
    const notes = await api().get("/api/notifications").set(p1.auth);
    expect(notes.body.notifications[0].type).toBe("message");
    await api().post(`/api/messages/${job.id}`).set(p1.auth).send({ body: "Tomorrow" }).expect(201);
    const ownerNotes = await api().get("/api/notifications").set(owner.auth);
    expect(ownerNotes.body.notifications[0].link).toContain(`chat=${p1.user.id}`);
  });

  it("losing bidders lose access after the award; the winner keeps it", async () => {
    const { owner, p1, p2, job, b1 } = await openJobWithTwoBidders();
    await api().post(`/api/messages/${job.id}`).set(p2.auth).send({ body: "pick me" }).expect(201);
    expect((await acceptBid(owner, b1.id)).status).toBe(200);
    expect((await api().get(`/api/messages/${job.id}`).set(p2.auth)).status).toBe(403);
    expect((await api().post(`/api/messages/${job.id}`).set(p2.auth).send({ body: "hello?" })).status).toBe(403);
    expect((await api().get(`/api/messages/${job.id}`).set(p1.auth)).status).toBe(200);
    // Default thread for the client is now the hired pro.
    const def = await api().get(`/api/messages/${job.id}`).set(owner.auth);
    expect(def.body.threadTradespersonId).toBe(p1.user.id);
    // The client can still read the old conversation but not write to it.
    const old = await api().get(`/api/messages/${job.id}?pro=${p2.user.id}`).set(owner.auth);
    expect(old.body.canSend).toBe(false);
  });

  it("admins can read but not write, and reading doesn't mark anything read", async () => {
    const { owner, p1, job } = await openJobWithTwoBidders();
    await api().post(`/api/messages/${job.id}`).set(p1.auth).send({ body: "unread for the client" }).expect(201);
    const a = await admin();
    expect((await api().get(`/api/messages/${job.id}?pro=${p1.user.id}`).set(a.auth)).status).toBe(200);
    expect((await api().post(`/api/messages/${job.id}?pro=${p1.user.id}`).set(a.auth).send({ body: "x" })).status).toBe(403);
    await api().post(`/api/messages/${job.id}/read?pro=${p1.user.id}`).set(a.auth).expect(200);
    const threads = await api().get(`/api/messages/${job.id}/threads`).set(owner.auth);
    expect(threads.body.threads.find((t: { tradespersonId: string }) => t.tradespersonId === p1.user.id).unread).toBe(1);
    await api().post(`/api/messages/${job.id}/read?pro=${p1.user.id}`).set(owner.auth).expect(200);
    const after = await api().get(`/api/messages/${job.id}/threads`).set(owner.auth);
    expect(after.body.threads.find((t: { tradespersonId: string }) => t.tradespersonId === p1.user.id).unread).toBe(0);
  });

  it("supports attachments, quotes, validation and pagination", async () => {
    const { owner, p1, job } = await openJobWithTwoBidders();
    const empty = await api().post(`/api/messages/${job.id}`).set(p1.auth).send({ body: "   " });
    expect(empty.body.code).toBe("EMPTY_MESSAGE");
    const withFile = await api()
      .post(`/api/messages/${job.id}`)
      .set(p1.auth)
      .field("quoteAmount", "1750")
      .field("quoteNotes", "Includes parts")
      .attach("attachments", await png(), { filename: "site.png", contentType: "image/png" });
    expect(withFile.status).toBe(201);
    expect(withFile.body.message.quote).toMatchObject({ amount: 1750, notes: "Includes parts" });
    const file = withFile.body.message.attachmentUrls[0];
    const bare = file.split("?")[0];
    expect((await api().get(bare).set(owner.auth)).status).toBe(200);
    expect((await api().get(bare).set((await pro()).auth)).status).toBe(403);

    const legacy = await api().post(`/api/messages/${job.id}`).set(p1.auth).send({ quote: JSON.stringify({ amount: 900 }) });
    expect(legacy.body.message.quote.amount).toBe(900);

    for (let i = 0; i < 5; i++) {
      await api().post(`/api/messages/${job.id}`).set(p1.auth).send({ body: `msg ${i}` });
    }
    const page1 = await api().get(`/api/messages/${job.id}?pro=${p1.user.id}&limit=3`).set(owner.auth);
    expect(page1.body.messages.map((m: { body: string }) => m.body)).toEqual(["msg 2", "msg 3", "msg 4"]);
    expect(page1.body.hasMore).toBe(true);
    const page2 = await api()
      .get(`/api/messages/${job.id}?pro=${p1.user.id}&limit=3&before=${encodeURIComponent(page1.body.nextBefore)}`)
      .set(owner.auth);
    expect(page2.body.messages.map((m: { body: string }) => m.body)).toEqual(["Quote: ₹900", "msg 0", "msg 1"]);
  });

  it("live updates only reach the right thread (SSE)", async () => {
    const { owner, p1, p2, job } = await openJobWithTwoBidders();
    const server = app().listen(0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const ticketFor = async (auth: Record<string, string>) => (await api().post("/api/auth/sse-ticket").set(auth)).body.ticket;
    const collect = async (url: string) => {
      const ctrl = new AbortController();
      const res = await fetch(url, { signal: ctrl.signal });
      const reader = res.body!.getReader();
      let text = "";
      const pump = (async () => {
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            text += new TextDecoder().decode(value);
          }
        } catch {
          /* aborted */
        }
      })();
      return { status: res.status, stop: () => ctrl.abort(), text: () => text, pump };
    };
    try {
      const s1 = await collect(`${base}/api/messages/${job.id}/stream?ticket=${await ticketFor(p1.auth)}`);
      const s2 = await collect(`${base}/api/messages/${job.id}/stream?ticket=${await ticketFor(p2.auth)}`);
      expect(s1.status).toBe(200);
      expect(s2.status).toBe(200);
      await api().post(`/api/messages/${job.id}?pro=${p1.user.id}`).set(owner.auth).send({ body: "only for pro one" }).expect(201);
      await new Promise((r) => setTimeout(r, 300));
      expect(s1.text()).toContain("only for pro one");
      expect(s2.text()).not.toContain("only for pro one");

      const outsider = await pro();
      const denied = await fetch(`${base}/api/messages/${job.id}/stream?ticket=${await ticketFor(outsider.auth)}`);
      expect(denied.status).toBe(403);
      s1.stop();
      s2.stop();
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});
