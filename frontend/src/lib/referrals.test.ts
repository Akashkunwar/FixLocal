import { describe, expect, it } from "vitest";
import { REFERRAL_STATUS_LABEL, whatsappShareUrl } from "./referrals";

describe("referrals helpers", () => {
  it("encodes the whole message for WhatsApp", () => {
    expect(whatsappShareUrl("Join me & save: https://x.in/register?ref=AB2C")).toBe(
      "https://wa.me/?text=Join%20me%20%26%20save%3A%20https%3A%2F%2Fx.in%2Fregister%3Fref%3DAB2C"
    );
  });
  it("labels every status", () => {
    expect(Object.keys(REFERRAL_STATUS_LABEL).sort()).toEqual(["completed_first_job", "confirmed", "joined"]);
  });
});
