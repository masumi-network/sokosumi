const V2_VERSION_HEX_LENGTH = 6;
const POLICY_ID_HEX_LENGTH = 56;
const V2_STABLE_ASSET_NAME_HEX_LENGTH = 58;
const V2_AGENT_IDENTIFIER_HEX_LENGTH =
  POLICY_ID_HEX_LENGTH +
  V2_STABLE_ASSET_NAME_HEX_LENGTH +
  V2_VERSION_HEX_LENGTH;
const HEX_PATTERN = /^[0-9a-f]+$/i;

/**
 * The Masumi V2 registry minting policy. The validator is unparameterized, so
 * the policy hash is identical on Preprod and Mainnet (mirrors
 * masumi-registry-service isV2Policy).
 *
 * LOCKSTEP REQUIREMENT: this set is the only involuntary V2 trigger for
 * payloads that omit paymentSourceType and supportedPaymentSourceIndex (both
 * legitimately optional). If Masumi ever mints under a second V2 registry
 * policy, it MUST be added here before the payment node serves it, or such
 * payloads bypass the V2 readiness gates and charge before failing at the
 * node.
 */
const V2_REGISTRY_POLICY_IDS = new Set([
  "67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b",
]);

/**
 * Whether an agent identifier was minted by the V2 registry policy. Version
 * semantics (stable identity + 3-byte version suffix) apply to ALL V2-policy
 * assets regardless of their payment type — free and EVM-only V2 agents are
 * versioned too.
 */
export function isV2RegistryIdentifier(agentIdentifier: string): boolean {
  // Case-insensitive on purpose: hex casing must not decide whether V2
  // gating applies (an uppercase identifier would otherwise dodge every
  // policy-keyed check while the payment node still treats it as V2).
  return V2_REGISTRY_POLICY_IDS.has(
    agentIdentifier.slice(0, POLICY_ID_HEX_LENGTH).toLowerCase(),
  );
}

/**
 * The V2 registry policy ids, for callers that must express "is a V2-policy
 * identifier" as a DATABASE predicate (a prefix match) rather than a function
 * call — the availability filter and the rollback fence have to agree with
 * isV2RegistryIdentifier, and payment type is not a reliable proxy (free and
 * EVM-only V2 agents report "None").
 */
export function listV2RegistryPolicyIds(): string[] {
  return Array.from(V2_REGISTRY_POLICY_IDS);
}

/**
 * Canonical form of an agent identifier for comparison and storage. V2-policy
 * identifiers are hex and lowercased (matching what ingestion stores and what
 * readiness tuples carry); anything else is returned untouched, because only
 * V2 identifiers are known to be case-insensitive hex.
 */
export function normalizeV2RegistryIdentifier(agentIdentifier: string): string {
  return isV2RegistryIdentifier(agentIdentifier)
    ? agentIdentifier.toLowerCase()
    : agentIdentifier;
}

export interface VersionedAgentIdentifier {
  registryIdentity: string;
  registryVersion: number;
}

/**
 * Splits a V2 registry identifier into its stable identity and 3-byte version.
 * The caller decides whether the identifier belongs to the V2 registry policy.
 */
export function parseVersionedAgentIdentifier(
  agentIdentifier: string,
): VersionedAgentIdentifier | undefined {
  const normalizedIdentifier = agentIdentifier.toLowerCase();
  if (
    normalizedIdentifier.length !== V2_AGENT_IDENTIFIER_HEX_LENGTH ||
    !HEX_PATTERN.test(normalizedIdentifier)
  ) {
    return undefined;
  }

  // No separate hex test on the suffix: the whole-string HEX_PATTERN check
  // above already guarantees it is 6 hex characters.
  const versionHex = normalizedIdentifier.slice(-V2_VERSION_HEX_LENGTH);

  return {
    registryIdentity: normalizedIdentifier.slice(0, -V2_VERSION_HEX_LENGTH),
    registryVersion: Number.parseInt(versionHex, 16),
  };
}
