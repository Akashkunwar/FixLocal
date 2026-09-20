/** Client invite-message templates (stored on the account). */
import { accountTextTemplates, type TextTemplate } from "./textTemplates";

export type InviteTemplate = TextTemplate;

export const DEFAULT_INVITE_STARTERS: InviteTemplate[] = [
  {
    id: "starter-flexible",
    label: "Flexible timing",
    body: "Flexible on timing — need someone reliable this week. Happy to discuss scope.",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "starter-quote",
    label: "Need a quote",
    body: "Could you take a look and share a structured quote? Photos are on the job.",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "starter-urgent",
    label: "Fairly urgent",
    body: "This is fairly urgent. If you’re available soon, please bid with an ETA.",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

export function mergeInviteTemplates(server?: Parameters<typeof accountTextTemplates>[0]): InviteTemplate[] {
  return accountTextTemplates(server, DEFAULT_INVITE_STARTERS);
}
