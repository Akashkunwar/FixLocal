import { ApiError } from "../api/client";
import { currentLang, hasTranslation, t } from "./t";

/**
 * Client-side text for error codes (ux HIGH 3). Generic codes get a clearer sentence than the
 * server's (e.g. "Invalid request"); specific codes map to their own sentence. Unknown codes fall
 * back to the server message, translated when the dictionary has it.
 */
export const ERROR_CODE_TEXT: Record<string, string> = {
  NETWORK_ERROR: "Can't reach FixLocal right now. Check your connection and try again.",
  INTERNAL: "Something went wrong on our side. Please try again.",
  VALIDATION: "Some details aren't valid. Check the highlighted fields and try again.",
  INVALID_INPUT: "Some details aren't valid. Check the highlighted fields and try again.",
  INVALID_JSON: "Something went wrong sending that. Please try again.",
  ROUTE_NOT_FOUND: "That page or action doesn't exist.",
  RATE_LIMITED: "Too many attempts. Please wait a moment and try again.",
  PAYLOAD_TOO_LARGE: "That file is too large.",
  UPLOAD_ERROR: "That file couldn't be uploaded. Try a smaller JPG, PNG or WebP image.",
  DUPLICATE: "This already exists.",
  ACCOUNT_SUSPENDED: "This account is suspended. Contact support if you think this is a mistake.",
  TOKEN_EXPIRED: "This link has expired. Ask for a new one.",
  TOKEN_INVALID: "This link isn't valid. Ask for a new one.",
  TOKEN_REVOKED: "This link has already been used. Ask for a new one.",
  NOT_VERIFIED: "Confirm your email address first — check your inbox for the link.",
  UNAUTHORIZED: "Please log in again.",
};

/** Codes whose server message is never worth showing (technical or vague): always use our sentence. */
const PREFER_CODE = new Set(["NETWORK_ERROR", "INTERNAL", "INVALID_JSON", "ROUTE_NOT_FOUND"]);
/** Catch-all server messages; a specific message with the same code (e.g. a VALIDATION reason) is kept. */
const GENERIC_MESSAGES = new Set(["Invalid request", "Invalid input"]);

/**
 * The sentence to show for a failed request, in the current language.
 * `fallback` (English, translated here) is used when there's nothing better.
 */
export function errorText(err: unknown, fallback = "Something went wrong. Please try again."): string {
  if (err instanceof ApiError) {
    const code = err.code || "";
    const message = err.message || "";
    if (PREFER_CODE.has(code) || (GENERIC_MESSAGES.has(message) && ERROR_CODE_TEXT[code])) return t(ERROR_CODE_TEXT[code]);
    if (message && hasTranslation(message)) return t(message);
    if (ERROR_CODE_TEXT[code] && (currentLang() === "hi" || !message)) return t(ERROR_CODE_TEXT[code]);
    return message || t(fallback);
  }
  if (err instanceof Error && err.message) return hasTranslation(err.message) ? t(err.message) : err.message;
  return t(fallback);
}
