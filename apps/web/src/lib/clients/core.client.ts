import "server-only";

import { headers } from "next/headers";
import { withUnauthorizedCoreRedirect } from "@/lib/auth/handle-unauthorized-core-error";
import { createClient } from "@/lib/clients/generated/core/client";
import { getServerCoreApiBaseUrl } from "@/lib/clients/utils/core-api-base-url";
import { createCoreClient } from "./core.shared";

export {
  CoreApiRequestError,
  mapCoreApiStatusToCommonErrorCode,
  toCoreApiActionError,
} from "./core.request";

export {
  type CoreApiMeta,
  type CoreApiPagination,
  type CoreApiResponse,
} from "./core.shared";

export function buildAuthHeaders(requestHeaders: Headers): HeadersInit {
  const authHeaders: HeadersInit = {};
  const cookie = requestHeaders.get("cookie");

  if (cookie) {
    authHeaders.cookie = cookie;
  }

  return authHeaders;
}

async function createCoreGeneratedClient() {
  return createClient({
    baseUrl: getServerCoreApiBaseUrl(),
    headers: buildAuthHeaders(await headers()),
  });
}

const rawCoreClient = createCoreClient(createCoreGeneratedClient);

export const coreClient = withUnauthorizedCoreRedirect(rawCoreClient);

/**
 * Unwrapped Core client — bypasses the session-401 → signin redirect proxy.
 *
 * Prefer the redirecting `coreClient` for normal server reads. Use this when a
 * caller must handle 401 itself (for example an action that maps auth failure
 * to a toast) or when the surrounding RSC already proved the session via
 * `coreClient`. Business 403s no longer redirect through the proxy.
 */
export const coreClientNoRedirect = rawCoreClient;
