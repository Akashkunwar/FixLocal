/** Client "request a revised quote" note templates (stored on the account). */
import { accountTextTemplates, type TextTemplate } from "./textTemplates";

export type HomeownerCounterNoteTemplate = TextTemplate;

/** Built-in chips for request-revise notes. */
export const DEFAULT_HOMEOWNER_COUNTER_NOTES: HomeownerCounterNoteTemplate[] = [
  {
    id: "ho-budget",
    label: "Budget tight",
    body: "My budget is a bit tighter than this quote — could you revise closer to the suggested amount if we keep the same scope?",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "ho-scope",
    label: "Smaller scope",
    body: "Happy to trim scope slightly if that helps you meet closer to my suggested amount. Let me know what you'd drop first.",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "ho-timeline",
    label: "Flexible timing",
    body: "I'm flexible on timing if that helps on price — open to a later visit window for a revised quote near my suggestion.",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "ho-match",
    label: "Meet in middle",
    body: "Can we meet in the middle? I've suggested an amount that works for me — open to a small adjustment either way.",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

export function mergeHomeownerCounterNotes(
  server?: Parameters<typeof accountTextTemplates>[0]
): HomeownerCounterNoteTemplate[] {
  return accountTextTemplates(server, DEFAULT_HOMEOWNER_COUNTER_NOTES);
}
