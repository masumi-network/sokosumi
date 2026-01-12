import { err, ok, Result } from "neverthrow";

import { getEnv } from "@/config/env";

import {
  postRegistryDiff,
  type PostRegistryDiffResponse,
  postRegistryEntry,
  type PostRegistryEntryResponse,
} from "./openapi/generated/registry";
import { createClient } from "./openapi/generated/registry/client";

export const registryClient = (() => {
  const client = () => {
    const registryClient = createClient({
      baseUrl: getEnv().REGISTRY_API_URL,
    });
    registryClient.setConfig({
      headers: { token: getEnv().REGISTRY_API_KEY },
    });
    return registryClient;
  };

  return {
    async getAgents(
      lastIdentifier: string | undefined,
      limit: number = 20,
    ): Promise<Result<PostRegistryEntryResponse["data"]["entries"], string>> {
      const response = await postRegistryEntry({
        client: client(),
        body: {
          network: getEnv().NETWORK,
          limit,
          cursorId: lastIdentifier,
          filter: {
            status: ["Online", "Offline", "Deregistered", "Invalid"],
            paymentTypes: ["Web3CardanoV1", "None"],
          },
        },
      });
      if (
        !response.data ||
        response.error ||
        !response.data.data ||
        response.response.status !== 200
      ) {
        console.error("Error in sync operation:", response.error);
        return err(response.error ? String(response.error) : "Unknown error");
      }
      return ok(response.data.data.entries);
    },

    async getAgentsDiff(
      statusUpdatedAfter: Date,
      cursorId: string | null,
      limit: number = 20,
    ): Promise<Result<PostRegistryDiffResponse["data"]["entries"], string>> {
      const response = await postRegistryDiff({
        client: client(),
        body: {
          network: getEnv().NETWORK,
          statusUpdatedAfter,
          cursorId: cursorId ?? undefined,
          limit,
        },
      });
      if (
        !response.data ||
        response.error ||
        !response.data.data ||
        response.response.status !== 200
      ) {
        console.error("Error in diff sync operation:", response.error);
        return err(response.error ? String(response.error) : "Unknown error");
      }
      return ok(response.data.data.entries);
    },
  };
})();
