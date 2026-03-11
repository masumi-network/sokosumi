export const COWORKER_CAPABILITIES = ["chat", "tasks"] as const;

export type CoworkerCapability = (typeof COWORKER_CAPABILITIES)[number];

interface CoworkerWithCapabilities {
  capabilities?: string[] | null;
}

export function hasCoworkerCapability(
  coworker: CoworkerWithCapabilities,
  capability: CoworkerCapability,
): boolean {
  if (!coworker.capabilities || coworker.capabilities.length === 0) {
    return false;
  }

  return coworker.capabilities.includes(capability);
}

export function filterCoworkersByCapability<
  TCoworker extends CoworkerWithCapabilities,
>(coworkers: TCoworker[], capability: CoworkerCapability): TCoworker[] {
  return coworkers.filter((coworker) =>
    hasCoworkerCapability(coworker, capability),
  );
}
