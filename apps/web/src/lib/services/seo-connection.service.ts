import "server-only";

import type { SeoConnectionStatus } from "@sokosumi/core-client";
import {
  connectSeoConnection,
  disconnectSeoConnection,
  finalizeSeoConnection,
  getSeoConnection,
} from "@sokosumi/core-client";
import { createCoreGeneratedClient } from "@/lib/clients/core.client";
import { executeCoreOperation } from "@/lib/clients/core.request";

export type SeoConnectionProvider = SeoConnectionStatus["provider"];

export const seoConnectionService = {
  async get(provider: SeoConnectionProvider) {
    const response = await executeCoreOperation(
      createCoreGeneratedClient,
      (client) =>
        getSeoConnection({ client, path: { provider }, cache: "no-store" }),
      "Failed to load SEO connection",
    );
    return response.data;
  },
  async connect(provider: SeoConnectionProvider, callbackUrl: string) {
    const response = await executeCoreOperation(
      createCoreGeneratedClient,
      (client) =>
        connectSeoConnection({
          client,
          path: { provider },
          body: { callbackUrl },
        }),
      "Failed to connect SEO statistics",
    );
    return response.data;
  },
  async finalize(
    provider: SeoConnectionProvider,
    connectionId?: string,
    sessionUri?: string,
  ) {
    const response = await executeCoreOperation(
      createCoreGeneratedClient,
      (client) =>
        finalizeSeoConnection({
          client,
          path: { provider },
          body: { connectionId, sessionUri },
        }),
      "Failed to finalize SEO connection",
    );
    return response.data;
  },
  async disconnect(provider: SeoConnectionProvider) {
    const response = await executeCoreOperation(
      createCoreGeneratedClient,
      (client) => disconnectSeoConnection({ client, path: { provider } }),
      "Failed to disconnect SEO statistics",
    );
    return response.data;
  },
};
