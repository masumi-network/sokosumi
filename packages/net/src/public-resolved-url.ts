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

/**
 * Extracts the embedded IPv4 from an IPv4-mapped IPv6 address.
 * Handles both dotted (`::ffff:169.254.169.254`) and hex (`::ffff:a9fe:a9fe`)
 * forms — Node/`URL` normalizes the former to the latter.
 */
function ipv4FromMappedIpv6(address: string): string | null {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");

  const dotted = normalized.match(/(?:^|:)ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted?.[1]) {
    return dotted[1];
  }

  const hex = normalized.match(/(?:^|:)ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex?.[1] || !hex[2]) {
    return null;
  }

  const high = Number.parseInt(hex[1], 16);
  const low = Number.parseInt(hex[2], 16);
  if (!Number.isFinite(high) || !Number.isFinite(low)) {
    return null;
  }

  return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "::" || normalized === "::1") {
    return true;
  }

  const mappedIpv4 = ipv4FromMappedIpv6(normalized);
  if (mappedIpv4) {
    return isPrivateIpv4(mappedIpv4);
  }

  // Well-known NAT64 prefix 64:ff9b::/96 embeds an IPv4 in the low 32 bits.
  const nat64 = normalized.match(/^64:ff9b::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (nat64?.[1] && nat64[2]) {
    const high = Number.parseInt(nat64[1], 16);
    const low = Number.parseInt(nat64[2], 16);
    const embedded = `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
    return isPrivateIpv4(embedded);
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
