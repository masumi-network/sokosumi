import "server-only";

import { headers } from "next/headers";

import { createClient } from "@/lib/clients/generated/core/client";
import { getServerCoreApiBaseUrl } from "@/lib/clients/utils/core-api-base-url";

import { createCoreClient } from "./core.shared";

export {
  type CoreApiMeta,
  type CoreApiPagination,
  CoreApiRequestError,
  type CoreApiResponse,
  type CoreDesignMdMetadata,
  type CorePreferredOrganization,
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

export const coreClient = createCoreClient(createCoreGeneratedClient);
