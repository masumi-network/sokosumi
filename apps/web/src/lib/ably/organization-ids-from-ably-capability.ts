import { parseOrganizationIdFromPresenceChannelName } from "@sokosumi/utils";

/**
 * Extract organization ids granted presence on `presence:org_*` channels.
 * Returns null when capability is missing or unparseable.
 */
export function organizationIdsFromAblyCapability(
  capability: unknown,
): string[] | null {
  let map: Record<string, unknown>;
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
      map = parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  } else if (typeof capability === "object" && !Array.isArray(capability)) {
    map = capability as Record<string, unknown>;
  } else {
    return null;
  }

  const organizationIds: string[] = [];
  for (const [channelName, operations] of Object.entries(map)) {
    if (!Array.isArray(operations) || !operations.includes("presence")) {
      continue;
    }
    const organizationId =
      parseOrganizationIdFromPresenceChannelName(channelName);
    if (organizationId != null) {
      organizationIds.push(organizationId);
    }
  }
  return organizationIds;
}
