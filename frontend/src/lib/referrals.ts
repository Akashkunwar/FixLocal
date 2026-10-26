import type { ReferralStatus } from "../api/features";

export const REFERRAL_STATUS_LABEL: Record<ReferralStatus, string> = {
  joined: "Signed up",
  confirmed: "Email confirmed",
  completed_first_job: "Finished a first job",
};

/** WhatsApp's universal share link (opens the app on phones, web.whatsapp.com on desktop). */
export function whatsappShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
