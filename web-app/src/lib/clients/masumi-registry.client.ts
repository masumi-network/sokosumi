import "server-only";

import { getEnvPublicConfig } from "@/config/env.public";
import { getEnvSecrets } from "@/config/env.secrets";
import {
  postRegistryEntry,
  PostRegistryEntryResponse,
} from "@/lib/clients/generated/registry";
import { createClient } from "@/lib/clients/generated/registry/client";
import { Err, Ok, Result } from "@/lib/ts-res";

export const registryClient = (() => {
  const client = () => {
    const registryClient = createClient({
      baseUrl: getEnvSecrets().REGISTRY_API_URL,
    });
    registryClient.setConfig({
      headers: { token: getEnvSecrets().REGISTRY_API_KEY },
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
          network: getEnvPublicConfig().NEXT_PUBLIC_NETWORK,
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
        return Err(response.error ? String(response.error) : "Unknown error");
      }
      return Ok(response.data.data.entries);
    },
  };
})();
