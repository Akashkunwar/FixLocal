import { describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import { AppDataSource } from "../src/data-source";
import { createNotifications } from "../src/utils/notifications";
import { NotificationType } from "../src/entities/Notification";
import { closeAllStreams, MAX_STREAMS_PER_USER, openStream } from "../src/utils/sse";
import { client, rows } from "./helpers";

describe("notifications in bulk (M-5)", () => {
  it("notifies 50 users with at most 3 queries", async () => {
    const users = await Promise.all(Array.from({ length: 50 }, () => client()));
    const muted = users[0];
    await AppDataSource.query(`UPDATE "users" SET "notificationPrefs" = $1 WHERE "id" = $2`, [
      JSON.stringify({ system: false }),
      muted.user.id,
    ]);
    const logQuery = vi.spyOn(AppDataSource.logger, "logQuery");
    await createNotifications(
      users.map((u) => ({ userId: u.user.id, type: NotificationType.SYSTEM, title: "Scheduled maintenance", body: "Tonight" }))
    );
    const queries = logQuery.mock.calls.map((c) => String(c[0]));
    logQuery.mockRestore();
    expect(queries.length, queries.join("\n")).toBeLessThanOrEqual(3);
    const stored = await rows<{ userId: string }>(`SELECT "userId" FROM "notifications" WHERE "title" = 'Scheduled maintenance'`);
    expect(stored).toHaveLength(49);
    expect(stored.some((r) => r.userId === muted.user.id)).toBe(false);
  });
});

describe("live update connections (M-5)", () => {
  function fakeResponse() {
    const handlers: Record<string, () => void> = {};
    const res = {
      ended: false,
      setHeader: vi.fn(),
      flushHeaders: vi.fn(),
      write: vi.fn(() => true),
      end: vi.fn(function (this: { ended: boolean }) {
        this.ended = true;
      }),
      on: vi.fn((event: string, fn: () => void) => {
        handlers[event] = fn;
        return res;
      }),
    };
    return res as unknown as Response & { ended: boolean };
  }

  it("keeps at most five streams per user, closing the oldest", () => {
    expect(MAX_STREAMS_PER_USER).toBe(5);
    const userId = crypto.randomUUID();
    const streams = Array.from({ length: MAX_STREAMS_PER_USER + 1 }, () => fakeResponse());
    streams.forEach((res) => openStream(res, userId));
    expect(streams[0].ended).toBe(true);
    expect(streams.slice(1).every((s) => !s.ended)).toBe(true);
    closeAllStreams();
  });
});
