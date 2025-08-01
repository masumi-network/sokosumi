import "server-only";

import { getEnvPublicConfig } from "@/config/env.public";
import { getEnvSecrets } from "@/config/env.secrets";
import { postRegistryEntry } from "@/lib/api/generated/registry";
import { createClient } from "@/lib/api/generated/registry/client";

const client = () => {
  const registryClient = createClient({
    baseUrl: getEnvSecrets().REGISTRY_API_URL,
  });
  registryClient.setConfig({
    headers: { token: getEnvSecrets().REGISTRY_API_KEY },
  });
  return registryClient;
};

export const registryClient = {
  async getAgents(lastIdentifier: string | undefined, limit: number = 20) {
    const response = await postRegistryEntry({
      client: client(),
      body: {
        network: getEnvPublicConfig().NEXT_PUBLIC_NETWORK,
        limit,
        cursorId: lastIdentifier,
        filter: {
          status: ["Online", "Offline", "Deregistered", "Invalid"],
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
      return [];
    }
    const entries = response.data.data.entries;
    return entries;
  },
};
