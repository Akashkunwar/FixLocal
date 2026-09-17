import { describe, expect, it } from "vitest";
import { VerificationStatus } from "../src/entities/TradespersonProfile";
import { acceptBid, admin, api, client, createJob, placeBid, pro, type TestUser } from "./helpers";
import { ACTIONS, ACTORS, STATES, type Actor, type State } from "./authz-matrix";

type Fixture = {
  jobId: string;
  actors: Record<Exclude<Actor, "anon">, TestUser>;
  ids: { bidderId: string; awardedProId: string | null };
};

/** Build a job in the given state with every kind of actor around it. */
async function build(state: State): Promise<Fixture> {
  const owner = await client();
  const awardedPro = await pro();
  const bidder = await pro();
  const actors = {
    admin: await admin(),
    owner,
    otherClient: await client(),
    awardedPro,
    bidder,
    strangerPro: await pro(),
    pendingPro: await pro({ proStatus: VerificationStatus.PENDING }),
  };
  const job = await createJob(owner);
  await placeBid(bidder, job.id, { amount: 800 });
  if (state === "open") {
    return { jobId: job.id, actors, ids: { bidderId: bidder.user.id, awardedProId: null } };
  }
  const bid = await placeBid(awardedPro, job.id, { amount: 900 });
  expect((await acceptBid(owner, bid.id)).status).toBe(200);
  const step = (path: string, who: TestUser, body?: object) =>
    api().post(`/api/jobs/${job.id}${path}`).set(who.auth).send(body ?? {});
  if (["in_progress", "pending_confirmation", "completed", "disputed"].includes(state)) {
    expect((await step("/start", awardedPro)).status).toBe(200);
  }
  if (state === "pending_confirmation" || state === "completed") {
    expect((await step("/mark-done", awardedPro)).status).toBe(200);
  }
  if (state === "completed") expect((await step("/confirm", owner)).status).toBe(200);
  if (state === "disputed") expect((await step("/disputes", owner, { reason: "setup" })).status).toBe(201);
  if (state === "cancelled") {
    expect((await api().post(`/api/admin/jobs/${job.id}/force-cancel`).set(actors.admin.auth).send({})).status).toBe(200);
  }
  return { jobId: job.id, actors, ids: { bidderId: bidder.user.id, awardedProId: awardedPro.user.id } };
}

function call(f: Fixture, actionIndex: number, actor: Actor) {
  const action = ACTIONS[actionIndex];
  const req = api()[action.method](action.path(f.jobId, f.ids, actor));
  if (actor !== "anon") req.set(f.actors[actor].auth);
  return action.body ? req.send(action.body) : req;
}

describe("authorization matrix (H-4)", () => {
  for (const state of STATES) {
    it(`enforces every rule on a ${state} job`, async () => {
      const shared = await build(state);
      const failures: string[] = [];
      for (let i = 0; i < ACTIONS.length; i++) {
        const action = ACTIONS[i];
        for (const actor of ACTORS) {
          const expected = action.expect(state, actor);
          const allowed = expected >= 200 && expected < 300;
          // Successful mutations get a fresh job so they can't affect other cases.
          const fixture = action.mutates && allowed ? await build(state) : shared;
          const res = await call(fixture, i, actor);
          if (res.status !== expected) {
            failures.push(`${action.name} as ${actor}: expected ${expected}, got ${res.status} ${JSON.stringify(res.body).slice(0, 120)}`);
          }
        }
      }
      expect(failures).toEqual([]);
    });
  }
});
