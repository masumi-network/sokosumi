import { err, ok, type Result } from "neverthrow";

import { extractNodeErrorMessageForLog } from "./node-error.js";
import { createClient } from "./openapi/generated/registry/client/index.js";
import {
  type PostRegistryDiffResponse,
  type PostRegistryEntryData,
  type PostRegistryEntryResponse,
  postRegistryDiff,
  postRegistryEntry,
} from "./openapi/generated/registry/index.js";

interface RegistryClientRequestOptions {
  signal?: AbortSignal;
}

type RegistryEntryStatus = NonNullable<
  NonNullable<NonNullable<PostRegistryEntryData["body"]>["filter"]>["status"]
>[number];

export type RegistryEntry =
  PostRegistryEntryResponse["data"]["entries"][number];

export interface ListRegistryEntriesParams {
  cursorId?: string;
  limit: number;
  /** Omit to return every status. */
  status?: RegistryEntryStatus[];
}

interface RegistryEntriesResult<TEntry> {
  data?: { data?: { entries: TEntry[] } };
  error?: unknown;
  response?: { status: number };
}

function readEntries<TEntry>(
  result: RegistryEntriesResult<TEntry>,
  apiKey: string,
): Result<TEntry[], string> {
  if (
    !result.data ||
    result.error ||
    !result.data.data ||
    result.response?.status !== 200
  ) {
    // Not `String(result.error)`: that is the registry's response body
    // verbatim, and callers log this string. A proxy answering for the
    // registry decides its length and its content, so the whole page would
    // reach stdout unbounded.
    //
    // The ForLog variant, because no caller echoes this value. The plain
    // one returns an envelope-shaped message whole, which leaves the far
    // side free to pick the length after all.
    return err(
      result.error
        ? extractNodeErrorMessageForLog(result.error, apiKey)
        : "Unknown error",
    );
  }
  return ok(result.data.data.entries);
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
      return readEntries(response, apiKey);
    },

    /**
     * One page of registry entries for this client's network, newest id
     * first. The registry's cursor is inclusive: a page fetched with
     * `cursorId` starts with that entry again.
     */
    async listEntries(
      params: ListRegistryEntriesParams,
      options: RegistryClientRequestOptions = {},
    ): Promise<Result<RegistryEntry[], string>> {
      const response = await postRegistryEntry({
        client: client(),
        body: {
          network,
          limit: params.limit,
          cursorId: params.cursorId,
          filter: params.status ? { status: params.status } : undefined,
        },
        signal: options.signal,
      });
      return readEntries(response, apiKey);
    },
  };
}
