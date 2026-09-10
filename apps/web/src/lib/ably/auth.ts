import "server-only";

import { headers } from "next/headers";

import { CoreApiRequestError } from "@/lib/clients/core.request";
import { getCoreApiBaseUrl } from "@/lib/clients/utils/core-api-base-url";
import { joinCoreApiPath } from "@/lib/clients/utils/core-api-base-url.shared";

// 7s to Core, inside the 9s browser fetch of /api/ably/auth, inside ably-js's
// 10s realtimeRequestTimeout. Matching the browser hop at 10s let ably-js win
// and replace a classified 502 with an opaque timeout.
const CORE_ABLY_TOKEN_REQUEST_TIMEOUT_MS = 7000;

/**
 * Fetch an Ably TokenRequest from Core (membership-gated room caps, SOK-741;
 * org presence caps, ADR-0003).
 * Web keeps same-origin /api/ably/auth for the browser Realtime client.
 *
 * `getCoreApiBaseUrl()` already ends with `/v1` — do not prefix the path with `/v1`
 * again (that produced `/v1/v1/realtime/ably-token` and 404s on Core).
 */
export default async function createAuthTokenRequest(options?: {
  clientInstanceId?: string | null;
}) {
  const requestHeaders = await headers();
  const cookie = requestHeaders.get("cookie");
  const baseUrl = getCoreApiBaseUrl();

  const url = new URL(joinCoreApiPath(baseUrl, "/realtime/ably-token"));
  if (options?.clientInstanceId) {
    url.searchParams.set("clientInstanceId", options.clientInstanceId);
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...(cookie ? { cookie } : {}),
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(CORE_ABLY_TOKEN_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new CoreApiRequestError(
      `Core Ably token mint failed (${response.status})${detail ? `: ${detail}` : ""}`,
      { status: response.status },
    );
  }

  const body = (await response.json()) as {
    data?: unknown;
  };

  if (!body.data || typeof body.data !== "object") {
    throw new Error("Core Ably token mint returned an empty payload");
  }

  return body.data;
}
