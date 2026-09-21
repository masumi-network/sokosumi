/**
 * An Ably token capability arrives as a JSON string or an already-parsed
 * object, depending on where it came from. Normalise it once so every
 * capability reader agrees on what "unparseable" means.
 *
 * Returns null when the capability is missing or not an object map; callers
 * treat that as "grants nothing" rather than falling back to an ungated
 * attach, which is how SOKOSUMI-R0 happened.
 */
export function parseAblyCapabilityMap(
  capability: unknown,
): Record<string, unknown> | null {
  if (capability == null) {
    return null;
  }
  if (typeof capability === "string") {
    try {
      const parsed: unknown = JSON.parse(capability);
      if (
        parsed == null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      ) {
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (typeof capability === "object" && !Array.isArray(capability)) {
    return capability as Record<string, unknown>;
  }
  return null;
}

/** True when the capability grants `operation` on exactly `channelName`. */
export function capabilityGrants(
  capability: unknown,
  channelName: string,
  operation: string,
): boolean {
  const map = parseAblyCapabilityMap(capability);
  if (map == null) {
    return false;
  }
  const operations = map[channelName];
  return Array.isArray(operations) && operations.includes(operation);
}
