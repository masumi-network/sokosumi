import {
  applyCoreRequestIdHeader,
  CORE_REQUEST_ID_HEADER,
} from "./core-request-id";

/**
 * Builds headers for server-side `fetch()` from the Next.js app to Core.
 *
 * Do not pass `headers()` directly into `fetch()`: on Vercel the incoming request
 * can include hop-by-hop headers (e.g. `transfer-encoding`). Undici rejects those
 * on outbound requests with `InvalidArgumentError: invalid transfer-encoding header`,
 * which surfaces as `TypeError: fetch failed` and a 500 from `/api/chat`.
 */
export function buildCoreChatProxyHeaders(headerSource: Headers): Headers {
  const out = new Headers();
  const cookie = headerSource.get("cookie");
  if (cookie) {
    out.set("cookie", cookie);
  }
  const authorization = headerSource.get("authorization");
  if (authorization) {
    out.set("authorization", authorization);
  }
  const organizationSlug = headerSource.get("x-organization-slug");
  if (organizationSlug) {
    out.set("x-organization-slug", organizationSlug);
  }
  const incomingRequestId = headerSource.get(CORE_REQUEST_ID_HEADER);
  if (incomingRequestId) {
    out.set(CORE_REQUEST_ID_HEADER, incomingRequestId);
  }
  applyCoreRequestIdHeader(out);
  return out;
}
