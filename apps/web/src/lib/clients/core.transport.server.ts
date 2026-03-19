import { createClient } from "@/lib/clients/generated/core/client";

import type { CoreTransportAdapter } from "./core.transport";
import {
  coreApiBaseUrl,
  normalizeCoreApiBaseUrl,
} from "./core.transport.shared";

export const coreServerTransportAdapter: CoreTransportAdapter = {
  async createGeneratedClient() {
    const { headers } = await import("next/headers");

    return createClient({
      baseUrl: normalizeCoreApiBaseUrl(coreApiBaseUrl),
      headers: await headers(),
    });
  },
};
