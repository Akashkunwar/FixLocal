import { In, type EntityManager } from "typeorm";
import { AppDataSource } from "../data-source";
import { config } from "../config";
import { OutboundMessage } from "../entities/OutboundMessage";
import { User } from "../entities/User";
import type { Notification } from "../entities/Notification";
import { asLang, textMessage } from "../domain/i18n";
import { istParts, istTimeOn } from "../domain/time";
import { CHANNELS, messagingProvider, toE164, type Channel } from "../services/messaging";
import { appLink } from "../services/mailer";
import { logger } from "../logger";

/** No SMS / WhatsApp between 10 PM and 8 AM IST (one-time codes the user asked for are exempt). */
export const QUIET_START_HOUR = 22;
export const QUIET_END_HOUR = 8;

/** The earliest time a non-urgent text may go out. */
export function nextSendTime(now: Date): Date {
  const { hour } = istParts(now);
  if (hour >= QUIET_END_HOUR && hour < QUIET_START_HOUR) return now;
  const today8 = istTimeOn(now, QUIET_END_HOUR);
  return hour < QUIET_END_HOUR ? today8 : new Date(today8.getTime() + 24 * 3600_000);
}

type TextUser = Pick<User, "id" | "phone" | "phoneVerifiedAt" | "smsOptIn" | "whatsappOptIn" | "language" | "deletedAt">;

export function channelsFor(u: TextUser): Channel[] {
  if (!config().messaging.enabled || u.deletedAt || !u.phoneVerifiedAt || !toE164(u.phone)) return [];
  return CHANNELS.filter((c) => (c === "sms" ? u.smsOptIn : u.whatsappOptIn));
}

/** Queue a text for each channel the user opted into; sends straight away outside quiet hours. */
export async function queueTexts(notifications: Notification[], manager: EntityManager = AppDataSource.manager, now = new Date()) {
  if (!config().messaging.enabled || !notifications.length) return 0;
  const users = await manager.find(User, {
    where: { id: In([...new Set(notifications.map((n) => n.userId))]) },
    select: { id: true, phone: true, phoneVerifiedAt: true, smsOptIn: true, whatsappOptIn: true, language: true, deletedAt: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  const sendAfter = nextSendTime(now);
  const rows = notifications.flatMap((n) => {
    const u = byId.get(n.userId);
    if (!u) return [];
    return channelsFor(u).map((channel) => ({
      userId: u.id,
      channel,
      body: textMessage(asLang(u.language), n.title, n.link ? appLink(n.link) : null).slice(0, 400),
      status: "queued" as const,
      sendAfter,
      dedupeKey: `${n.id}:${channel}`,
    }));
  });
  if (!rows.length) return 0;
  await manager.createQueryBuilder().insert().into(OutboundMessage).values(rows).orIgnore().execute();
  if (sendAfter <= now) void flushOutbound(now).catch((err) => logger.warn({ err }, "text flush failed"));
  return rows.length;
}

const MAX_ATTEMPTS = 3;

/** Claim one due row (SKIP LOCKED): rows not yet being sent stay queued for any other flusher. */
async function claimOne(at: Date): Promise<OutboundMessage | null> {
  // Postgres UPDATE ... RETURNING comes back from TypeORM as [rows, affectedCount].
  const [rows]: [OutboundMessage[], number] = await AppDataSource.query(
    `UPDATE "outbound_messages" SET "status" = 'sending', "attempts" = "attempts" + 1, "updatedAt" = now()
      WHERE "id" = (SELECT "id" FROM "outbound_messages"
                     WHERE "status" = 'queued' AND "sendAfter" <= $1
                     ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING *`,
    [at]
  );
  return rows[0] ?? null;
}

/**
 * Send queued texts that are due, one row at a time (each claimed with FOR UPDATE SKIP LOCKED, so
 * concurrent flushes never send the same message twice, and a slow provider holds at most one row).
 * Quiet hours are enforced here as well as at queue time: nothing goes out between 10 PM and 8 AM
 * IST, whatever was queued earlier. The user's opt-in is checked again at send time.
 */
export async function flushOutbound(now = new Date(), limit = 50): Promise<number> {
  // A sender that died mid-send leaves rows in "sending"; give them back after 10 minutes (provider
  // calls time out after 10 seconds, so a live sender is long done by then).
  // Measured on the database clock, the same one that stamped "updatedAt" at claim time: a caller's
  // `now` (later in tests, or a skewed app server) must not hand back rows another flush is sending.
  await AppDataSource.query(
    `UPDATE "outbound_messages" SET "status" = 'queued' WHERE "status" = 'sending' AND "updatedAt" < now() - interval '10 minutes'`
  );
  const startedAt = Date.now();
  const clock = () => new Date(now.getTime() + (Date.now() - startedAt));
  let sent = 0;
  const repo = AppDataSource.getRepository(OutboundMessage);
  const users = new Map<string, TextUser | null>();
  for (let i = 0; i < limit; i++) {
    const at = clock();
    if (nextSendTime(at) > at) break; // quiet hours (also if they begin mid-run)
    const msg = await claimOne(at);
    if (!msg) break;
    if (!users.has(msg.userId)) {
      users.set(
        msg.userId,
        await AppDataSource.getRepository(User).findOne({
          where: { id: msg.userId },
          select: { id: true, phone: true, phoneVerifiedAt: true, smsOptIn: true, whatsappOptIn: true, language: true, deletedAt: true },
        })
      );
    }
    const u = users.get(msg.userId) ?? null;
    const to = u ? toE164(u.phone) : null;
    if (!u || !to || !channelsFor(u).includes(msg.channel)) {
      await repo.update({ id: msg.id }, { status: "skipped", lastError: "opted out or phone changed" });
      continue;
    }
    try {
      const { reference } = await messagingProvider(msg.channel).send({ channel: msg.channel, to, text: msg.body, lang: asLang(u.language) });
      await repo.update({ id: msg.id }, { status: "sent", providerRef: reference.slice(0, 120), sentAt: new Date(), lastError: null });
      sent += 1;
    } catch (err) {
      const last = msg.attempts >= MAX_ATTEMPTS;
      await repo.update(
        { id: msg.id },
        {
          status: last ? "failed" : "queued",
          sendAfter: nextSendTime(new Date(at.getTime() + 5 * 60_000 * msg.attempts)),
          lastError: String((err as Error).message || err).slice(0, 300),
        }
      );
      logger.warn({ err, id: msg.id, channel: msg.channel }, "text message failed");
    }
  }
  return sent;
}
