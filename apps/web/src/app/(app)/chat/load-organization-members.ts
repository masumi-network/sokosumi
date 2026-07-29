import { CoreApiRequestError } from "@/lib/clients/core.client";
import type { Member } from "@/lib/clients/generated/core";
import { userService } from "@/lib/services";

/**
 * Org roster is secondary for room viewing (member pickers / edit channel).
 * Soft-fail Core 5xx so a transient members outage cannot take down the room
 * page — same approach as {@link loadRoomMessages}.
 */
export async function loadOrganizationMembers(
  organizationId: string | null | undefined,
): Promise<{
  members: Member[];
  failed: boolean;
}> {
  if (!organizationId) {
    return { members: [], failed: false };
  }

  try {
    const members = await userService.getOrganizationMembers(organizationId);
    return { members, failed: false };
  } catch (error) {
    if (error instanceof CoreApiRequestError) {
      console.error("Failed to load organization members", {
        organizationId,
        status: error.status,
        kind: error.kind,
      });
      return { members: [], failed: true };
    }

    throw error;
  }
}
