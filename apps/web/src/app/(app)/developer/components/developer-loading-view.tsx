import { Skeleton } from "@/components/ui/skeleton";

interface DeveloperSectionRowsSkeletonProps {
  rows?: number;
}

interface TaskSectionSkeletonProps {
  name: string;
  rows: number;
}

/**
 * Row bones only — safe inside CardContent / list sections while client data loads.
 * Sync only (no cookies/`connection()`/i18n).
 */
export function DeveloperSectionRowsSkeleton({
  rows = 5,
}: DeveloperSectionRowsSkeletonProps): React.ReactElement {
  return (
    <div data-testid="developer-section-loading-list" className="space-y-3">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="flex items-center gap-3 rounded-lg border border-border/40 p-3"
        >
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
          <Skeleton className="h-8 w-16 shrink-0 rounded-md" />
        </div>
      ))}
    </div>
  );
}

/**
 * Content-only shell for Suspense fallbacks inside DeveloperSectionShell
 * (avoids double max-w-4xl wrapper after Instant `loading.tsx` resolves).
 * Matches non-card sections (title + description + list).
 */
export function DeveloperSectionContentSkeleton(): React.ReactElement {
  return (
    <div data-testid="developer-section-content-loading" className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
      <DeveloperSectionRowsSkeleton />
    </div>
  );
}

/**
 * Instant shell for card-style developer sections (API keys, OAuth, docs).
 */
export function DeveloperSectionPageSkeleton(): React.ReactElement {
  return (
    <div data-testid="developer-section-loading" className="min-h-full w-full">
      <div className="mx-auto max-w-4xl space-y-8 px-4 py-2">
        <div className="bg-card text-card-foreground rounded-xl border shadow-sm">
          <div className="flex flex-col gap-1.5 p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-4 w-full max-w-md" />
                <Skeleton className="h-3 w-28" />
              </div>
              <Skeleton className="h-9 w-28 shrink-0 rounded-md" />
            </div>
          </div>
          <div className="px-6 pb-6">
            <DeveloperSectionRowsSkeleton />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Instant shell for non-card list sections (coworkers, tasks, vendors).
 */
export function DeveloperListPageSkeleton(): React.ReactElement {
  return (
    <div data-testid="developer-list-loading" className="min-h-full w-full">
      <div className="mx-auto max-w-4xl space-y-8 px-4 py-2">
        <DeveloperSectionContentSkeleton />
      </div>
    </div>
  );
}

/**
 * Instant shell for coworker / vendor edit routes (`max-w-3xl` matches pages).
 */
export function DeveloperDetailPageSkeleton(): React.ReactElement {
  return (
    <div data-testid="developer-detail-loading" className="min-h-full w-full">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-8 w-52" />
            <Skeleton className="h-4 w-full max-w-md" />
            <Skeleton className="h-3 w-28" />
          </div>
          <Skeleton className="h-9 w-28 shrink-0 rounded-md" />
        </div>
        <div className="space-y-4 rounded-xl border p-6">
          <Skeleton className="h-6 w-52" />
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-10 w-full rounded-md" />
            </div>
          ))}
          <div className="flex justify-end gap-2 pt-2">
            <Skeleton className="h-9 w-24 rounded-md" />
            <Skeleton className="h-9 w-28 rounded-md" />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Instant shell for developer task detail — meta bar + task sections
 * (mirrors `/tasks/[taskId]/loading.tsx` + owner strip).
 */
export function DeveloperTaskDetailPageSkeleton(): React.ReactElement {
  return (
    <div
      data-testid="developer-task-detail-loading"
      className="min-h-full w-full"
    >
      <div className="mx-auto max-w-4xl px-4 pt-2">
        <div className="bg-muted/40 flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-32" />
          </div>
          <Skeleton className="h-8 w-24 shrink-0 rounded-md" />
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 pb-8">
        <div className="mt-4 space-y-4">
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

function TaskSectionSkeleton({
  name,
  rows,
}: TaskSectionSkeletonProps): React.ReactElement {
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
