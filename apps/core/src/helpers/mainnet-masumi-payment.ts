import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { forbidden } from "@/helpers/error";
import { isNetworkRoutingEnabled, type Network } from "@/lib/network";

/** Jobs (ticket 25) and Coworker Task payments (ticket 29) still book on Mainnet. */
export function requireMainnetMasumiPayment(scope: {
  readonly network: Network;
}) {
  if (isNetworkRoutingEnabled() && scope.network !== "mainnet") {
    throw forbidden("This payment operation is only available on Mainnet", {
      kind: CORE_API_ERROR_KINDS.NETWORK_MISMATCH,
    });
  }
}
