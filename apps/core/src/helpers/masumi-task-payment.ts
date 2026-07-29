import { isV2RegistryIdentifier } from "@sokosumi/masumi";

/**
 * The subset of a task `masumiPayment` payload that decides which rail it
 * settles on. Kept structural so both the request schema (pre-parse refine)
 * and the charge path (post-parse) can share one classifier.
 */
export interface MasumiTaskPaymentRailFields {
  agentIdentifier: string;
  paymentSourceType?: "Web3CardanoV1" | "Web3CardanoV2";
  supportedPaymentSourceIndex?: number;
}

/**
 * Whether a task payment settles on the Cardano V2 rail.
 *
 * An EXPLICIT `Web3CardanoV1` wins over a stray `supportedPaymentSourceIndex`:
 * sellers on a newer SDK echo the index on V1 responses, and classifying those
 * as V2 would reject them outright while the rollout flag is off. Absent an
 * explicit type, the index or the registry policy of the identifier decides.
 */
export function isV2MasumiTaskPayment(
  payment: MasumiTaskPaymentRailFields,
): boolean {
  if (payment.paymentSourceType === "Web3CardanoV1") {
    return isV2RegistryIdentifier(payment.agentIdentifier);
  }
  return (
    payment.paymentSourceType === "Web3CardanoV2" ||
    payment.supportedPaymentSourceIndex !== undefined ||
    isV2RegistryIdentifier(payment.agentIdentifier)
  );
}

/**
 * A payload whose declared rail contradicts its identifier: the identifier is
 * minted under the V2 registry policy, so the payment node infers V2 and
 * rejects the mismatched `Web3CardanoV1` with a 400. Task-event charges commit
 * before the purchase is created and have no compensation path, so this has to
 * be caught before the credits move.
 */
export function hasContradictoryMasumiTaskPaymentRail(
  payment: MasumiTaskPaymentRailFields,
): boolean {
  return (
    payment.paymentSourceType === "Web3CardanoV1" &&
    isV2RegistryIdentifier(payment.agentIdentifier)
  );
}
