import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";

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
