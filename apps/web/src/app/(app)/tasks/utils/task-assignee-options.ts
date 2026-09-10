import "server-only";

import { getTranslations } from "next-intl/server";
import { coworkerService } from "@/lib/services/coworker.service";
import { sokoBotService } from "@/lib/services/soko-bot.service";
import type { CoworkerOption } from "@/lib/types/coworker";

import { getCoworkerOptions, withOwnerSokoBotOption } from "./coworker-options";
import { listTaskAssigneeMemberOptions } from "./task-assignee-members";

/**
 * Everything a Task can be assigned to in a workspace, as picker options:
 * the owner Soko Bot first, then workspace members and coworkers. Coworker
 * and Soko Bot lookups degrade to empty so members always load.
 */
export async function listTaskAssigneeOptions(
  organizationId: string | null,
): Promise<CoworkerOption[]> {
  const [memberOptions, taskCoworkers, ownerBot, t] = await Promise.all([
    listTaskAssigneeMemberOptions(organizationId),
    coworkerService.listCoworkers("tasks").catch(() => []),
    sokoBotService.getMine().catch(() => null),
    getTranslations("App.Tasks"),
  ]);

  return withOwnerSokoBotOption(
    [...memberOptions, ...getCoworkerOptions(taskCoworkers)],
    ownerBot,
    { fallbackName: t("sokoBot"), vendorName: t("sokoBots") },
  );
}
