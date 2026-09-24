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

/** Keep Core's selectable choices separate from names of stored assignees. */
export async function loadTaskScheduleAssigneeOptions(
  organizationId: string | null,
) {
  const [selectableOptions, members] = await Promise.all([
    listTaskScheduleAssigneeOptions(),
    listTaskAssigneeMemberOptions(organizationId),
  ]);
  const seen = new Set(selectableOptions.map((option) => option.id));
  return {
    selectableOptions,
    displayOptions: [
      ...selectableOptions,
      ...members.filter((member) => !seen.has(member.id)),
    ],
  };
}
