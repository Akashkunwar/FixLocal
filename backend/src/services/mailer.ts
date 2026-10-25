import nodemailer from "nodemailer";
import { config } from "../config";
import { logger } from "../logger";
import { reportError } from "./errorReporter";

export type Mail = { to: string; subject: string; text: string };

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/**
 * Development/test mailer: keeps the last 50 messages in memory and logs them.
 * In production (only allowed with ALLOW_CONSOLE_MAIL=true) the body is never logged,
 * because it contains one-time login / reset links.
 */
class ConsoleMailer implements Mailer {
  outbox: (Mail & { sentAt: string })[] = [];
  async send(mail: Mail) {
    const cfg = config();
    if (!cfg.isProd) {
      this.outbox.unshift({ ...mail, sentAt: new Date().toISOString() });
      this.outbox.length = Math.min(this.outbox.length, 50);
    }
    if (cfg.isTest) return;
    if (cfg.isProd) logger.warn({ subject: mail.subject }, "email not delivered: console mailer in production");
    else logger.info({ to: mail.to, subject: mail.subject }, `\n--- email ---\n${mail.text}\n-------------`);
  }
}

/** SMTP delivery (works with SES, SendGrid, Postmark, Brevo, Zoho … via their SMTP endpoints). */
export class SmtpMailer implements Mailer {
  private transport: nodemailer.Transporter;
  constructor(url: string, private from: string) {
    this.transport = nodemailer.createTransport(url);
  }
  async send(mail: Mail) {
    await this.transport.sendMail({ from: this.from, to: mail.to, subject: mail.subject, text: mail.text });
  }
}

export const consoleMailer = new ConsoleMailer();
let active: Mailer | null = null;

export function mailer(): Mailer {
  if (!active) {
    const cfg = config();
    active = cfg.mailProvider === "smtp" && cfg.smtpUrl ? new SmtpMailer(cfg.smtpUrl, cfg.mailFrom) : consoleMailer;
  }
  return active;
}

/** Swap in a provider (tests, or a custom HTTP API mailer) without touching callers. */
export function setMailer(m: Mailer | null) {
  active = m;
}

/** Send without ever failing the caller's request: delivery problems are logged and reported. */
export async function sendMail(mail: Mail): Promise<boolean> {
  try {
    await mailer().send(mail);
    return true;
  } catch (err) {
    logger.error({ err, subject: mail.subject }, "email delivery failed");
    reportError(err, { where: "mailer", subject: mail.subject });
    return false;
  }
}

export function appLink(pathAndQuery: string) {
  return `${config().appUrl}${pathAndQuery.startsWith("/") ? "" : "/"}${pathAndQuery}`;
}
