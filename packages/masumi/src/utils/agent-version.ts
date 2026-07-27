const V2_VERSION_HEX_LENGTH = 6;
const V2_VERSION_PATTERN = /^[0-9a-f]{6}$/i;

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
  if (agentIdentifier.length <= V2_VERSION_HEX_LENGTH) {
    return undefined;
  }

  const versionHex = agentIdentifier.slice(-V2_VERSION_HEX_LENGTH);
  if (!V2_VERSION_PATTERN.test(versionHex)) {
    return undefined;
  }

  return {
    registryIdentity: agentIdentifier.slice(0, -V2_VERSION_HEX_LENGTH),
    registryVersion: Number.parseInt(versionHex, 16),
  };
}
