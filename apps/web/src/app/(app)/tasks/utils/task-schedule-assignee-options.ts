import "server-only";

import { getTranslations } from "next-intl/server";
import { taskScheduleService } from "@/lib/services/task-schedule.service";
import type { CoworkerOption } from "@/lib/types/coworker";

import { getCoworkerOptions, withOwnerSokoBotOption } from "./coworker-options";
import { listTaskAssigneeMemberOptions } from "./task-assignee-members";

/** Core chooses eligible schedule assignees; Web supplies display labels. */
export async function listTaskScheduleAssigneeOptions(): Promise<
  CoworkerOption[]
> {
  const [assignees, t] = await Promise.all([
    taskScheduleService.listAssignees(),
    getTranslations("App.Tasks"),
  ]);

  return withOwnerSokoBotOption(
    getCoworkerOptions(assignees.coworkers),
    assignees.sokoBot,
    { fallbackName: t("sokoBot"), vendorName: t("sokoBots") },
  );
}

/** Agents plus current members, so a stored member assignee still has a name. */
export async function listTaskScheduleAssigneeDisplayOptions(
  organizationId: string | null,
): Promise<CoworkerOption[]> {
  const [agents, members] = await Promise.all([
    listTaskScheduleAssigneeOptions(),
    listTaskAssigneeMemberOptions(organizationId),
  ]);
  const seen = new Set(agents.map((option) => option.id));
  return [...agents, ...members.filter((member) => !seen.has(member.id))];
}
