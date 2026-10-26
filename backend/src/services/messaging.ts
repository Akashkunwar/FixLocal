import { config } from "../config";
import { logger } from "../logger";

/**
 * Text-message provider boundary (same shape as services/payments.ts): every SMS / WhatsApp
 * message goes through `send`, and the provider's reference is stored on the outbound row.
 *
 * Drivers: "log" (default; writes to the log and keeps an in-memory outbox outside production),
 * MSG91 for SMS (Flow API, DLT-approved template with one variable) and the WhatsApp Cloud API
 * (approved template with one body parameter). Nothing is sent unless MESSAGING_ENABLED=true.
 * Setup: docs/OPERATIONS.md → "SMS and WhatsApp".
 */
export type Channel = "sms" | "whatsapp";
export const CHANNELS: readonly Channel[] = ["sms", "whatsapp"];

export type TextMessage = {
  channel: Channel;
  /** E.164, e.g. +919845012345 */
  to: string;
  text: string;
  lang: "en" | "hi";
};

export interface MessagingProvider {
  readonly name: string;
  /** Whether this driver reaches real phones. */
  readonly live: boolean;
  send(m: TextMessage): Promise<{ reference: string }>;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

const mask = (to: string) => `${to.slice(0, 4)}•••${to.slice(-3)}`;

export class LogMessagingProvider implements MessagingProvider {
  readonly live = false;
  outbox: (TextMessage & { sentAt: string })[] = [];
  constructor(readonly name: string) {}
  async send(m: TextMessage) {
    const cfg = config();
    if (!cfg.isProd) {
      this.outbox.unshift({ ...m, sentAt: new Date().toISOString() });
      this.outbox.length = Math.min(this.outbox.length, 50);
    }
    // Message bodies can hold one-time codes: only logged outside production.
    if (!cfg.isTest) logger.info({ channel: m.channel, to: mask(m.to), ...(cfg.isProd ? {} : { text: m.text }) }, "text message (log driver)");
    return { reference: `log_${m.channel}_${Date.now().toString(36)}` };
  }
}

/** MSG91 Flow API: https://docs.msg91.com/reference/send-sms (template variable "message"). */
export class Msg91SmsProvider implements MessagingProvider {
  readonly name = "msg91";
  readonly live = true;
  constructor(
    private opts: { authKey: string; templateId: string; senderId: string | null },
    private fetchImpl: FetchLike = fetch as unknown as FetchLike
  ) {}
  async send(m: TextMessage) {
    const res = await this.fetchImpl("https://control.msg91.com/api/v5/flow", {
      method: "POST",
      headers: { authkey: this.opts.authKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        template_id: this.opts.templateId,
        ...(this.opts.senderId ? { sender: this.opts.senderId } : {}),
        short_url: "0",
        recipients: [{ mobiles: m.to.replace(/^\+/, ""), message: m.text }],
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { type?: string; message?: string };
    if (!res.ok || body.type !== "success") throw new Error(`MSG91 ${res.status}: ${body.message || "send failed"}`);
    return { reference: `msg91_${body.message || "ok"}` };
  }
}

/** WhatsApp Cloud API: POST /{phone-number-id}/messages with an approved template. */
export class WhatsAppCloudProvider implements MessagingProvider {
  readonly name = "whatsapp-cloud";
  readonly live = true;
  constructor(
    private opts: { token: string; phoneNumberId: string; template: string; apiVersion: string },
    private fetchImpl: FetchLike = fetch as unknown as FetchLike
  ) {}
  async send(m: TextMessage) {
    const res = await this.fetchImpl(`https://graph.facebook.com/${this.opts.apiVersion}/${this.opts.phoneNumberId}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.opts.token}`, "content-type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: m.to.replace(/^\+/, ""),
        type: "template",
        template: {
          name: this.opts.template,
          language: { code: m.lang === "hi" ? "hi" : "en" },
          // Template parameters can't contain new lines or long runs of spaces.
          components: [{ type: "body", parameters: [{ type: "text", text: m.text.replace(/\s+/g, " ").slice(0, 1000) }] }],
        },
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
    if (!res.ok || !body.messages?.[0]?.id) throw new Error(`WhatsApp ${res.status}: ${body.error?.message || "send failed"}`);
    return { reference: body.messages[0].id };
  }
}

export const logSms = new LogMessagingProvider("log-sms");
export const logWhatsApp = new LogMessagingProvider("log-whatsapp");
const active: Partial<Record<Channel, MessagingProvider>> = {};

export function messagingProvider(channel: Channel): MessagingProvider {
  if (!active[channel]) {
    const m = config().messaging;
    active[channel] =
      channel === "sms"
        ? m.smsDriver === "msg91" && m.msg91
          ? new Msg91SmsProvider(m.msg91)
          : logSms
        : m.whatsappDriver === "cloud" && m.whatsapp
          ? new WhatsAppCloudProvider(m.whatsapp)
          : logWhatsApp;
  }
  return active[channel]!;
}

/** Tests / a custom adapter. */
export function setMessagingProvider(channel: Channel, p: MessagingProvider | null) {
  if (p) active[channel] = p;
  else delete active[channel];
}

/** Indian numbers: 10 digits starting 6–9 (optionally with 0 / 91 / +91). Others need a + country code. */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+") && !trimmed.startsWith("+91")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  const local = digits.replace(/^(91|0)(?=[6-9]\d{9}$)/, "");
  return /^[6-9]\d{9}$/.test(local) ? `+91${local}` : null;
}
