import "server-only";

import {
  buildAuthRequestHeadersForForwarding,
  sanitizeForwardCookieHeader,
} from "@/lib/auth/forward-cookies";
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
    authHeaders.cookie = sanitizeForwardCookieHeader(cookie);
  }

  return authHeaders;
}

async function createCoreGeneratedClient() {
  return createClient({
    baseUrl: getServerCoreApiBaseUrl(),
    headers: buildAuthHeaders(await buildAuthRequestHeadersForForwarding()),
  });
}

export const coreClient = createCoreClient(createCoreGeneratedClient);
