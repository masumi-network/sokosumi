import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";

import type { HTTPExceptionMetadata } from "@/helpers/error";
import {
  type NetworkScope,
  networkUsesSharedSchema,
} from "@/lib/db/network-scope";

/** A mixed response can still read its shared rows when its Job scope is refused. */
export function requestJobScope(scope: NetworkScope): NetworkScope | null {
  try {
    void scope.network;
    return scope;
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403) {
      const kind = (error.cause as HTTPExceptionMetadata | undefined)?.kind;
      if (
        kind === CORE_API_ERROR_KINDS.PREPROD_OFF ||
        kind === CORE_API_ERROR_KINDS.PREPROD_ACCESS_REQUIRED ||
        kind === CORE_API_ERROR_KINDS.API_KEY_NETWORK_MISMATCH
      ) {
        return null;
      }
    }
    throw error;
  }
}

export function usesSharedMainnetJobs(scope: NetworkScope | null): boolean {
  return scope?.network === "mainnet" && networkUsesSharedSchema();
}
