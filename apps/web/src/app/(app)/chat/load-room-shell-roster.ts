import type { Coworker, Member } from "@/lib/clients/generated/core";
import { coworkerService } from "@/lib/services/coworker.service";
import { sokoBotService } from "@/lib/services/soko-bot.service";

import { loadOrganizationMembers } from "./load-organization-members";

/** Owner PA for channel edit roster (orchestratorIds), not a Coworker. */
export interface RoomShellPersonalAssistant {
  id: string;
  name: string;
  image: string | null;
}

/** Org roster + chat coworkers for room chrome enrichment (pickers, mentions). */
export interface RoomShellRosterPage {
  organizationMembers: Member[];
  membersLoadFailed: boolean;
  coworkers: Coworker[];
  personalAssistant: RoomShellPersonalAssistant | null;
}

/**
 * Secondary to room open: header/composer need getRoom only. Soft-fail members
 * via {@link loadOrganizationMembers}; coworkers still throw on unexpected
 * errors (same as prior await). PA soft-fails to null.
 */
export async function loadRoomShellRoster(
  organizationId: string | null | undefined,
): Promise<RoomShellRosterPage> {
  const [membersPage, coworkers, personalAssistantBot] = await Promise.all([
    loadOrganizationMembers(organizationId),
    coworkerService.listCoworkers("chat"),
    sokoBotService.getMine().catch(() => null),
  ]);

  const personalAssistant = personalAssistantBot
    ? {
        id: personalAssistantBot.id,
        name: personalAssistantBot.name?.trim() || "Personal assistant",
        image: personalAssistantBot.avatarImageUrl ?? null,
      }
    : null;

  return {
    organizationMembers: membersPage.members,
    membersLoadFailed: membersPage.failed,
    coworkers,
    personalAssistant,
  };
}
