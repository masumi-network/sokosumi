import "server-only";

import { createAuthClient } from "better-auth/client";
import { headers } from "next/headers";

import { buildAuthHeaders } from "@/lib/clients/core.client";
import { getServerCoreAppBaseUrl } from "@/lib/clients/utils/core-api-base-url";
import { joinCoreApiPath } from "@/lib/clients/utils/core-api-base-url.shared";

import { getAuthClientPlugins } from "./auth-client.plugins";

const CORE_AUTH_BASE_PATH = "/auth";
const CORE_AUTH_REQUEST_TIMEOUT_MS = 5000;

function getCoreAuthBaseUrl(): string {
  return joinCoreApiPath(getServerCoreAppBaseUrl(), CORE_AUTH_BASE_PATH);
}

async function coreAuthFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const authHeaders = buildAuthHeaders(await headers());
  const mergedHeaders = new Headers(init?.headers);

  for (const [key, value] of Object.entries(authHeaders)) {
    if (value !== undefined) {
      mergedHeaders.set(key, value);
    }
  }

  return fetch(input, {
    ...init,
    headers: mergedHeaders,
    cache: "no-store",
    signal: init?.signal ?? AbortSignal.timeout(CORE_AUTH_REQUEST_TIMEOUT_MS),
  });
}

/**
 * Better Auth client for server-side calls to Core `/auth`.
 * Forwards the incoming request cookies on every fetch.
 */
export const authServerClient = createAuthClient({
  baseURL: getCoreAuthBaseUrl(),
  plugins: getAuthClientPlugins(),
  disableDefaultFetchPlugins: true,
  fetchOptions: {
    customFetchImpl: coreAuthFetch,
  },
});
