/**
 * Phone numbers and email addresses in public job Q&A: deals should be agreed on FixLocal before
 * contact details are shared (they unlock in chat once someone is hired).
 */
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]{2,}/;
// 10+ digits, allowing spaces, dots, dashes and a +91 / 0 prefix.
const PHONE = /(?:\+?\d[\s.-]?){10,}/;

export function containsContactInfo(text: string): boolean {
  return EMAIL.test(text) || PHONE.test(text);
}
