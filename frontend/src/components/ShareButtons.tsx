import { Link2, MessageCircle, Share2 } from "lucide-react";
import { whatsappShareUrl } from "../lib/referrals";
import { useToast } from "./Toast";

/** "Share" via the phone's share sheet (or copy the link on desktop), plus a direct WhatsApp link. */
export function ShareButtons({ url, title, text }: { url: string; title: string; text: string }) {
  const { success, error } = useToast();
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function share() {
    if (canShare) {
      try {
        await navigator.share({ title, text, url });
      } catch {
        /* closed the sheet */
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      success("Link copied");
    } catch {
      error("Couldn't copy the link");
    }
  }

  return (
    <>
      <button type="button" className="btn-secondary btn-sm" onClick={share}>
        {canShare ? <Share2 className="h-4 w-4" aria-hidden /> : <Link2 className="h-4 w-4" aria-hidden />}
        {canShare ? "Share" : "Copy link"}
      </button>
      <a
        className="btn-secondary btn-sm"
        href={whatsappShareUrl(`${text} ${url}`)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Share on WhatsApp"
      >
        <MessageCircle className="h-4 w-4" aria-hidden /> WhatsApp
      </a>
    </>
  );
}
