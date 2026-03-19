import { createClient } from "@/lib/clients/generated/core/client";

import type { CoreTransportAdapter } from "./core.transport";
import {
  coreApiBaseUrl,
  normalizeCoreApiBaseUrl,
} from "./core.transport.shared";

export const coreBrowserTransportAdapter: CoreTransportAdapter = {
  async createGeneratedClient() {
    const baseUrl = normalizeCoreApiBaseUrl(coreApiBaseUrl);
    console.log("browser core base url", baseUrl);
    return createClient({
      baseUrl,
      credentials: "include",
    });
  },
};
