import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { assertPublicHttpUrl, SsrfError } from "./ssrf-fetch.js";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.goog",
  "kubernetes.default",
  "kubernetes.default.svc",
]);

const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".home",
  ".corp",
] as const;

function ipv4ToInt(address: string): number {
  const [a = 0, b = 0, c = 0, d = 0] = address.split(".").map(Number);
  return (((a << 24) >>> 0) + (b << 16) + (c << 8) + d) >>> 0;
}

function isPrivateIpv4(address: string): boolean {
  const value = ipv4ToInt(address);
  return (
    // 0.0.0.0/8
    value <= 0x00_ff_ff_ff ||
    // 10.0.0.0/8
    (value >= 0x0a_00_00_00 && value <= 0x0a_ff_ff_ff) ||
    // 100.64.0.0/10 (CGNAT)
    (value >= 0x64_40_00_00 && value <= 0x64_7f_ff_ff) ||
    // 127.0.0.0/8
    (value >= 0x7f_00_00_00 && value <= 0x7f_ff_ff_ff) ||
    // 169.254.0.0/16 (link-local / cloud metadata)
    (value >= 0xa9_fe_00_00 && value <= 0xa9_fe_ff_ff) ||
    // 172.16.0.0/12
    (value >= 0xac_10_00_00 && value <= 0xac_1f_ff_ff) ||
    // 192.168.0.0/16
    (value >= 0xc0_a8_00_00 && value <= 0xc0_a8_ff_ff) ||
    // 224.0.0.0/4 multicast and above (including broadcast)
    value >= 0xe0_00_00_00
  );
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::" || normalized === "::1") {
    return true;
  }

  // IPv4-mapped IPv6 (:ffff:x.x.x.x)
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1]) {
    return isPrivateIpv4(mapped[1]);
  }

  // Unique local (fc00::/7) and link-local (fe80::/10)
  return (
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  );
}

/**
 * Returns true when `address` is loopback, private, link-local, CGNAT,
 * unique-local, or otherwise unsuitable as an outbound browser/fetch target.
 */
export function isBlockedIpAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    return isPrivateIpv4(address);
  }
  if (version === 6) {
    return isPrivateIpv6(address);
  }
  return true;
}

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host)) {
    return true;
  }
  return BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/**
 * Validates that `rawUrl` is http(s) and that every DNS-resolved address for
 * its host is a public routable address (not private/loopback/link-local).
 *
 * Use this before allowing Chromium/Puppeteer (or similar) to fetch a URL when
 * connect-time filtering via {@link ssrfSafeFetch} is unavailable.
 *
 * @throws {SsrfError} when the URL scheme is unsafe, the hostname is blocked,
 *   DNS fails, or any resolved address is non-public.
 */
export async function assertPublicResolvedHttpUrl(
  rawUrl: string | URL,
): Promise<URL> {
  const url = assertPublicHttpUrl(rawUrl);
  const host = url.hostname.replace(/^\[|\]$/g, "");

  if (isBlockedHostname(host)) {
    throw new SsrfError(`Blocked host: ${host}`);
  }

  if (isIP(host)) {
    if (isBlockedIpAddress(host)) {
      throw new SsrfError(`Blocked IP address: ${host}`);
    }
    return url;
  }

  let records: Array<{ address: string }>;
  try {
    records = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new SsrfError(`DNS lookup failed for host: ${host}`);
  }

  if (records.length === 0) {
    throw new SsrfError(`DNS lookup returned no addresses for host: ${host}`);
  }

  for (const record of records) {
    if (isBlockedIpAddress(record.address)) {
      throw new SsrfError(
        `Host ${host} resolves to blocked address ${record.address}`,
      );
    }
  }

  return url;
}
