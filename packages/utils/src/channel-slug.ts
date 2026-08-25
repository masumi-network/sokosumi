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
