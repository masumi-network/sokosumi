import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";

import { type KanbanColumnId } from "@/lib/types/task";
import {
  parseTasksViewMode,
  TASKS_VIEW_MODE_COOKIE_NAME,
} from "@/lib/ui-preferences/tasks-view-mode";

import { TasksLoadingView } from "./components/tasks-loading-view";

export default async function TasksLoading() {
  const [t, tColumns, cookieStore] = await Promise.all([
    getTranslations("App.Tasks"),
    getTranslations("App.Tasks.Columns"),
    cookies(),
  ]);
  const defaultViewMode =
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
        viewMode={defaultViewMode}
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
            list: t("Display.list"),
            board: t("Display.board"),
          },
        }}
      />
    </div>
  );
}
