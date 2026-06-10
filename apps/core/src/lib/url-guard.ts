import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Maximum number of HTTP redirects {@link ssrfSafeFetch} will follow before
 * giving up. Each hop is re-validated, so this only bounds redirect chains.
 */
export const MAX_SSRF_FETCH_REDIRECTS = 5;

/**
 * Raised when a URL is rejected by the SSRF guard (bad scheme, malformed host,
 * or a host that resolves to a non-public IP address).
 */
export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

function parseIpv4(ip: string): [number, number, number, number] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) {
    return null;
  }

  const octets = parts.map((part) => {
    // Reject empty, signs, whitespace, or non-decimal forms that Number() would
    // otherwise coerce (e.g. "0x7f", "", " 1").
    if (!/^\d+$/.test(part)) {
      return Number.NaN;
    }
    return Number(part);
  });

  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return null;
  }

  return octets as [number, number, number, number];
}

/**
 * Returns true for IPv4 addresses that must never be reachable from a
 * server-side fetch driven by untrusted input: loopback, RFC1918 private,
 * link-local (incl. the cloud metadata endpoint 169.254.169.254), carrier-grade
 * NAT, "this host", and multicast/reserved/broadcast ranges.
 */
function isDisallowedIpv4(ip: string): boolean {
  const octets = parseIpv4(ip);
  if (!octets) {
    return false;
  }

  const [a, b] = octets;

  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved + 255.255.255.255

  return false;
}

/**
 * Returns true for IPv6 addresses that must never be reachable: unspecified,
 * loopback, link-local (fe80::/10), unique-local (fc00::/7), and IPv4-mapped
 * addresses that wrap a disallowed IPv4 address.
 */
function isDisallowedIpv6(ip: string): boolean {
  const addr = ip.toLowerCase();

  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(addr);
  if (mapped) {
    return isDisallowedIpv4(mapped[1]);
  }

  if (addr === "::" || addr === "::1") return true; // unspecified + loopback
  if (/^fe[89ab]/.test(addr)) return true; // fe80::/10 link-local
  if (/^f[cd]/.test(addr)) return true; // fc00::/7 unique-local

  return false;
}

/**
 * Returns true when `ip` (a numeric IP literal) must not be fetched. Anything
 * that is not a parseable IPv4/IPv6 literal is treated as disallowed.
 */
export function isDisallowedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    return isDisallowedIpv4(ip);
  }
  if (version === 6) {
    return isDisallowedIpv6(ip);
  }
  return true;
}

/**
 * Validates that `rawUrl` is an http(s) URL whose host resolves only to public
 * IP addresses, and returns the parsed {@link URL}.
 *
 * Defends against SSRF: a hostname literal is checked directly, otherwise the
 * host is resolved via DNS and rejected if ANY resolved address is private,
 * loopback, link-local, or otherwise non-public (DNS-rebinding safe at the
 * point of validation).
 *
 * @throws {SsrfError} when the URL is malformed, not http(s), or resolves to a
 *   disallowed address.
 */
export async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError(`Invalid URL: ${rawUrl}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfError(`Unsupported URL scheme: ${url.protocol}`);
  }

  // `hostname` keeps the brackets around IPv6 literals (e.g. "[::1]"); strip
  // them so the value can be recognized as an IP literal.
  const host = url.hostname.replace(/^\[|\]$/g, "");

  if (isIP(host)) {
    if (isDisallowedIp(host)) {
      throw new SsrfError(`URL host resolves to a non-public address: ${host}`);
    }
    return url;
  }

  let resolved: { address: string }[];
  try {
    resolved = await lookup(host, { all: true });
  } catch {
    throw new SsrfError(`Unable to resolve host: ${host}`);
  }

  if (resolved.length === 0) {
    throw new SsrfError(`Host did not resolve to any address: ${host}`);
  }

  for (const { address } of resolved) {
    if (isDisallowedIp(address)) {
      throw new SsrfError(
        `URL host resolves to a non-public address: ${host} -> ${address}`,
      );
    }
  }

  return url;
}

/**
 * Performs a `fetch` that is hardened against SSRF. Every URL — the initial one
 * and each redirect hop — is validated with {@link assertPublicHttpUrl} before
 * a request is made, defeating both direct internal targets and redirect- or
 * rebind-to-internal attacks. Redirects are followed manually up to
 * {@link MAX_SSRF_FETCH_REDIRECTS}.
 *
 * @throws {SsrfError} when any hop fails validation or the redirect limit is hit.
 */
export async function ssrfSafeFetch(
  rawUrl: string,
  init: RequestInit = {},
): Promise<Response> {
  let currentUrl = rawUrl;

  for (let hop = 0; hop <= MAX_SSRF_FETCH_REDIRECTS; hop += 1) {
    await assertPublicHttpUrl(currentUrl);

    const response = await fetch(currentUrl, { ...init, redirect: "manual" });

    const location = response.headers.get("location");
    const isRedirect =
      response.status >= 300 && response.status < 400 && location !== null;

    if (!isRedirect) {
      return response;
    }

    // Resolve relative redirects against the current URL.
    currentUrl = new URL(location, currentUrl).toString();
  }

  throw new SsrfError(
    `Exceeded maximum of ${MAX_SSRF_FETCH_REDIRECTS} redirects`,
  );
}
