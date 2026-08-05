import { connection } from "next/server";
import { TasksPageSkeleton } from "@/app/tasks/components/tasks-loading-view";
import { getDefaultTasksViewMode } from "@/lib/ui-preferences/tasks-view-mode.server";

export default async function TasksRootLoading() {
  await connection();
  const viewMode = await getDefaultTasksViewMode();

  return <TasksPageSkeleton viewMode={viewMode} />;
}
