import { describe, expect, it } from "vitest";
import { accountTextTemplates, removeTextTemplate, upsertTextTemplate } from "./textTemplates";
import { DEFAULT_INVITE_STARTERS, mergeInviteTemplates } from "./inviteTemplates";
import { mergeNotifPrefs, DEFAULT_NOTIF_PREFS } from "./notifPrefs";
import { deleteNamedJobTemplate, mergeNamedJobTemplates, toggleNamedJobTemplatePin, upsertNamedJobTemplate } from "./namedJobTemplates";
import { safeNext } from "./paths";
import { clearLocalUserData } from "../auth/AuthContext";

describe("saved templates live on the account (L-7)", () => {
  it("shows starters only when the account has none, and never reads localStorage", () => {
    localStorage.setItem("fixlocal_invite_templates", JSON.stringify([{ id: "leak", label: "Other user", body: "secret" }]));
    expect(mergeInviteTemplates(null)).toEqual(DEFAULT_INVITE_STARTERS);
    const mine = [{ id: "a", label: "Mine", body: "Hello", createdAt: "2026-01-01" }];
    expect(mergeInviteTemplates(mine)).toEqual(mine);
  });

  it("upserts newest-first, edits in place, ignores empty bodies, and removes", () => {
    let list = accountTextTemplates([], []);
    list = upsertTextTemplate(list, { label: "One", body: " first " }, "tpl");
    list = upsertTextTemplate(list, { label: "Two", body: "second" }, "tpl");
    expect(list.map((t) => t.body)).toEqual(["second", "first"]);
    const edited = upsertTextTemplate(list, { id: list[1].id, label: "One!", body: "first, edited" });
    expect(edited.map((t) => t.label)).toEqual(["Two", "One!"]);
    expect(edited[1].createdAt).toBe(list[1].createdAt);
    expect(upsertTextTemplate(list, { body: "   " })).toBe(list);
    expect(removeTextTemplate(edited, list[0].id).map((t) => t.label)).toEqual(["One!"]);
  });

  it("caps the list at 20", () => {
    let list = accountTextTemplates([], []);
    for (let i = 0; i < 25; i++) list = upsertTextTemplate(list, { body: `b${i}` });
    expect(list).toHaveLength(20);
    expect(list[0].body).toBe("b24");
  });

  it("named job templates: upsert, pin and delete are pure", () => {
    const t = { id: "n1", name: "Monthly clean", title: "Deep clean", description: "", category: "cleaning", createdAt: "2026-01-01" };
    const list = upsertNamedJobTemplate([], t);
    expect(mergeNamedJobTemplates(list)[0]).toMatchObject({ id: "n1", name: "Monthly clean" });
    const pinned = toggleNamedJobTemplatePin(list, "n1");
    expect(pinned[0].pinned).toBe(true);
    expect(list[0].pinned).toBeUndefined();
    expect(toggleNamedJobTemplatePin(pinned, "n1")[0]).not.toHaveProperty("pinned");
    expect(deleteNamedJobTemplate(list, "n1")).toEqual([]);
  });
});

describe("notification preferences", () => {
  it("applies saved booleans over defaults and ignores junk", () => {
    const prefs = mergeNotifPrefs({ match: false, message: "no" as unknown as boolean, bogus: true });
    expect(prefs.match).toBe(false);
    expect(prefs.message).toBe(true);
    expect(Object.keys(prefs).sort()).toEqual(Object.keys(DEFAULT_NOTIF_PREFS).sort());
  });
});

describe("safeNext", () => {
  it("only allows same-site paths", () => {
    expect(safeNext("/client/jobs/1?x=1")).toBe("/client/jobs/1?x=1");
    for (const bad of ["//evil.com", "/\\evil.com", "https://evil.com", "javascript:alert(1)", "", null, 42]) {
      expect(safeNext(bad)).toBeNull();
    }
  });
});

describe("clearLocalUserData", () => {
  it("removes this app's per-person keys and leaves others", () => {
    localStorage.setItem("fixlocal_job_draft_v3", "{}");
    localStorage.setItem("fixlocal:savedProSearch", "{}");
    localStorage.setItem("other-app", "keep");
    clearLocalUserData();
    expect(localStorage.getItem("fixlocal_job_draft_v3")).toBeNull();
    expect(localStorage.getItem("fixlocal:savedProSearch")).toBeNull();
    expect(localStorage.getItem("other-app")).toBe("keep");
  });
});
