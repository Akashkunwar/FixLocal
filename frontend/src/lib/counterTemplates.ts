/** Professional counter-offer reply templates (stored on the account). */
import { accountTextTemplates, type TextTemplate } from "./textTemplates";

export type CounterTemplate = TextTemplate;

/** Built-in starters: busy / materials / won't go below X. */
export const DEFAULT_COUNTER_STARTERS: CounterTemplate[] = [
  {
    id: "starter-busy",
    label: "Busy this week",
    body: "I'm booked this week — happy to revise if we can push the visit window, otherwise I'll have to pass on this counter.",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "starter-materials",
    label: "Materials cost",
    body: "Materials are running higher than expected for this scope. I can meet closer if we trim materials/options, otherwise I can't go that low.",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "starter-floor",
    label: "Won't go below X",
    body: "I won't go below ₹X for this scope — that's my floor after materials and travel. Happy to adjust scope if needed.",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

export function mergeCounterTemplates(server?: Parameters<typeof accountTextTemplates>[0]): CounterTemplate[] {
  return accountTextTemplates(server, DEFAULT_COUNTER_STARTERS);
}
