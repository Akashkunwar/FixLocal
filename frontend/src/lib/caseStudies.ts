/** Past-work case-study cards for professional portfolio / public profile. */

export type CaseStudy = {
  id: string;
  title: string;
  notes?: string;
  beforeUrl?: string | null;
  afterUrl?: string | null;
  category?: string | null;
};

export function normalizeCaseStudies(raw: unknown): CaseStudy[] {
  if (!Array.isArray(raw)) return [];
  const out: CaseStudy[] = [];
  for (let i = 0; i < raw.length && out.length < 12; i++) {
    const t: any = raw[i];
    const title = String(t?.title || "").trim().slice(0, 120);
    if (!title) continue;
    const notes = t?.notes != null ? String(t.notes).trim().slice(0, 800) : undefined;
    const beforeUrl =
      t?.beforeUrl != null && String(t.beforeUrl).trim()
        ? String(t.beforeUrl).trim().slice(0, 500)
        : undefined;
    const afterUrl =
      t?.afterUrl != null && String(t.afterUrl).trim()
        ? String(t.afterUrl).trim().slice(0, 500)
        : undefined;
    const category =
      t?.category != null && String(t.category).trim()
        ? String(t.category).trim().slice(0, 40)
        : undefined;
    out.push({
      id: String(t?.id || `case-${i}`).slice(0, 64),
      title,
      ...(notes ? { notes } : {}),
      ...(beforeUrl ? { beforeUrl } : {}),
      ...(afterUrl ? { afterUrl } : {}),
      ...(category ? { category } : {}),
    });
  }
  return out;
}

export function newCaseStudyId() {
  return `case-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
