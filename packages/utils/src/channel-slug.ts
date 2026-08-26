/** Max length of a sanitized Channel slug. Matches Channel name max. */
export const CHANNEL_SLUG_MAX_LENGTH = 80;

/**
 * Channel-handle kebab rules shared by Core and the create UI.
 * Empty after sanitize is invalid — callers must reject, not invent a fallback.
 */
export function sanitizeChannelSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Display name derived from a sanitized Channel slug.
 * `team-soko` → `Team Soko`. Empty slug → empty name.
 */
export function channelNameFromSlug(slug: string): string {
  if (!slug) {
    return "";
  }
  return slug
    .split("-")
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}
