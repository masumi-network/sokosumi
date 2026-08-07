import { TasksPageSkeletonHost } from "@/app/tasks/components/tasks-page-skeleton-host";

/** Sync shell only — no cookies/`connection()` (Instant Nav). */
export default function TasksRootLoading() {
  return <TasksPageSkeletonHost />;
}
