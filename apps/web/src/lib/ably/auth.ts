import "server-only";

import { headers } from "next/headers";

import { getCoreApiBaseUrl } from "@/lib/clients/utils/core-api-base-url";
import { joinCoreApiPath } from "@/lib/clients/utils/core-api-base-url.shared";

/** Match Core auth proxy timeouts in apps/web/src/lib/auth/auth.server.ts */
const CORE_ABLY_TOKEN_REQUEST_TIMEOUT_MS = 5000;

/**
 * Fetch an Ably TokenRequest from Core (membership-gated room caps, SOK-741).
 * Web keeps same-origin /api/ably/auth for the browser Realtime client.
 *
 * `getCoreApiBaseUrl()` already ends with `/v1` — do not prefix the path with `/v1`
 * again (that produced `/v1/v1/realtime/ably-token` and 404s on Core).
 */
export default async function createAuthTokenRequest() {
  const requestHeaders = await headers();
  const cookie = requestHeaders.get("cookie");
  const baseUrl = getCoreApiBaseUrl();

  const response = await fetch(
    joinCoreApiPath(baseUrl, "/realtime/ably-token"),
    {
      method: "POST",
      headers: {
        ...(cookie ? { cookie } : {}),
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(CORE_ABLY_TOKEN_REQUEST_TIMEOUT_MS),
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Core Ably token mint failed (${response.status})${detail ? `: ${detail}` : ""}`,
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
