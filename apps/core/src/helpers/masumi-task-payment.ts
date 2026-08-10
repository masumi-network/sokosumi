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
 * The registry policy or an explicit `Web3CardanoV2` declaration decides the
 * rail. A `supportedPaymentSourceIndex` is only source metadata: sellers on a
 * newer SDK can echo it on V1 responses, so it cannot classify the rail by
 * itself.
 */
export function isV2MasumiTaskPayment(
  payment: MasumiTaskPaymentRailFields,
): boolean {
  return (
    payment.paymentSourceType === "Web3CardanoV2" ||
    isV2RegistryIdentifier(payment.agentIdentifier)
  );
}

/**
 * A payload whose declared rail contradicts its identifier: the identifier is
 * minted under the V2 registry policy, so the payment node infers V2 and
 * rejects the mismatched `Web3CardanoV1` with a 400. Catch this before credits
 * move instead of relying on asynchronous compensation for known-invalid input.
 */
export function hasContradictoryMasumiTaskPaymentRail(
  payment: MasumiTaskPaymentRailFields,
): boolean {
  return (
    payment.paymentSourceType === "Web3CardanoV1" &&
    isV2RegistryIdentifier(payment.agentIdentifier)
  );
}
