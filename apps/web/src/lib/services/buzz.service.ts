import "server-only";

import type { BuzzConnection } from "@sokosumi/core-client";
import { coreClient } from "@/lib/clients/core.client";

export const buzzService = {
  async getConnection(): Promise<BuzzConnection> {
    const response = await coreClient.getBuzzConnection();
    return response.data;
  },
};
