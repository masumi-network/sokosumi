import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";

import { TasksLoadingView } from "@/app/tasks/components/tasks-loading-view";
import type { KanbanColumnId } from "@/lib/types/task";
import {
  parseTasksViewMode,
  TASKS_VIEW_MODE_COOKIE_NAME,
} from "@/lib/ui-preferences/tasks-view-mode";

export default async function TasksRootLoading() {
  const [t, tColumns, cookieStore] = await Promise.all([
    getTranslations("App.Tasks"),
    getTranslations("App.Tasks.Columns"),
    cookies(),
  ]);
  const viewMode =
    parseTasksViewMode(cookieStore.get(TASKS_VIEW_MODE_COOKIE_NAME)?.value) ??
    "board";

  const columnLabels: Record<KanbanColumnId, string> = {
    backlog: tColumns("backlog"),
    todo: tColumns("todo"),
    "in-progress": tColumns("inProgress"),
    "input-required": tColumns("inputRequired"),
    done: tColumns("done"),
  };

  return (
    <div className="w-full px-2">
      <TasksLoadingView
        viewMode={viewMode}
        labels={{
          tabs: {
            tasks: t("Tabs.tasks"),
            jobs: t("Tabs.jobs"),
          },
          columns: columnLabels,
          add: t("Actions.add"),
          addTask: t("Actions.addTask"),
          display: {
            button: t("Display.button"),
          },
        }}
      />
    </div>
  );
}
