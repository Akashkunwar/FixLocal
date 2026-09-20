/** Professional first-message templates for in-job chat (stored on the account). */
import { accountTextTemplates, type TextTemplate } from "./textTemplates";

export type IntroTemplate = TextTemplate;

export const DEFAULT_INTRO_STARTERS: IntroTemplate[] = [
  {
    id: "intro-hello",
    label: "Hello + ETA",
    body: "Hi! Thanks for awarding the job. I can share an ETA once we confirm the visit window — happy to answer any questions beforehand.",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "intro-prep",
    label: "What to prep",
    body: "Looking forward to the visit. Please keep access clear and note any parking / entry instructions. I’ll bring the usual tools for this specialty.",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "intro-photos",
    label: "Photos help",
    body: "Thanks for hiring me. Extra photos of the work area before I arrive help me plan materials — feel free to drop them here.",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

export function mergeIntroTemplates(server?: Parameters<typeof accountTextTemplates>[0]): IntroTemplate[] {
  return accountTextTemplates(server, DEFAULT_INTRO_STARTERS);
}
