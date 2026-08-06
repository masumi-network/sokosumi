import "server-only";

import { headers } from "next/headers";

import { getCoreApiBaseUrl } from "@/lib/clients/utils/core-api-base-url";

/**
 * Fetch an Ably TokenRequest from Core (membership-gated room caps, SOK-741).
 * Web keeps same-origin /api/ably/auth for the browser Realtime client.
 */
export default async function createAuthTokenRequest() {
  const requestHeaders = await headers();
  const cookie = requestHeaders.get("cookie");
  const baseUrl = getCoreApiBaseUrl();

  const response = await fetch(`${baseUrl}/v1/realtime/ably-token`, {
    method: "POST",
    headers: {
      ...(cookie ? { cookie } : {}),
      Accept: "application/json",
    },
    cache: "no-store",
  });

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
