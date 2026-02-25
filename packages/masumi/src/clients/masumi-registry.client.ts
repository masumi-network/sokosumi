import { err, ok, Result } from "neverthrow";

import { createClient } from "./openapi/generated/registry/client/index.js";
import {
  postRegistryDiff,
  PostRegistryDiffResponse,
  postRegistryEntry,
  PostRegistryEntryResponse,
} from "./openapi/generated/registry/index.js";

interface RegistryClientRequestOptions {
  signal?: AbortSignal;
}

export function createRegistryClient(
  network: "Preprod" | "Mainnet",
  apiUrl: string,
  apiKey: string,
) {
  const client = () => {
    const registryClient = createClient({
      baseUrl: apiUrl,
    });
    registryClient.setConfig({
      headers: { token: apiKey },
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
          network,
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
      options: RegistryClientRequestOptions = {},
    ): Promise<Result<PostRegistryDiffResponse["data"]["entries"], string>> {
      const response = await postRegistryDiff({
        client: client(),
        body: {
          network,
          statusUpdatedAfter,
          cursorId: cursorId ?? undefined,
          limit,
        },
        signal: options.signal,
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
}
