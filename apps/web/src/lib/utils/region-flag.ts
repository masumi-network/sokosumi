const REGION_FLAG: Record<string, string> = {
  EU: "🇪🇺",
  US: "🇺🇸",
  UK: "🇬🇧",
  DE: "🇩🇪",
  APAC: "🌏",
  ASIA: "🌏",
};

/**
 * Returns a region flag emoji only for a recognized region prefix (e.g. "EU",
 * "EU · Frankfurt"), otherwise `null`. Use when a string may not be a region at
 * all (e.g. a generic tag) and you don't want the globe fallback.
 */
export function regionFlagKnown(value: string): string | null {
  const prefix = value.split("·")[0]?.trim().toUpperCase() ?? "";
  return REGION_FLAG[prefix] ?? null;
}

/**
 * Maps a hosting string like "EU · Frankfurt" to a region flag emoji, falling
 * back to a globe for unknown regions. Shared by the New Task picker and the
 * agents-page coworker gallery.
 */
export function regionFlag(hosting: string): string {
  return regionFlagKnown(hosting) ?? "🌐";
}
