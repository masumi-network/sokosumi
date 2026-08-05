import { TasksPageSkeleton } from "@/app/tasks/components/tasks-loading-view";

/** Sync shell only — no cookies/`connection()` (Instant Nav). */
export default function TasksRootLoading() {
  return <TasksPageSkeleton />;
}
