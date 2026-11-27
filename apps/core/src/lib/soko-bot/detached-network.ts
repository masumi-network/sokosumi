import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";
import { readPreprodControl } from "@/helpers/preprod-control";
import { createNetworkScope } from "@/lib/db/network-scope";
import type { DbClient } from "@/lib/db/prisma";
import { isPreprodOn, requireNetwork } from "@/lib/network";

const refusals = {
  preprod_off: [403, "Preprod is switched off"],
  preprod_paused: [503, "Preprod is paused; try again later"],
  preprod_control_unavailable: [
    503,
    "Preprod's state could not be read; try again later",
  ],
  soko_bot_network_stale: [
    409,
    "This work belongs to a different Network or Preprod generation",
  ],
} as const;

export class DetachedNetworkRefusal extends HTTPException {
  constructor(readonly kind: keyof typeof refusals) {
    const [status, message] = refusals[kind];
    super(status, { message, cause: { kind, reportToSentry: false } });
  }

  get final() {
    return this.kind === CORE_API_ERROR_KINDS.SOKO_BOT_NETWORK_STALE;
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
