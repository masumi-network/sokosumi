/**
 * Website URL helpers aligned with Zod 4 `z.httpUrl()`:
 * - protocol must be http or https
 * - hostname must be a domain with a TLD (rejects localhost, IPs, bare labels)
 *
 * Use {@link normalizeWebsiteUrl} for user input (optional scheme).
 * Use {@link isValidHttpUrl} for already-absolute http(s) URLs.
 */

/** Same pattern Zod 4 uses for `z.httpUrl({ hostname: domain })`. */
const HTTP_URL_DOMAIN =
  /^([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

const HTTP_PROTOCOL = /^https?$/;

/**
 * Returns true when `value` is an absolute http(s) URL with a public-style
 * domain hostname. Matches Zod `z.httpUrl()` acceptance for normal cases.
 */
export function isValidHttpUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return false;
  }

  try {
    const url = new URL(trimmed);
    const protocol = url.protocol.endsWith(":")
      ? url.protocol.slice(0, -1)
      : url.protocol;
    if (!HTTP_PROTOCOL.test(protocol)) {
      return false;
    }
    // URL.hostname is ASCII/punycode, so the domain regex applies to IDN too.
    return HTTP_URL_DOMAIN.test(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Normalizes user-entered website text into an absolute http(s) URL.
 * Prepends `https://` when the scheme is missing. Returns `null` when empty
 * or when the result is not a valid public website URL.
 */
export function normalizeWebsiteUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return null;
  }

  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const parsed = new URL(withProtocol);
    const candidate = parsed.toString();
    return isValidHttpUrl(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

/**
 * Form-friendly check: empty string is allowed; otherwise must normalize to a
 * valid website URL.
 */
export function isEmptyOrValidWebsiteUrl(rawUrl: string): boolean {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return true;
  }
  return normalizeWebsiteUrl(trimmed) !== null;
}
