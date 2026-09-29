import "server-only";

import { createClient } from "@sokosumi/core-client/client";
import { buildCalendarClientVersionHeaders } from "@/lib/clients/utils/calendar-client-version-headers";
import { getServerCoreApiBaseUrl } from "@/lib/clients/utils/core-api-base-url";

import { createCoreClient } from "./core.shared";

/**
 * Cookie-free Core client for global catalog reads only.
 *
 * Safe inside `'use cache'` — does not call `headers()` / `cookies()`.
 * Do not add authenticated methods here; use session `coreClient` instead.
 */
function createCatalogGeneratedClient() {
  return createClient({
    baseUrl: getServerCoreApiBaseUrl(),
    headers: buildCalendarClientVersionHeaders(),
  });
}

const catalogCoreClient = createCoreClient(createCatalogGeneratedClient);

export const coreCatalogClient = {
  getAgents: catalogCoreClient.getAgents,
  getCategories: catalogCoreClient.getCategories,
};
