import { createClient } from "@/lib/clients/generated/core/client";
import { buildCalendarClientVersionHeaders } from "@/lib/clients/utils/calendar-client-version-headers";
import { getBrowserCoreApiBaseUrl } from "@/lib/clients/utils/core-api-base-url.browser";
import { attachCoreRequestIdInterceptor } from "@/lib/clients/utils/core-request-id";
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
  browserGeneratedClient ??= attachCoreRequestIdInterceptor(
    createClient({
      baseUrl: getBrowserCoreApiBaseUrl(),
      credentials: "include",
      headers: buildCalendarClientVersionHeaders(),
    }),
  );

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
