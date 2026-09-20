/** Common Bengaluru service-area chips for professional portfolio multi-select. */
export const SERVICE_AREA_OPTIONS = [
  "Indiranagar",
  "Koramangala",
  "HSR Layout",
  "Whitefield",
  "Marathahalli",
  "Jayanagar",
  "JP Nagar",
  "Banashankari",
  "Malleshwaram",
  "Rajajinagar",
  "Hebbal",
  "Yelahanka",
  "Electronic City",
  "BTM Layout",
  "Brookefield",
  "Sarjapur Road",
  "MG Road / CBD",
  "Frazer Town",
] as const;

export function parseServiceAreas(raw?: string | null): string[] {
  if (!raw) return [];
  return [
    ...new Set(
      String(raw)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    ),
  ];
}

export function joinServiceAreas(areas: string[]): string {
  return [...new Set(areas.map((s) => s.trim()).filter(Boolean))].join(", ");
}
