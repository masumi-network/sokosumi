import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { JobsLoadingStatus } from "./jobs-loading-status";

/**
 * Loading shells for Your jobs. Server markup; only the status label is a
 * client module, as it reads the app's message bag. The shells stay free of
 * cookies, `connection()` and server i18n (Instant Nav).
 */

/** The header's bones: the 40px icon box beside the name and its count. */
export function JobsListHeaderSkeleton() {
  return (
    <div
      aria-hidden
      className="flex min-w-0 items-center gap-3 px-2 pb-3 md:px-0 md:pr-4"
    >
      <Skeleton className="size-10 shrink-0 rounded-lg" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Skeleton className="h-5 w-40 max-w-full" />
        <Skeleton className="h-4 w-20" />
      </div>
    </div>
  );
}

/** Row widths, so no two rows read as one block. */
const ROW_WIDTHS = ["w-[78%]", "w-[64%]", "w-[86%]", "w-[70%]"];

/**
 * A `JobRow` box: py-2 around a 20px name line and a 16px time line, the
 * time indented past the 14px status mark.
 */
function JobRowBones({ width }: { width: string }) {
  return (
    <div className="bg-card-background rounded-md px-2 py-2">
      <div className="flex h-5 items-center gap-2">
        <Skeleton className="size-3.5 shrink-0 rounded-full" />
        <Skeleton className={cn("h-3.5", width)} />
      </div>
      <div className="mt-1 flex h-4 items-center pl-5.5">
        <Skeleton className="h-3 w-16" />
      </div>
    </div>
  );
}

/** The job detail's bones: title, input card, result lines. */
function JobDetailBones() {
  return (
    <div aria-hidden className="flex flex-col gap-6">
      <Skeleton className="h-7 w-2/3 max-w-sm" />
      <Skeleton className="h-24 w-full rounded-xl" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
  );
}

/**
 * One job loading, in the right pane or the phone dialog. Only the right
 * pane announces: it also renders (hidden) on phones, and two writers would
 * read the label twice.
 */
export function JobDetailSkeleton({
  className,
  announce = true,
}: {
  className?: string;
  announce?: boolean;
}) {
  return (
    <div className={cn("w-full py-4", className)}>
      {announce ? <JobsLoadingStatus label="job" /> : null}
      <JobDetailBones />
    </div>
  );
}

/**
 * Both panes while the jobs load, in the layout's own pane geometry so
 * nothing moves when the list lands. `header` streams in on its own: the
 * agent arrives before the jobs do.
 */
export function JobsPanesSkeleton({ header }: { header: React.ReactNode }) {
  return (
    <div className="w-full md:@container/jobs-panes">
      <JobsLoadingStatus label="jobs" />
      <div className="flex w-full flex-col gap-4 @4xl/jobs-panes:flex-row @4xl/jobs-panes:items-start">
        <div className="w-full px-4 @4xl/jobs-panes:w-72 @4xl/jobs-panes:flex-none">
          <div className="@4xl/jobs-panes:border-border flex flex-col py-4 @4xl/jobs-panes:h-[calc(100dvh-4rem)] @4xl/jobs-panes:border-r">
            {header}
            <div aria-hidden className="px-2 pb-2 md:px-0 md:pr-4">
              <Skeleton className="h-10 w-full" />
            </div>
            <div aria-hidden className="px-2 md:p-2 md:pr-4 md:pl-0">
              <Skeleton className="mx-2 mb-2 h-4 w-14" />
              <div className="space-y-2">
                {ROW_WIDTHS.map((width) => (
                  <JobRowBones key={width} width={width} />
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="hidden min-w-0 flex-1 px-4 py-4 @4xl/jobs-panes:block">
          <JobDetailBones />
        </div>
      </div>
    </div>
  );
}
