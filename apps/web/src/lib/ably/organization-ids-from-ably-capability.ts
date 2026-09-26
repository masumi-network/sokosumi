import { parseOrganizationIdFromPresenceChannelName } from "@sokosumi/utils";

import { parseAblyCapabilityMap } from "./ably-capability-map";

/**
 * Extract organization ids granted presence on `presence:org_*` channels.
 * Returns null when capability is missing or unparseable.
 */
export function organizationIdsFromAblyCapability(
  capability: unknown,
): string[] | null {
  const map = parseAblyCapabilityMap(capability);
  if (map == null) {
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
