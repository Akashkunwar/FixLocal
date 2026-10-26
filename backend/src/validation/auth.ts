import { z } from "zod";
import { UserRole } from "../entities/User";
import { email, nullableText, optionalInt, text } from "./common";
import { existingPassword, newPassword } from "./passwords";

export const registerBody = z.object({
  email,
  password: newPassword,
  role: z.enum([UserRole.HOMEOWNER, UserRole.TRADESPERSON], {
    message: "role must be HOMEOWNER or TRADESPERSON",
  }),
  name: text(80).optional(),
  phone: z
    .string()
    .trim()
    .max(20)
    .regex(/^[+0-9 ()-]*$/, "Enter a valid phone number")
    .optional(),
  /** The language the visitor was using, so the confirmation email matches it. */
  language: z.enum(["en", "hi"]).optional(),
  acceptTerms: z.literal(true, { message: "Please accept the Terms of Service and Privacy Policy" }),
  /** From an invite link (?ref=CODE). Unknown codes are ignored, so sign-up looks the same either way. */
  referralCode: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toUpperCase() || undefined : v),
    z.string().max(16).regex(/^[A-Z0-9]*$/, "Invalid invite code").optional()
  ),
});

export const loginBody = z.object({
  email,
  password: existingPassword,
});

const timezones = new Set(Intl.supportedValuesOf("timeZone"));

export const updateMeBody = z.object({
  name: nullableText(80),
  phone: z.preprocess(
    (v) => (v === "" ? null : v),
    z.string().trim().max(20).regex(/^[+0-9 ()-]*$/, "Enter a valid phone number").nullable().optional()
  ),
  timezone: z
    .string()
    .refine((tz) => timezones.has(tz) || tz === "UTC", "Unknown time zone")
    .optional(),
  notificationPrefs: z.record(z.string().max(40), z.boolean()).optional(),
  emailNotifications: z.boolean().optional(),
  quoteViewNudgeHours: z.preprocess((v) => (v === "" ? null : v), optionalInt(1, 168).nullable()),
  language: z.enum(["en", "hi"]).optional(),
});

export const changePasswordBody = z.object({
  currentPassword: existingPassword,
  newPassword,
});

export const tokenBody = z.object({ token: z.string().min(10).max(200) });
export const emailBody = z.object({ email });
export const resetPasswordBody = z.object({ token: z.string().min(10).max(200), password: newPassword });
export const deleteAccountBody = z.object({ password: existingPassword });

export const templatesBody = z.object({
  items: z.array(z.record(z.string(), z.unknown())).max(50),
});
