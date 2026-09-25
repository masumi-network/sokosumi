"use client";

import { CalendarSync, Plus } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useOptimistic, useRef, useState, useTransition } from "react";

import { loadMoreTaskSchedules } from "@/app/tasks/actions";
import { taskSchedulePath } from "@/app/tasks/utils/task-schedule-view";
import {
  parseTaskScheduleStateFilter,
  TASK_SCHEDULE_STATE_PARAM,
} from "@/app/tasks/utils/task-schedules-filters";
import type { ProjectFilterOption } from "@/app/tasks/utils/tasks-filters";
import { Button } from "@/components/ui/button";
import {
  SEGMENTED_TAB_TRIGGER_CLASS_NAME,
  SEGMENTED_TABS_LIST_CLASS_NAME,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { useLoadWhenVisible } from "@/hooks/use-load-when-visible";
import {
  type TaskSchedule,
  TaskScheduleState,
} from "@/lib/clients/generated/core";
import type { TaskSchedulesPage } from "@/lib/services/task-schedule.service";
import type { CoworkerOption } from "@/lib/types/coworker";
import { cn } from "@/lib/utils";
import { TaskScheduleCard } from "./task-schedule-card";
import { TaskScheduleDialog } from "./task-schedule-dialog";
import { TasksProjectSwitcher } from "./tasks-project-switcher";

const ALL_STATES = "all";

interface TaskSchedulesViewProps {
  schedules: TaskSchedule[];
  nextCursor: string | null;
  coworkerOptions: CoworkerOption[];
  assigneeDisplayOptions: CoworkerOption[];
  projectOptions: ProjectFilterOption[];
  selectedProjectId: string | null;
  selectedState: TaskScheduleState | null;
  canCreate: boolean;
  canCreatePrivate: boolean;
  /** Only the owner of a schedule edits it from its card. */
  currentUserId: string | null;
}

/**
 * The Schedules page: every Task Schedule of the workspace, filtered by the
 * project switcher and by state.
 */
export function TaskSchedulesView({
  schedules,
  nextCursor,
  coworkerOptions,
  assigneeDisplayOptions,
  projectOptions,
  selectedProjectId,
  selectedState,
  canCreate,
  canCreatePrivate,
  currentUserId,
}: TaskSchedulesViewProps) {
  const t = useTranslations("App.Tasks.Schedules");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [more, setMore] = useState<TaskSchedulesPage>({
    schedules: [],
    nextCursor,
  });
  const [isLoadingMore, startLoadingMore] = useTransition();
  const [hasFailed, setHasFailed] = useState(false);
  const boundaryRef = useRef<HTMLDivElement | null>(null);
  // The filter is server state; show the pick until the navigation lands.
  const [shownState, setShownState] = useOptimistic(selectedState);
  const [, startFiltering] = useTransition();

  function handleStateChange(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    const nextState = parseTaskScheduleStateFilter(next);
    if (nextState) {
      params.set(TASK_SCHEDULE_STATE_PARAM, nextState);
    } else {
      params.delete(TASK_SCHEDULE_STATE_PARAM);
    }
    const query = params.toString();
    startFiltering(() => {
      setShownState(nextState);
      router.replace(query ? `${pathname}?${query}` : pathname);
    });
  }

  function handleLoadMore() {
    const cursor = more.nextCursor;
    if (!cursor) return;
    setHasFailed(false);
    startLoadingMore(async () => {
      try {
        const page = await loadMoreTaskSchedules({
          cursor,
          projectId: selectedProjectId,
          state: selectedState,
        });
        setMore((current) => ({
          schedules: [...current.schedules, ...page.schedules],
          nextCursor: page.nextCursor,
        }));
      } catch {
        // Stop loading on its own until the reader asks again, rather than
        // hammering a server that just said no.
        setHasFailed(true);
      }
    });
  }

  // A refresh can bring back rows a "Load more" already appended.
  const rows = [
    ...schedules,
    ...more.schedules.filter(
      (extra) => !schedules.some((row) => row.id === extra.id),
    ),
  ];

  const shownValue = shownState ?? ALL_STATES;

  useLoadWhenVisible(boundaryRef, {
    armed: Boolean(more.nextCursor) && !isLoadingMore && !hasFailed,
    // A new last row means a moved boundary, which asks for the next page.
    boundaryKey: rows.at(-1)?.id ?? "",
    onVisible: handleLoadMore,
  });

  return (
    <Tabs
      className="flex flex-col gap-4"
      onValueChange={handleStateChange}
      value={shownValue}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList
          aria-label={t("stateFilter")}
          className={cn(SEGMENTED_TABS_LIST_CLASS_NAME, "w-fit")}
        >
          <TabsTrigger
            className={SEGMENTED_TAB_TRIGGER_CLASS_NAME}
            value={ALL_STATES}
          >
            {t("filterAll")}
          </TabsTrigger>
          {Object.values(TaskScheduleState).map((value) => (
            <TabsTrigger
              className={SEGMENTED_TAB_TRIGGER_CLASS_NAME}
              key={value}
              value={value}
            >
              {t(`state.${value}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="flex items-center gap-2 sm:gap-3">
          <TasksProjectSwitcher
            projectOptions={projectOptions}
            selectedProjectId={selectedProjectId}
          />
          {canCreate ? (
            <Button size="sm" onClick={() => setIsCreateOpen(true)}>
              <Plus className="size-4" aria-hidden />
              {t("newSchedule")}
            </Button>
          ) : null}
        </div>
      </div>

      {/* One panel, always the shown state's, so the list is its tab's panel. */}
      <TabsContent className="flex flex-col gap-4" value={shownValue}>
        {rows.length === 0 ? (
          <div className="border-border flex flex-col items-center gap-2 rounded-xl border px-4 py-16 text-center">
            <CalendarSync
              className="text-muted-foreground size-6"
              aria-hidden
            />
            <p className="text-muted-foreground max-w-sm text-sm text-pretty">
              {t("empty")}
            </p>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((schedule) => (
              <TaskScheduleCard
                assigneeDisplayOptions={assigneeDisplayOptions}
                canCreatePrivate={canCreatePrivate}
                coworkerOptions={coworkerOptions}
                currentUserId={currentUserId}
                key={schedule.id}
                projectOptions={projectOptions}
                schedule={schedule}
              />
            ))}
          </ul>
        )}

        {more.nextCursor ? (
          // Loads on its own as it scrolls into view, and stays a button so a
          // click works where no observer runs.
          <div
            className="flex flex-col items-center gap-2"
            data-testid="schedules-load-more"
            ref={boundaryRef}
          >
            {hasFailed ? (
              <p className="text-destructive text-xs" role="alert">
                {t("loadMoreError")}
              </p>
            ) : null}
            <Button
              aria-busy={isLoadingMore}
              disabled={isLoadingMore}
              onClick={handleLoadMore}
              size="sm"
              variant="outline"
            >
              {isLoadingMore ? t("loadingMore") : t("loadMore")}
            </Button>
          </div>
        ) : null}
      </TabsContent>

      {isCreateOpen ? (
        <TaskScheduleDialog
          initialBlueprint={{ projectId: selectedProjectId }}
          coworkerOptions={coworkerOptions}
          projectOptions={projectOptions}
          canCreatePrivate={canCreatePrivate}
          onClose={() => setIsCreateOpen(false)}
          onSaved={(scheduleId) => router.push(taskSchedulePath(scheduleId))}
        />
      ) : null}
    </Tabs>
  );
}
