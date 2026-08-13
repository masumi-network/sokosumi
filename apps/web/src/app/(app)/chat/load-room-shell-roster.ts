import type { Coworker, Member } from "@/lib/clients/generated/core";
import { coworkerService } from "@/lib/services/coworker.service";

import { loadOrganizationMembers } from "./load-organization-members";

/** Org roster + chat coworkers for room chrome enrichment (pickers, mentions). */
export interface RoomShellRosterPage {
  organizationMembers: Member[];
  membersLoadFailed: boolean;
  coworkers: Coworker[];
}

/**
 * Secondary to room open: header/composer need getRoom only. Soft-fail members
 * via {@link loadOrganizationMembers}; coworkers still throw on unexpected
 * errors (same as prior await).
 */
export async function loadRoomShellRoster(
  organizationId: string | null | undefined,
): Promise<RoomShellRosterPage> {
  const [membersPage, coworkers] = await Promise.all([
    loadOrganizationMembers(organizationId),
    coworkerService.listCoworkers("chat"),
  ]);

  return {
    organizationMembers: membersPage.members,
    membersLoadFailed: membersPage.failed,
    coworkers,
  };
}
