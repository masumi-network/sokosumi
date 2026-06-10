import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import { useAgent } from "request-filtering-agent";

/**
 * Maximum number of HTTP redirects {@link ssrfSafeFetch} will follow before
 * giving up. Each hop is re-validated and re-pinned, so this only bounds the
 * length of redirect chains.
 */
export const MAX_SSRF_FETCH_REDIRECTS = 5;

/**
 * Raised when a URL is rejected by the SSRF guard (malformed or non-http(s)).
 * Address-level rejections (private/loopback/link-local hosts) are raised by
 * the request-filtering agent at connect time.
 */
export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

/**
 * Validates that `rawUrl` is a well-formed http(s) URL and returns the parsed
 * {@link URL}. This is a cheap, DNS-free pre-check; the authoritative SSRF
 * protection is the per-connection address filtering applied in
 * {@link guardedRequest}.
 *
 * @throws {SsrfError} when the URL is malformed or not http(s).
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

  return url;
}

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
 * Performs a single GET request whose connection is filtered by
 * `request-filtering-agent`: the agent resolves the host and aborts the
 * connection if it targets a private, loopback, or link-local address. Because
 * the check happens at connect time on the resolved address, the validated
 * address is the connected address — closing the DNS-rebinding window.
 */
function guardedRequest(url: URL, init: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request(
      url,
      {
        method: "GET",
        agent: useAgent(url.href),
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
 * Performs a `fetch`-like GET that is hardened against SSRF. The URL scheme is
 * validated for every hop, and the underlying connection is filtered against
 * private/loopback/link-local addresses by `request-filtering-agent` — at
 * connect time, so it also defeats DNS-rebinding and redirect-to-internal.
 * Redirects are followed manually up to {@link MAX_SSRF_FETCH_REDIRECTS}.
 *
 * @throws {SsrfError} when a hop fails URL validation or the redirect limit is
 *   hit. Address-blocked connections reject with the agent's own error.
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
