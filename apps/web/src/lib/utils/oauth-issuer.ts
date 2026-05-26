/**
 * Parses and normalizes an OAuth authorization server issuer base URL
 * (scheme + host + path, no trailing slash on the path).
 * Rejects non-http(s) URLs and URLs with embedded credentials.
 */
export function normalizeOAuthIssuerBase(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;

    const path = url.pathname.replace(/\/$/, "");
    return `${url.origin}${path}`;
  } catch {
    return null;
  }
}
