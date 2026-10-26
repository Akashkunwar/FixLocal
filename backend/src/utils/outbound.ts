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

/**
 * Send queued texts that are due. Rows are claimed with FOR UPDATE SKIP LOCKED, so concurrent
 * flushes (another request, the worker, another instance) never send the same message twice.
 * The user's opt-in is checked again at send time.
 */
export async function flushOutbound(now = new Date(), limit = 50): Promise<number> {
  // A sender that died mid-send leaves rows in "sending"; give them back after 10 minutes.
  await AppDataSource.query(
    `UPDATE "outbound_messages" SET "status" = 'queued' WHERE "status" = 'sending' AND "updatedAt" < $1`,
    [new Date(now.getTime() - 10 * 60_000)]
  );
  // Postgres UPDATE ... RETURNING comes back from TypeORM as [rows, affectedCount].
  const [claimed]: [OutboundMessage[], number] = await AppDataSource.query(
    `UPDATE "outbound_messages" SET "status" = 'sending', "attempts" = "attempts" + 1, "updatedAt" = now()
      WHERE "id" IN (SELECT "id" FROM "outbound_messages"
                      WHERE "status" = 'queued' AND "sendAfter" <= $1
                      ORDER BY "createdAt" LIMIT $2 FOR UPDATE SKIP LOCKED)
      RETURNING *`,
    [now, limit]
  );
  let sent = 0;
  const repo = AppDataSource.getRepository(OutboundMessage);
  for (const msg of claimed) {
    const u = await AppDataSource.getRepository(User).findOne({
      where: { id: msg.userId },
      select: { id: true, phone: true, phoneVerifiedAt: true, smsOptIn: true, whatsappOptIn: true, language: true, deletedAt: true },
    });
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
          sendAfter: nextSendTime(new Date(now.getTime() + 5 * 60_000 * msg.attempts)),
          lastError: String((err as Error).message || err).slice(0, 300),
        }
      );
      logger.warn({ err, id: msg.id, channel: msg.channel }, "text message failed");
    }
  }
  return sent;
}
