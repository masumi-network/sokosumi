import { createClient } from "@/lib/clients/generated/core/client";

import type { CoreTransportAdapter } from "./core.transport";
import {
  buildAuthHeaders,
  coreApiBaseUrl,
  normalizeCoreApiBaseUrl,
} from "./core.transport.shared";

export const coreServerTransportAdapter: CoreTransportAdapter = {
  async createGeneratedClient() {
    const { headers } = await import("next/headers");
    const requestHeaders = await headers();
    console.log("server core base url", coreApiBaseUrl);
    return createClient({
      baseUrl: normalizeCoreApiBaseUrl(coreApiBaseUrl),
      headers: buildAuthHeaders(requestHeaders),
    });
  },
};
