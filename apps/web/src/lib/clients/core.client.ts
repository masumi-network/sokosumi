import "server-only";

import { headers } from "next/headers";
import { withUnauthorizedCoreRedirect } from "@/lib/auth/handle-unauthorized-core-error";
import { createClient } from "@/lib/clients/generated/core/client";
import { getServerCoreApiBaseUrl } from "@/lib/clients/utils/core-api-base-url";
import { createCoreClient } from "./core.shared";

export {
  type CoreApiMeta,
  type CoreApiPagination,
  CoreApiRequestError,
  type CoreApiResponse,
  mapCoreApiStatusToCommonErrorCode,
  toCoreApiActionError,
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
 * The redirect proxy is session-401 only; business 403s no longer redirect.
 * This escape hatch is still useful where you want to avoid even a 401 redirect.
 *
 * Use this for endpoints where a 403/404/409 is a *business verdict about the
 * resource*, not a session-auth failure. The Hermes skills endpoints return 403
 * ("skill blocked by audit policy"), 409 ("slug conflict") and 404 ("instance
 * not found") as expected install outcomes. The page these actions run on is an
 * RSC that already guards genuine auth via the redirecting client.
 */
export const coreClientNoRedirect = rawCoreClient;
