import { lookup as dnsLookup } from "node:dns";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

/**
 * Maximum number of HTTP redirects {@link ssrfSafeFetch} will follow before
 * giving up. Each hop is re-validated and re-pinned, so this only bounds the
 * length of redirect chains.
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

/**
 * IP ranges that must never be reachable from a server-side fetch driven by
 * untrusted input. `BlockList` parses and normalizes addresses, so this is
 * immune to non-canonical spellings (e.g. `0:0:0:0:0:0:0:1`, IPv4-mapped or
 * hex IPv6 forms) that string comparison would miss.
 */
const blockedRanges: BlockList = (() => {
  const list = new BlockList();

  // IPv4
  list.addSubnet("0.0.0.0", 8, "ipv4"); // "this host" / unspecified
  list.addSubnet("10.0.0.0", 8, "ipv4"); // private
  list.addSubnet("100.64.0.0", 10, "ipv4"); // carrier-grade NAT
  list.addSubnet("127.0.0.0", 8, "ipv4"); // loopback
  list.addSubnet("169.254.0.0", 16, "ipv4"); // link-local (incl. 169.254.169.254)
  list.addSubnet("172.16.0.0", 12, "ipv4"); // private
  list.addSubnet("192.168.0.0", 16, "ipv4"); // private
  list.addSubnet("224.0.0.0", 4, "ipv4"); // multicast
  list.addSubnet("240.0.0.0", 4, "ipv4"); // reserved (incl. 255.255.255.255)

  // IPv6
  list.addAddress("::", "ipv6"); // unspecified
  list.addAddress("::1", "ipv6"); // loopback
  list.addSubnet("fe80::", 10, "ipv6"); // link-local
  list.addSubnet("fc00::", 7, "ipv6"); // unique-local

  return list;
})();

/**
 * Returns true when `ip` (a numeric IP literal) must not be fetched. Anything
 * that is not a parseable IPv4/IPv6 literal is treated as disallowed.
 */
export function isDisallowedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 0) {
    return true;
  }

  const type = version === 4 ? "ipv4" : "ipv6";
  if (blockedRanges.check(ip, type)) {
    return true;
  }

  // An IPv4-mapped IPv6 address (e.g. ::ffff:127.0.0.1) must also be checked
  // against the IPv4 ranges; BlockList does this when asked for "ipv4".
  if (version === 6 && blockedRanges.check(ip, "ipv4")) {
    return true;
  }

  return false;
}

/** Strip the brackets Node keeps around IPv6 hostnames (e.g. "[::1]"). */
function stripBrackets(host: string): string {
  return host.replace(/^\[|\]$/g, "");
}

/**
 * Validates that `rawUrl` is an http(s) URL and, if its host is an IP literal,
 * that the literal is not private/loopback/link-local. Returns the parsed
 * {@link URL}.
 *
 * Hostnames are intentionally NOT resolved here: the authoritative protection
 * for hostnames is the pinned {@link guardedLookup} used by
 * {@link ssrfSafeFetch}, which resolves and validates the host at connect time
 * (so the validated address is the connected address, with no rebinding
 * window). This function only performs the cheap, DNS-free checks.
 *
 * @throws {SsrfError} when the URL is malformed, not http(s), or has a
 *   disallowed IP-literal host.
 */
export function assertPublicHttpUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError(`Invalid URL: ${rawUrl}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfError(`Unsupported URL scheme: ${url.protocol}`);
  }

  const host = stripBrackets(url.hostname);
  if (isIP(host) && isDisallowedIp(host)) {
    throw new SsrfError(`URL host is a non-public address: ${host}`);
  }

  return url;
}

/**
 * A `dns.lookup`-compatible function that rejects resolution if ANY resolved
 * address is non-public. Passed to the HTTP(S) agent so the address that is
 * validated is the exact address the socket connects to — eliminating the
 * DNS-rebinding window between validation and connection.
 */
export const guardedLookup: LookupFunction = (hostname, options, callback) => {
  const family = typeof options === "number" ? options : options.family;
  const wantAll = typeof options === "object" && options.all === true;

  dnsLookup(
    hostname,
    { all: true, verbatim: true, ...(family ? { family } : {}) },
    (error, addresses) => {
      if (error) {
        callback(error, "", 0);
        return;
      }

      if (addresses.length === 0) {
        callback(
          new SsrfError(`Host did not resolve to any address: ${hostname}`),
          "",
          0,
        );
        return;
      }

      for (const { address } of addresses) {
        if (isDisallowedIp(address)) {
          callback(
            new SsrfError(
              `Host resolves to a non-public address: ${hostname} -> ${address}`,
            ),
            "",
            0,
          );
          return;
        }
      }

      if (wantAll) {
        // The `all` overload's callback receives the address array.
        (
          callback as unknown as (
            err: Error | null,
            a: typeof addresses,
          ) => void
        )(null, addresses);
        return;
      }

      callback(null, addresses[0].address, addresses[0].family);
    },
  );
};

function headersFrom(message: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(message.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }
  return headers;
}

const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

/**
 * Performs a single GET request with the connection pinned to a validated IP
 * via {@link guardedLookup}. Buffers the response into a {@link Response}.
 */
function guardedRequest(url: URL, init: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request(
      url,
      {
        method: "GET",
        lookup: guardedLookup,
        signal: init.signal ?? undefined,
      },
      (message) => {
        const chunks: Buffer[] = [];
        message.on("data", (chunk: Buffer) => chunks.push(chunk));
        message.on("end", () => {
          const status = message.statusCode ?? 502;
          const body = NULL_BODY_STATUSES.has(status)
            ? null
            : Buffer.concat(chunks);
          resolve(
            new Response(body, {
              status,
              statusText: message.statusMessage ?? "",
              headers: headersFrom(message),
            }),
          );
        });
        message.on("error", reject);
      },
    );

    request.on("error", reject);
    request.end();
  });
}

/**
 * Performs a `fetch`-like GET that is hardened against SSRF. Every URL — the
 * initial one and each redirect hop — is validated with
 * {@link assertPublicHttpUrl}, and the underlying connection is pinned to a
 * re-validated IP via {@link guardedLookup}, defeating direct internal targets,
 * redirect-to-internal, and DNS-rebinding attacks. Redirects are followed
 * manually up to {@link MAX_SSRF_FETCH_REDIRECTS}.
 *
 * @throws {SsrfError} when any hop fails validation or the redirect limit is hit.
 */
export async function ssrfSafeFetch(
  rawUrl: string,
  init: RequestInit = {},
): Promise<Response> {
  let currentUrl = rawUrl;

  for (let hop = 0; hop <= MAX_SSRF_FETCH_REDIRECTS; hop += 1) {
    const url = assertPublicHttpUrl(currentUrl);

    const response = await guardedRequest(url, init);

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
