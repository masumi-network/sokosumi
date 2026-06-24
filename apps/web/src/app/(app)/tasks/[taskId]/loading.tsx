import { Skeleton } from "@/components/ui/skeleton";

// Shown instantly while the task detail Server Component fetches its data, so a
// freshly created task lands on a skeleton rather than a blank wait.
export default function TaskDetailLoading() {
  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-4xl px-4 pb-8">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="size-9" />
          </div>
          <Skeleton className="h-7 w-2/3" />
        </div>

        <div className="mt-6 space-y-8">
          <TaskSectionSkeleton name="description" rows={3} />
          <TaskSectionSkeleton name="properties" rows={4} />
          <TaskSectionSkeleton name="activity" rows={3} />
        </div>
      </div>
    </div>
  );
}

function TaskSectionSkeleton({ name, rows }: { name: string; rows: number }) {
  return (
    <section className="space-y-4">
      <Skeleton className="h-3 w-24" />
      <div className="space-y-3">
        {Array.from({ length: rows }, (_, index) => (
          <Skeleton key={`${name}-${index}`} className="h-4 w-full" />
        ))}
      </div>
    </section>
  );
}
