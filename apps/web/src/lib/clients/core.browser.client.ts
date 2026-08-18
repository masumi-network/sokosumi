import { createClient } from "@/lib/clients/generated/core/client";
import { getBrowserCoreApiBaseUrl } from "@/lib/clients/utils/core-api-base-url.browser";

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

let browserGeneratedClient: ReturnType<typeof createClient> | undefined;

function getBrowserGeneratedClient() {
  browserGeneratedClient ??= createClient({
    baseUrl: getBrowserCoreApiBaseUrl(),
    credentials: "include",
  });

  return browserGeneratedClient;
}

/**
 * Raw generated Core API client (browser).
 * Use for calling generated SDK functions that aren't wrapped in coreClient.
 */
export function getBrowserCoreClient() {
  return getBrowserGeneratedClient();
}

export const coreClient = createCoreClient(getBrowserGeneratedClient);
