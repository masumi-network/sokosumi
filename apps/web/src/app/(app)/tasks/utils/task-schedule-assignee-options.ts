import "server-only";

import { getTranslations } from "next-intl/server";
import { taskScheduleService } from "@/lib/services/task-schedule.service";
import type { CoworkerOption } from "@/lib/types/coworker";

import { getCoworkerOptions, withOwnerSokoBotOption } from "./coworker-options";

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
