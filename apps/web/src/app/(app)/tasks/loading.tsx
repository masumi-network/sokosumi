import { cookies } from "next/headers";

import {
  parseTasksViewMode,
  TASKS_VIEW_MODE_COOKIE_NAME,
} from "@/lib/ui-preferences/tasks-view-mode";

import { TasksLoadingView } from "./components/tasks-loading-view";

export default async function TasksLoading() {
  const cookieStore = await cookies();
  const viewMode =
    parseTasksViewMode(cookieStore.get(TASKS_VIEW_MODE_COOKIE_NAME)?.value) ??
    "board";

  return (
    <div className="w-full px-2">
      <TasksLoadingView viewMode={viewMode} />
    </div>
  );
}
