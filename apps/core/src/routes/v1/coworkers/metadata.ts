import type { CoworkerMetadata } from "@/schemas/coworker.schema";

export function normalizeCoworkerMetadata(
  metadata: CoworkerMetadata | null | undefined,
): CoworkerMetadata | null | undefined {
  if (metadata === undefined) {
    return undefined;
  }

  if (metadata === null) {
    return null;
  }

  const normalizedChannels = Object.entries(metadata.channels).reduce<
    Record<string, string>
  >((accumulator, [provider, value]) => {
    const trimmedProvider = provider.trim();
    const trimmedValue = value.trim();

    if (trimmedProvider.length === 0 || trimmedValue.length === 0) {
      return accumulator;
    }

    accumulator[trimmedProvider] = trimmedValue;
    return accumulator;
  }, {});

  return Object.keys(normalizedChannels).length > 0
    ? { channels: normalizedChannels }
    : null;
}
