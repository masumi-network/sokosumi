export const COWORKER_CAPABILITIES = ["chat", "tasks"] as const;

export type CoworkerCapability = (typeof COWORKER_CAPABILITIES)[number];

export function normalizeCoworkerCapabilities(
  capabilities: readonly string[] | null | undefined,
): CoworkerCapability[] {
  if (!capabilities || capabilities.length === 0) {
    return [];
  }

  const uniqueCapabilities = new Set(capabilities);
  return COWORKER_CAPABILITIES.filter((capability) =>
    uniqueCapabilities.has(capability),
  );
}
