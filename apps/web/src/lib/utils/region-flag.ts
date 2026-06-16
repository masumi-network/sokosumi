const REGION_FLAG: Record<string, string> = {
  EU: "🇪🇺",
  US: "🇺🇸",
  UK: "🇬🇧",
  DE: "🇩🇪",
  APAC: "🌏",
  ASIA: "🌏",
};

/**
 * Maps a hosting string like "EU · Frankfurt" to a region flag emoji. Shared by
 * the New Task picker and the agents-page coworker gallery.
 */
export function regionFlag(hosting: string): string {
  const prefix = hosting.split("·")[0]?.trim().toUpperCase() ?? "";
  return REGION_FLAG[prefix] ?? "🌐";
}
