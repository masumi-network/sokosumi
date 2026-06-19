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

  const normalized: CoworkerMetadata = {
    channels: normalizedChannels,
  };

  if (metadata.profile !== undefined) {
    normalized.profile = metadata.profile;
  }

  if (metadata.offers !== undefined) {
    normalized.offers = metadata.offers;
  }

  const hasContent =
    Object.keys(normalizedChannels).length > 0 ||
    metadata.profile !== undefined ||
    metadata.offers !== undefined;

  return hasContent ? normalized : null;
}
