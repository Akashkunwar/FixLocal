import { describe, expect, it, vi } from "vitest";
import { AppDataSource } from "../src/data-source";
import { admin, api, client, createJob, pro } from "./helpers";
import {
  getMatchWeights,
  getShortlistInviteMinHeat,
  onConfigChanged,
  setMatchWeights,
  MATCH_WEIGHTS_KEY,
} from "../src/utils/matchWeights";

describe("app config cache (M-4)", () => {
  it("reads config from the database once, then from memory", async () => {
    const logQuery = vi.spyOn(AppDataSource.logger, "logQuery");
    await getMatchWeights();
    logQuery.mockClear();
    await getMatchWeights();
    await getMatchWeights();
    expect(logQuery).not.toHaveBeenCalled();
    logQuery.mockRestore();
  });

  it("serves a new value immediately after a write, and drops it when another instance changes it", async () => {
    await setMatchWeights({ skills: 40, rating: 20, response: 20, distance: 20 });
    expect((await getMatchWeights()).skills).toBe(40);

    // Another instance writes directly and announces the change over Redis.
    await AppDataSource.query(`UPDATE "app_configs" SET "value" = $1 WHERE "key" = $2`, [
      JSON.stringify({ skills: 50, rating: 20, response: 15, distance: 15 }),
      MATCH_WEIGHTS_KEY,
    ]);
    expect((await getMatchWeights()).skills).toBe(40); // still cached
    onConfigChanged(MATCH_WEIGHTS_KEY);
    expect((await getMatchWeights()).skills).toBe(50);
  });
});

describe("shortlist availability gate is an admin setting (M-1)", () => {
  it("admins set it, it's enforced server-side, audited, and can be rolled back", async () => {
    const a = await admin();
    const owner = await client();
    const slot = { enabled: true, start: "09:00", end: "13:00" };
    const p = await pro({ profile: { weeklyAvailability: { mon: slot, tue: slot, wed: slot, thu: slot, fri: slot } } });
    await api().post("/api/favorites").set(owner.auth).send({ targetType: "pro", targetId: p.user.id }).expect(201);

    const initial = await api().get("/api/admin/match-weights").set(a.auth);
    expect(initial.body).toMatchObject({ shortlistInviteMinHeat: 25, defaultShortlistInviteMinHeat: 25 });
    const job = await createJob(owner);
    const ranked = await api().get(`/api/jobs/${job.id}/shortlist-ranked`).set(owner.auth);
    const score = ranked.body.shortlist[0].availabilityHeat.score as number;
    expect(ranked.body.shortlist[0].inviteBlockedByHeat).toBe(false);

    // Non-admins can't change it; out-of-range values are refused.
    expect((await api().put("/api/admin/match-weights").set(owner.auth).send({ shortlistInviteMinHeat: 90 })).status).toBe(403);
    expect((await api().put("/api/admin/match-weights").set(a.auth).send({ shortlistInviteMinHeat: 150 })).status).toBe(400);

    const strict = score + 5;
    const set = await api().put("/api/admin/match-weights").set(a.auth).send({ shortlistInviteMinHeat: strict });
    expect(set.status).toBe(200);
    expect(set.body.shortlistInviteMinHeat).toBe(strict);
    expect(await getShortlistInviteMinHeat()).toBe(strict);

    const after = await api().get(`/api/jobs/${job.id}/shortlist-ranked`).set(owner.auth);
    expect(after.body).toMatchObject({ shortlistInviteMinHeat: strict });
    expect(after.body.shortlist[0].inviteBlockedByHeat).toBe(true);
    // A client can't loosen it.
    const invite = await api()
      .post(`/api/jobs/${job.id}/invite-pro`)
      .set(owner.auth)
      .send({ tradespersonId: p.user.id, source: "shortlist", minHeat: 1 });
    expect(invite.body).toMatchObject({ code: "SHORTLIST_HEAT_TOO_LOW", minHeat: strict });

    const logs = await api().get("/api/admin/audit-logs?action=match_weights_update").set(a.auth);
    const entry = (logs.body.logs as { id: string; summary: string }[]).find((l) => l.summary.includes(`shortlist gate 25 → ${strict}`));
    expect(entry).toBeTruthy();
    const rolled = await api().post("/api/admin/match-weights/rollback").set(a.auth).send({ auditLogId: entry!.id });
    expect(rolled.status).toBe(200);
    expect(rolled.body.shortlistInviteMinHeat).toBe(25);
    const allowed = await api()
      .post(`/api/jobs/${job.id}/invite-pro`)
      .set(owner.auth)
      .send({ tradespersonId: p.user.id, source: "shortlist" });
    expect(allowed.status).toBe(200);
  });
});
