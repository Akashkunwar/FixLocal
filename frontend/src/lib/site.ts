/** Operator details shown on legal pages. Set the VITE_* values at build time before launch. */
export const SITE = {
  name: "FixLocal",
  operator: import.meta.env.VITE_LEGAL_ENTITY || "FixLocal (operator name to be confirmed)",
  supportEmail: import.meta.env.VITE_SUPPORT_EMAIL || "support@fixlocal.example",
  grievanceOfficer: import.meta.env.VITE_GRIEVANCE_OFFICER || "Grievance Officer (name to be confirmed)",
  grievanceEmail: import.meta.env.VITE_GRIEVANCE_EMAIL || import.meta.env.VITE_SUPPORT_EMAIL || "grievance@fixlocal.example",
  legalUpdated: "25 October 2026",
};

export const DEFAULT_DESCRIPTION =
  "FixLocal — post work and hire verified local professionals for blue-collar, office, and technical jobs.";

/** Sets the tab title (WCAG 2.4.2) and the meta description for the current page. */
export function setPageMeta(title?: string | null, description: string = DEFAULT_DESCRIPTION) {
  if (typeof document === "undefined") return;
  document.title = title ? `${title} · ${SITE.name}` : `${SITE.name} — Hire trusted local professionals`;
  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.setAttribute("content", description);
}
