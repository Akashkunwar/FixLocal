import { config } from "../config";
import { logger } from "../logger";

export type Mail = { to: string; subject: string; text: string };

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/** Development/test mailer: logs the message and keeps the last 50 in memory. */
class ConsoleMailer implements Mailer {
  outbox: (Mail & { sentAt: string })[] = [];
  async send(mail: Mail) {
    this.outbox.unshift({ ...mail, sentAt: new Date().toISOString() });
    this.outbox.length = Math.min(this.outbox.length, 50);
    if (!config().isTest) logger.info({ to: mail.to, subject: mail.subject }, `\n--- email ---\n${mail.text}\n-------------`);
  }
}

export const consoleMailer = new ConsoleMailer();
let active: Mailer = consoleMailer;

export function mailer(): Mailer {
  return active;
}

/** Swap in a real provider (SES, SMTP, …) without touching callers. */
export function setMailer(m: Mailer) {
  active = m;
}

export function appLink(pathAndQuery: string) {
  return `${config().appUrl}${pathAndQuery.startsWith("/") ? "" : "/"}${pathAndQuery}`;
}
