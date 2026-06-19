import "server-only";

import { createAuthClient } from "better-auth/client";
import { headers } from "next/headers";

import { getEnvSecrets } from "@/config/env.secrets";
import { buildAuthHeaders } from "@/lib/clients/core.client";
import { getServerCoreAppBaseUrl } from "@/lib/clients/utils/core-api-base-url";
import { joinCoreApiPath } from "@/lib/clients/utils/core-api-base-url.shared";

import { getAuthClientPlugins } from "./auth-client.plugins";

const CORE_AUTH_BASE_PATH = "/auth";
const CORE_AUTH_REQUEST_TIMEOUT_MS = 5000;

export function getCoreAuthBaseUrl(): string {
  return joinCoreApiPath(getServerCoreAppBaseUrl(), CORE_AUTH_BASE_PATH);
}

/**
 * Resolves the origin Core's Better Auth should see for its CSRF origin check.
 * Prefers the caller's `Origin` header (present on browser-initiated server
 * actions); otherwise reconstructs it from the request `Host` (present on every
 * request, including render-time navigations that omit `Origin`). Both resolve
 * to the web app's own host — app.sokosumi.com, *.preview.sokosumi.com, or
 * localhost — which Core lists in its trusted origins.
 */
export function resolveWebRequestOrigin(
  requestHeaders: Headers,
): string | undefined {
  const explicitOrigin = requestHeaders.get("origin");
  if (explicitOrigin) {
    return explicitOrigin;
  }

  const host = requestHeaders.get("host");
  if (!host) {
    return undefined;
  }

  const proto =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Server-side fetch to Core `/auth` with session cookies and Origin forwarding.
 * Use for Better Auth server-only endpoints that are not on the typed client.
 */
export async function fetchCoreAuth(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const requestHeaders = await headers();
  const mergedHeaders = new Headers(init?.headers);

  new Headers(buildAuthHeaders(requestHeaders)).forEach((value, key) => {
    mergedHeaders.set(key, value);
  });

  const vercelOidcToken = getEnvSecrets().VERCEL_OIDC_TOKEN;
  if (vercelOidcToken) {
    mergedHeaders.set("x-vercel-trusted-oidc-idp-token", vercelOidcToken);
  }

  // Core's Better Auth rejects state-changing requests without a trusted
  // Origin ("Missing or null Origin"). Server-to-server fetches carry no
  // browser Origin, so forward the caller's origin explicitly.
  if (!mergedHeaders.has("origin")) {
    const origin = resolveWebRequestOrigin(requestHeaders);
    if (origin) {
      mergedHeaders.set("origin", origin);
    }
  }

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
      customFetchImpl: fetchCoreAuth,
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
