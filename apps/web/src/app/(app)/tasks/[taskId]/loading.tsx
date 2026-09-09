import {
  TASK_DETAIL_GRID_CLASS,
  TASK_DETAIL_MAIN_CLASS,
  TASK_DETAIL_SHELL_CLASS,
  TASK_DETAIL_SIDEBAR_CLASS,
} from "@/app/tasks/constants";
import { Skeleton } from "@/components/ui/skeleton";

// Shown instantly while the task detail Server Component fetches its data, so a
// freshly created task lands on a skeleton rather than a blank wait.
export default function TaskDetailLoading() {
  return (
    <div className="min-h-full w-full">
      <div className={TASK_DETAIL_SHELL_CLASS}>
        <div className={TASK_DETAIL_GRID_CLASS}>
          <div className={TASK_DETAIL_MAIN_CLASS}>
            <div className="space-y-4">
              <div className="flex items-center justify-end md:justify-between">
                <Skeleton className="hidden h-9 w-24 md:block" />
                <Skeleton className="size-9" />
              </div>
              <Skeleton className="h-7 w-2/3" />
            </div>
            <TaskSectionSkeleton name="description" rows={3} />
          </div>

          <aside className={TASK_DETAIL_SIDEBAR_CLASS}>
            <TaskSectionSkeleton name="properties" rows={4} showTitle={false} />
          </aside>

          <div className={TASK_DETAIL_MAIN_CLASS}>
            <TaskSectionSkeleton name="activity" rows={3} />
          </div>
        </div>
      </div>
    </div>
  );
}

function TaskSectionSkeleton({
  name,
  rows,
  showTitle = true,
}: {
  name: string;
  rows: number;
  showTitle?: boolean;
}) {
  return (
    <section className="space-y-4">
      {showTitle ? <Skeleton className="h-3 w-24" /> : null}
      <div className="space-y-3">
        {Array.from({ length: rows }, (_, index) => (
          <Skeleton key={`${name}-${index}`} className="h-4 w-full" />
        ))}
      </div>
    </section>
  );
}
