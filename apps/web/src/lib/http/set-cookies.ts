/**
 * Verbatim Set-Cookie forwarding for Coreauth responses.
 *
 * Cookie values MUST reach the browser byte-identical: Better Auth signs
 * session cookies and Hono URL-encodes them on serialize, so any
 * parse-and-re-emit round-trip (e.g. Next's `cookies().set()`, which encodes
 * again) corrupts the signature and every later session read fails (SOK-1080).
 * Forward the raw header lines and never interpret them.
 */

/** Raw Set-Cookie header lines from an upstream response, in order. */
export function collectResponseSetCookies(
  response: Response | undefined,
): string[] {
  if (!response) {
    return [];
  }
  // getSetCookie is authoritative, including empty: falling through to
  // headers.get("set-cookie") joins Expires commas into one malformed line.
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie();
  }

  const singleCookie = response.headers.get("set-cookie");
  return singleCookie ? [singleCookie] : [];
}

/**
 * Appends an upstream response's Set-Cookie lines to outgoing headers
 * without parsing or re-encoding them.
 */
export function appendProxiedSetCookies(
  headers: Headers,
  response: Response | undefined,
): void {
  for (const cookie of collectResponseSetCookies(response)) {
    headers.append("set-cookie", cookie);
  }
}
