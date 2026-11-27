import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";
import { readPreprodControl } from "@/helpers/preprod-control";
import { createNetworkScope } from "@/lib/db/network-scope";
import type { DbClient } from "@/lib/db/prisma";
import { isPreprodOn, type Network, requireNetwork } from "@/lib/network";

import { DetachedNetworkRefusal } from "./detached-network-refusal";

export { DetachedNetworkRefusal } from "./detached-network-refusal";

export interface DetachedTurnProvenance {
  network: Network;
  expectedPreprodGeneration?: number | null;
}

export function turnProvenance(row: {
  network: string | null;
  preprodGeneration: number | null;
}): DetachedTurnProvenance {
  const network = requireNetwork(row.network);
  return network === "preprod"
    ? { network, expectedPreprodGeneration: row.preprodGeneration }
    : { network };
}

/** A writer can refuse a Preprod turn after pickup. */
export function isTemporaryDetachedRefusal(
  network: string | null,
  error: unknown,
): boolean {
  if (network !== "preprod") return false;
  if (error instanceof DetachedNetworkRefusal) return !error.final;
  if (!(error instanceof HTTPException) || error.status !== 503) return false;
  const { cause } = error;
  if (typeof cause !== "object" || cause === null || !("kind" in cause)) {
    return false;
  }
  return (
    cause.kind === CORE_API_ERROR_KINDS.PREPROD_PAUSED ||
    cause.kind === CORE_API_ERROR_KINDS.PREPROD_CONTROL_UNAVAILABLE
  );
}

export function requireDetachedTurnProvenance(
  expected: DetachedTurnProvenance,
  stored: { network: string | null; preprodGeneration?: number | null },
): void {
  if (
    expected.expectedPreprodGeneration !== undefined &&
    (expected.network !== stored.network ||
      expected.expectedPreprodGeneration !== stored.preprodGeneration)
  ) {
    throw new DetachedNetworkRefusal(
      CORE_API_ERROR_KINDS.SOKO_BOT_NETWORK_STALE,
    );
  }
}

/** The read of both control keys is the resume point for Preprod work. */
export async function detachedNetworkScope(
  row: {
    network: string | null;
    preprodGeneration: number | null;
  },
  db?: DbClient,
) {
  if (row.network === null) {
    throw new DetachedNetworkRefusal(
      CORE_API_ERROR_KINDS.SOKO_BOT_NETWORK_STALE,
    );
  }
  const network = requireNetwork(row.network);
  if (network === "preprod") {
    if (!isPreprodOn()) {
      throw new DetachedNetworkRefusal(CORE_API_ERROR_KINDS.PREPROD_OFF);
    }
    const control = await readPreprodControl(db);
    if (control.state === "unavailable") {
      throw new DetachedNetworkRefusal(
        CORE_API_ERROR_KINDS.PREPROD_CONTROL_UNAVAILABLE,
      );
    }
    if (control.generation !== row.preprodGeneration) {
      throw new DetachedNetworkRefusal(
        CORE_API_ERROR_KINDS.SOKO_BOT_NETWORK_STALE,
      );
    }
    if (control.state === "paused") {
      throw new DetachedNetworkRefusal(CORE_API_ERROR_KINDS.PREPROD_PAUSED);
    }
  }
  return createNetworkScope(network);
}
