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
  quoteViewNudgeHours: z.preprocess((v) => (v === "" ? null : v), optionalInt(1, 168).nullable()),
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
