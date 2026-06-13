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

  new Headers(authHeaders).forEach((value, key) => {
    mergedHeaders.set(key, value);
  });

  return fetch(input, {
    ...init,
    headers: mergedHeaders,
    cache: "no-store",
    signal: init?.signal ?? AbortSignal.timeout(CORE_AUTH_REQUEST_TIMEOUT_MS),
  });
}

function createConfiguredAuthServerClient() {
  return createAuthClient({
    baseURL: getCoreAuthBaseUrl(),
    plugins: getAuthClientPlugins(),
    disableDefaultFetchPlugins: true,
    fetchOptions: {
      customFetchImpl: coreAuthFetch,
    },
  });
}

type AuthServerClient = ReturnType<typeof createConfiguredAuthServerClient>;

let authServerClient: AuthServerClient | undefined;

/**
 * Better Auth client for server-side calls to Core `/auth`.
 * Lazily created so importing this module in tests does not read server env.
 */
export function getAuthServerClient(): AuthServerClient {
  authServerClient ??= createConfiguredAuthServerClient();
  return authServerClient;
}
