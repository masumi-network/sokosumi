import { getTranslations } from "next-intl/server";
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
  sokoBots: ChatComposeOrchestrator[];
}

/**
 * Secondary to room open: header/composer need getRoom only. Soft-fail members
 * via {@link loadOrganizationMembers}; coworkers still throw on unexpected
 * errors (same as prior await).
 */
export async function loadRoomShellRoster(
  organizationId: string | null | undefined,
): Promise<RoomShellRosterPage> {
  const [membersPage, coworkers, bot, t] = await Promise.all([
    loadOrganizationMembers(organizationId),
    coworkerService.listCoworkers("chat"),
    sokoBotService.getMine().catch(() => null),
    getTranslations("App.Chat"),
  ]);

  return {
    organizationMembers: membersPage.members,
    membersLoadFailed: membersPage.failed,
    coworkers,
    sokoBots: bot
      ? [
          {
            id: bot.id,
            name: bot.name?.trim() || t("personalAssistantBadge"),
            image: bot.avatarImageUrl ?? null,
            avatarSeed: bot.avatarSeed,
          },
        ]
      : [],
  };
}
