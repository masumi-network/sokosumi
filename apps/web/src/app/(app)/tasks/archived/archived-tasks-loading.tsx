"use client";

import { TaskStatus } from "@sokosumi/core-client";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense } from "react";
import { TaskStatusBadge } from "@/app/tasks/components/task-status-badge";
import { TextLineSkeleton } from "@/app/tasks/components/tasks-loading-view";
import { Button } from "@/components/ui/button";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { ArchivedTaskBackLink } from "./[taskId]/archived-task-back-link";
import { readArchivedSearch } from "./archived-search";
import { ArchivedTasksHeader } from "./archived-tasks-header";

/** Enough rows to fill a desktop screen; the real list may be shorter. */
const ROW_PLACEHOLDER_COUNT = 8;

/** A status badge's exact box, without saying a status. */
function BadgeSkeleton() {
  return (
    <Skeleton className="w-fit rounded-sm">
      <TaskStatusBadge
        status={TaskStatus.DRAFT}
        label={" "}
        className="invisible w-16 rounded-sm"
      />
    </Skeleton>
  );
}

function ArchivedTasksShell({ query }: { query?: string }) {
  const t = useTranslations("App.Tasks.Archived");

  return (
    <div className="flex w-full flex-col gap-4 pb-6">
      <ArchivedTasksHeader t={t} query={query} searchInert />
      {/* The list's status line, in the same place: it says the list is
          loading, and holds the line a search's match count takes. */}
      <div role="status" className="-mt-2 text-sm">
        <span className="sr-only">{t("loading")}</span>
        {query ? <TextLineSkeleton className="w-64" /> : null}
      </div>
      <div aria-hidden className={cn(HOLDER_CLASS, "flex flex-col gap-2")}>
        <p className="text-muted-foreground px-2 pt-1 text-xs">
          {t("draftNote")}
        </p>
        <ul className="flex flex-col gap-2">
          {Array.from({ length: ROW_PLACEHOLDER_COUNT }, (_, index) => (
            <li
              key={`row-${index}`}
              className={cn(
                HOLDER_ITEM_CLASS,
                "flex items-center gap-3 px-3 py-2",
              )}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                  <TextLineSkeleton className="w-3/5 text-sm sm:w-2/5" />
                  <BadgeSkeleton />
                </div>
                <TextLineSkeleton className="w-40 text-xs" />
              </div>
              <Button size="sm" variant="outline" disabled tabIndex={-1}>
                {t("restore")}
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ArchivedTasksShellFromUrl() {
  return (
    <ArchivedTasksShell
      query={readArchivedSearch(useSearchParams().getAll("q"))}
    />
  );
}

/**
 * Archived while it loads: the real heading and search right away, and rows
 * in the frame of `ArchivedTasksList`, so the rows fill in where they stand.
 * Reading the URL suspends while Next prerenders a static shell; that shell
 * draws the same frame with an empty search.
 */
export function ArchivedTasksLoading() {
  return (
    <Suspense fallback={<ArchivedTasksShell />}>
      <ArchivedTasksShellFromUrl />
    </Suspense>
  );
}

/** An archived Task while it loads: the back link right away, the Task's frame below. */
export function ArchivedTaskLoading() {
  const t = useTranslations("App.Tasks.Archived");

  return (
    <div className="flex w-full flex-col gap-4 pb-6">
      <ArchivedTaskBackLink label={t("title")} />
      <p role="status" className="sr-only">
        {t("loadingTask")}
      </p>
      <div aria-hidden className={HOLDER_CLASS}>
        <div className="flex flex-col gap-6 p-4 md:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <TextLineSkeleton className="w-20 text-sm" />
              <TextLineSkeleton className="w-3/5 text-xl" />
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <BadgeSkeleton />
                <TextLineSkeleton className="w-40 text-sm" />
              </div>
              <p className="text-muted-foreground text-sm text-pretty">
                {t("readOnly")}
              </p>
            </div>
            <Button className="w-fit shrink-0" disabled tabIndex={-1}>
              {t("restore")}
            </Button>
          </div>
          <TextLineSkeleton className="w-24 text-xs" />
        </div>
      </div>
    </div>
  );
}
