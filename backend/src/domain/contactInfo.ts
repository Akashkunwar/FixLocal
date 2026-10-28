import { badRequest } from "../http/errors";

/**
 * Phone numbers and email addresses before a hire (job Q&A, bid messages, quote notes, chat with a
 * bidder): deals should be agreed on FixLocal before contact details are shared (they unlock in chat
 * once someone is hired).
 */
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]{2,}/;
// 10+ digits, allowing spaces, dots, dashes and a +91 / 0 prefix.
const PHONE = /(?:\+?\d[\s.-]?){10,}/;

export function containsContactInfo(text: string): boolean {
  return EMAIL.test(text) || PHONE.test(text);
}

/** Throws CONTACT_INFO if any of the texts holds a phone number or email address. */
export function assertNoContactInfo(...texts: (string | null | undefined)[]) {
  if (texts.some((t) => !!t && containsContactInfo(t))) {
    throw badRequest(
      "Please don't share phone numbers or emails here. Contact details unlock in chat once someone is hired.",
      "CONTACT_INFO"
    );
  }
}
