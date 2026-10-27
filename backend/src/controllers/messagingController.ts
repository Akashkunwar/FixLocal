import crypto from "node:crypto";
import type { Request, Response } from "express";
import { AppDataSource } from "../data-source";
import { config } from "../config";
import { User } from "../entities/User";
import { badRequest, conflict, tooMany } from "../http/errors";
import { asLang, otpText } from "../domain/i18n";
import { messagingProvider, toE164 } from "../services/messaging";
import { QUIET_END_HOUR, QUIET_START_HOUR } from "../utils/outbound";
import { toSelfUser } from "../serializers";
import { logger } from "../logger";

const users = () => AppDataSource.getRepository(User);
const CODE_TTL_MS = 10 * 60_000;
const RESEND_AFTER_MS = 60_000;
const MAX_TRIES = 5;

/** Bound to the number the code was sent to: a code for one number can never verify another. */
const hashCode = (userId: string, e164: string, code: string) =>
  crypto.createHmac("sha256", config().jwtSecret).update(`phone:${userId}:${e164}:${code}`).digest("hex");

/** What the Settings card needs: is texting switched on, which channels, and the user's state. */
export async function getMessagingSettings(req: Request, res: Response) {
  const u = await users().findOneOrFail({ where: { id: req.user!.id } });
  const m = config().messaging;
  return res.json({
    messaging: {
      enabled: m.enabled,
      channels: { sms: m.enabled, whatsapp: m.enabled },
      phone: u.phone ?? null,
      phoneVerified: !!u.phoneVerifiedAt && !!toE164(u.phone),
      smsOptIn: u.smsOptIn,
      whatsappOptIn: u.whatsappOptIn,
      quietHours: { from: `${QUIET_START_HOUR}:00`, to: `0${QUIET_END_HOUR}:00`, timeZone: "Asia/Kolkata" },
      events: ["new_bid", "hired", "payment_released", "job_alert"],
    },
  });
}

/** Send a 6-digit code by SMS to prove the number (optionally changing it first). */
export async function sendPhoneCode(req: Request, res: Response) {
  if (!config().messaging.enabled) throw conflict("Text messages aren't switched on yet", "MESSAGING_OFF");
  const user = await users()
    .createQueryBuilder("u")
    .addSelect(["u.phoneCodeSentAt"])
    .where("u.id = :id", { id: req.user!.id })
    .getOneOrFail();
  const phone = req.valid.body.phone ?? user.phone;
  const e164 = toE164(phone);
  if (!e164) throw badRequest("Enter a valid mobile number (10 digits, or + and the country code)", "INVALID_PHONE");
  if (user.phoneCodeSentAt && Date.now() - new Date(user.phoneCodeSentAt).getTime() < RESEND_AFTER_MS) {
    throw tooMany("Wait a minute before asking for another code", "CODE_RECENTLY_SENT");
  }
  const changed = toE164(user.phone) !== e164;
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  await users().update(
    { id: user.id },
    {
      ...(changed ? { phone: phone!, phoneVerifiedAt: null, smsOptIn: false, whatsappOptIn: false } : {}),
      phoneCodeHash: hashCode(user.id, e164, code),
      phoneCodeExpiresAt: new Date(Date.now() + CODE_TTL_MS),
      phoneCodeSentAt: new Date(),
      phoneCodeAttempts: 0,
    }
  );
  try {
    // A code the user just asked for is exempt from quiet hours and never stored in the queue.
    await messagingProvider("sms").send({ channel: "sms", to: e164, text: otpText(asLang(user.language), code), lang: asLang(user.language) });
  } catch (err) {
    logger.warn({ err }, "phone code send failed");
    throw conflict("We couldn't send the code. Please try again in a minute.", "CODE_SEND_FAILED");
  }
  return res.json({ ok: true, sentTo: `${e164.slice(0, 3)}•••••${e164.slice(-3)}` });
}

export async function verifyPhoneCode(req: Request, res: Response) {
  const user = await users()
    .createQueryBuilder("u")
    .addSelect(["u.phoneCodeHash", "u.phoneCodeExpiresAt", "u.phoneCodeAttempts"])
    .where("u.id = :id", { id: req.user!.id })
    .getOneOrFail();
  const invalid = () => badRequest("That code isn't right or has expired. Ask for a new one.", "CODE_INVALID");
  if (!user.phoneCodeHash || !user.phoneCodeExpiresAt || new Date(user.phoneCodeExpiresAt).getTime() < Date.now()) throw invalid();
  if (user.phoneCodeAttempts >= MAX_TRIES) throw invalid();
  // Count the attempt first (atomically) so parallel guesses can't exceed the limit.
  const counted = await users()
    .createQueryBuilder()
    .update()
    .set({ phoneCodeAttempts: () => `"phoneCodeAttempts" + 1` })
    .where(`"id" = :id AND "phoneCodeAttempts" < :max`, { id: user.id, max: MAX_TRIES })
    .execute();
  if (!counted.affected) throw invalid();
  const expected = Buffer.from(user.phoneCodeHash, "hex");
  const e164 = toE164(user.phone);
  if (!e164) throw invalid();
  const given = Buffer.from(hashCode(user.id, e164, String(req.valid.body.code)), "hex");
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) throw invalid();
  await users().update({ id: user.id }, { phoneVerifiedAt: new Date(), phoneCodeHash: null, phoneCodeExpiresAt: null });
  const fresh = await users().findOneOrFail({ where: { id: user.id } });
  return res.json({ user: toSelfUser(fresh) });
}
