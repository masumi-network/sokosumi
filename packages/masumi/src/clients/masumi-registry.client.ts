import { err, ok, type Result } from "neverthrow";

import { extractNodeErrorMessageForLog } from "./node-error.js";
import { createClient } from "./openapi/generated/registry/client/index.js";
import {
  type PostRegistryDiffResponse,
  postRegistryDiff,
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
        response.response?.status !== 200
      ) {
        // Not `String(response.error)`: that is the registry's response body
        // verbatim, and `apps/core/src/services/agent-sync.service.ts` logs
        // this string. A proxy answering for the registry decides its length
        // and its content, so the whole page would reach stdout unbounded.
        //
        // The ForLog variant, because no caller echoes this value. The plain
        // one returns an envelope-shaped message whole, which leaves the far
        // side free to pick the length after all.
        return err(
          response.error
            ? extractNodeErrorMessageForLog(response.error, apiKey)
            : "Unknown error",
        );
      }
      return ok(response.data.data.entries);
    },
  };
}
