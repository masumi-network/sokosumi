import type { ChatComposeOrchestrator } from "@/app/chat/actions";
import type { Coworker, Member } from "@/lib/clients/generated/core";
import { coworkerService } from "@/lib/services/coworker.service";
import { sokoBotService } from "@/lib/services/soko-bot.service";

import { loadOrganizationMembers } from "./load-organization-members";

/** Org roster + chat coworkers + owner PA for room chrome enrichment. */
export interface RoomShellRosterPage {
  organizationMembers: Member[];
  membersLoadFailed: boolean;
  coworkers: Coworker[];
  orchestrators: ChatComposeOrchestrator[];
}

/**
 * Secondary to room open: header/composer need getRoom only. Soft-fail members
 * via {@link loadOrganizationMembers}; coworkers still throw on unexpected
 * errors (same as prior await).
 */
export async function loadRoomShellRoster(
  organizationId: string | null | undefined,
): Promise<RoomShellRosterPage> {
  const [membersPage, coworkers, bot] = await Promise.all([
    loadOrganizationMembers(organizationId),
    coworkerService.listCoworkers("chat"),
    sokoBotService.getMine().catch(() => null),
  ]);

  return {
    organizationMembers: membersPage.members,
    membersLoadFailed: membersPage.failed,
    coworkers,
    orchestrators: bot
      ? [
          {
            id: bot.id,
            name: bot.name?.trim() || "Personal assistant",
            image: bot.avatarImageUrl ?? null,
            avatarSeed: bot.avatarSeed,
          },
        ]
      : [],
  };
}
