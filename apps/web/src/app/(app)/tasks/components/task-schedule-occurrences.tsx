"use client";

import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import {
  Ban,
  CalendarClock,
  CircleAlert,
  CircleCheck,
  CircleSlash2,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTimeZone, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { loadMoreTaskScheduleOccurrences } from "@/app/tasks/actions";
import { OccurrenceTimeDialog } from "@/components/schedules/occurrence-time-dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DEFAULT_TIME_ZONE } from "@/i18n/time-zone";
import { mutateTaskOccurrence } from "@/lib/actions/task/action";
import type {
  TaskScheduleOccurrence,
  TaskScheduleOccurrenceView,
} from "@/lib/clients/generated/core/types.gen";
import { cn } from "@/lib/utils";
import { taskScheduleSeriesFeedbackKey } from "@/lib/utils/task-schedule-feedback";

export interface TaskScheduleOccurrencesPageData {
  occurrences: TaskScheduleOccurrence[];
  nextCursor: string | null;
}

function appendOccurrencePage(
  previous: TaskScheduleOccurrencesPageData,
  occurrences: TaskScheduleOccurrence[],
  nextCursor: string | null,
): TaskScheduleOccurrencesPageData {
  return {
    occurrences: [...previous.occurrences, ...occurrences],
    nextCursor,
  };
}

interface TaskScheduleOccurrencesProps {
  taskId: string;
  scheduleRevision: number;
  upcoming: TaskScheduleOccurrencesPageData;
  history: TaskScheduleOccurrencesPageData;
  /** False once the series was removed; its history is still preserved. */
  hasActiveSchedule: boolean;
}

type Translate = IntlTranslation<"App.Tasks.Detail.ScheduleSeries">;
type Format = IntlDateFormatter;

interface OccurrenceTimeState {
  action: "reschedule" | "restore";
  occurrenceId: string;
  scheduledAt: Date;
  timeZone: string;
}

/**
 * Only a future planned row can move: released, canceled, skipped, and missed
 * rows are history, and Core rejects a move that has no live target.
 */
function isMovableOccurrence(occurrence: TaskScheduleOccurrence): boolean {
  return (
    occurrence.state === "PLANNED" &&
    !occurrence.isMissed &&
    (occurrence.scheduleVersion === 2 || occurrence.timezone === null)
  );
}

function isRestorableOccurrence(occurrence: TaskScheduleOccurrence): boolean {
  return (
    occurrence.state === "SKIPPED" &&
    occurrence.originalScheduledAt !== null &&
    occurrence.scheduleVersion === 2
  );
}

/**
 * The only client state on the schedule surface: which view is open, and the
 * pages loaded past the server-rendered first one. The parent keys this on the
 * observed schedule revision, so a refreshed route remounts it with fresh
 * pages instead of reconciling stale ones.
 */
export function TaskScheduleOccurrences({
  taskId,
  scheduleRevision,
  upcoming,
  history,
  hasActiveSchedule,
}: TaskScheduleOccurrencesProps) {
  const t = useTranslations("App.Tasks.Detail.ScheduleSeries");
  const tSeries = useTranslations("App.Tasks.Schedule.series");
  const format = useFormatter();
  const viewerTimeZone = useTimeZone() ?? DEFAULT_TIME_ZONE;
  const router = useRouter();
  const [upcomingPage, setUpcomingPage] = useState(upcoming);
  const [historyPage, setHistoryPage] = useState(history);
  const [isPending, startTransition] = useTransition();
  const [timeState, setTimeState] = useState<OccurrenceTimeState | null>(null);
  // Latched once a stale cursor sends us back to the server. Nothing clears it:
  // the parent's revision key remounts this island with fresh pages.
  const [isRefreshing, setIsRefreshing] = useState(false);
  const isBusy = isPending || isRefreshing;

  function handleLoadMore(view: TaskScheduleOccurrenceView) {
    const page = view === "upcoming" ? upcomingPage : historyPage;
    const cursor = page.nextCursor;
    if (!cursor || isBusy) {
      return;
    }

    startTransition(async () => {
      try {
        const result = await loadMoreTaskScheduleOccurrences({
          taskId,
          view,
          cursor,
        });

        if (result.status === "stale") {
          // The series moved on. Re-rendering the route hands us a new
          // revision, and with it a fresh mount of this component.
          setIsRefreshing(true);
          router.refresh();
          return;
        }

        if (view === "upcoming") {
          setUpcomingPage((previous) =>
            appendOccurrencePage(
              previous,
              result.occurrences,
              result.nextCursor,
            ),
          );
        } else {
          setHistoryPage((previous) =>
            appendOccurrencePage(
              previous,
              result.occurrences,
              result.nextCursor,
            ),
          );
        }
      } catch (error) {
        console.error("Failed to load more task schedule occurrences", {
          taskId,
          view,
          error,
        });
        toast.error(t("loadMoreError"));
      }
    });
  }

  function handleMoveOccurrence(occurrence: TaskScheduleOccurrence) {
    setTimeState({
      action: "reschedule",
      occurrenceId: occurrence.id,
      scheduledAt: occurrence.effectiveScheduledAt,
      timeZone: occurrence.timezone ?? viewerTimeZone,
    });
  }

  function handleRestoreOccurrence(occurrence: TaskScheduleOccurrence) {
    if (!occurrence.originalScheduledAt) {
      return;
    }
    setTimeState({
      action: "restore",
      occurrenceId: occurrence.id,
      scheduledAt: occurrence.originalScheduledAt,
      timeZone: occurrence.timezone ?? viewerTimeZone,
    });
  }

  function handleSkipOccurrence(occurrence: TaskScheduleOccurrence) {
    if (isBusy) {
      return;
    }
    startTransition(async () => {
      try {
        const result = await mutateTaskOccurrence({
          taskId,
          occurrenceId: occurrence.id,
          operationId: crypto.randomUUID(),
          expectedScheduleRevision: scheduleRevision,
          action: "skip",
        });
        if (!result.ok) {
          const feedbackKey = taskScheduleSeriesFeedbackKey(result.error.kind);
          toast.error(feedbackKey ? tSeries(feedbackKey) : t("mutationError"));
          if (
            result.error.kind ===
              CORE_API_ERROR_KINDS.SCHEDULE_REVISION_CONFLICT ||
            result.error.kind === CORE_API_ERROR_KINDS.SCHEDULE_CURSOR_STALE
          ) {
            router.refresh();
          }
          return;
        }
        router.refresh();
      } catch {
        toast.error(t("mutationError"));
      }
    });
  }

  return (
    <>
      <Tabs defaultValue="upcoming" className="gap-3">
        <TabsList aria-label={t("tabsLabel")}>
          <TabsTrigger value="upcoming">{t("upcomingTab")}</TabsTrigger>
          <TabsTrigger value="history">{t("historyTab")}</TabsTrigger>
        </TabsList>

        <TabsContent value="upcoming">
          <OccurrenceList
            page={upcomingPage}
            listLabel={t("upcomingListLabel")}
            emptyLabel={
              hasActiveSchedule ? t("upcomingEmpty") : t("upcomingEmptyRemoved")
            }
            isPending={isBusy}
            onLoadMore={() => handleLoadMore("upcoming")}
            onMoveOccurrence={handleMoveOccurrence}
            onRestoreOccurrence={handleRestoreOccurrence}
            onSkipOccurrence={handleSkipOccurrence}
            t={t}
            format={format}
          />
        </TabsContent>

        <TabsContent value="history">
          <OccurrenceList
            page={historyPage}
            listLabel={t("historyListLabel")}
            emptyLabel={t("historyEmpty")}
            isPending={isBusy}
            onLoadMore={() => handleLoadMore("history")}
            onMoveOccurrence={handleMoveOccurrence}
            onRestoreOccurrence={handleRestoreOccurrence}
            onSkipOccurrence={handleSkipOccurrence}
            t={t}
            format={format}
          />
        </TabsContent>
      </Tabs>

      {timeState ? (
        <OccurrenceTimeDialog
          key={`${timeState.action}:${timeState.occurrenceId}`}
          action={timeState.action}
          occurrenceId={timeState.occurrenceId}
          expectedScheduleRevision={scheduleRevision}
          scheduledAt={timeState.scheduledAt}
          taskId={taskId}
          timeZone={timeState.timeZone}
          onClose={() => setTimeState(null)}
        />
      ) : null}
    </>
  );
}

function OccurrenceList({
  page,
  listLabel,
  emptyLabel,
  isPending,
  onLoadMore,
  onMoveOccurrence,
  onRestoreOccurrence,
  onSkipOccurrence,
  t,
  format,
}: {
  page: TaskScheduleOccurrencesPageData;
  listLabel: string;
  emptyLabel: string;
  isPending: boolean;
  onLoadMore: () => void;
  onMoveOccurrence: (occurrence: TaskScheduleOccurrence) => void;
  onRestoreOccurrence: (occurrence: TaskScheduleOccurrence) => void;
  onSkipOccurrence: (occurrence: TaskScheduleOccurrence) => void;
  t: Translate;
  format: Format;
}) {
  return (
    <div className="space-y-3">
      {page.occurrences.length === 0 ? (
        // A page can come back empty and still carry a cursor, so the button
        // below stays reachable rather than dead-ending the view.
        <p className="text-muted-foreground text-sm">{emptyLabel}</p>
      ) : (
        <ul aria-label={listLabel} className="divide-border/50 divide-y">
          {page.occurrences.map((occurrence) => (
            <OccurrenceRow
              key={occurrence.id}
              occurrence={occurrence}
              onMove={
                isMovableOccurrence(occurrence)
                  ? () => onMoveOccurrence(occurrence)
                  : undefined
              }
              onRestore={
                isRestorableOccurrence(occurrence)
                  ? () => onRestoreOccurrence(occurrence)
                  : undefined
              }
              onSkip={
                isMovableOccurrence(occurrence)
                  ? () => onSkipOccurrence(occurrence)
                  : undefined
              }
              t={t}
              format={format}
            />
          ))}
        </ul>
      )}

      {page.nextCursor ? (
        <Button
          variant="outline"
          size="sm"
          onClick={onLoadMore}
          disabled={isPending}
        >
          {isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {t("loading")}
            </>
          ) : (
            t("loadMore")
          )}
        </Button>
      ) : null}
    </div>
  );
}

function OccurrenceRow({
  occurrence,
  onMove,
  onRestore,
  onSkip,
  t,
  format,
}: {
  occurrence: TaskScheduleOccurrence;
  onMove?: () => void;
  onRestore?: () => void;
  onSkip?: () => void;
  t: Translate;
  format: Format;
}) {
  const state = resolveOccurrenceState(occurrence, t);
  const StateIcon = state.Icon;
  const movedFrom =
    occurrence.originalScheduledAt &&
    occurrence.originalScheduledAt.getTime() !==
      occurrence.effectiveScheduledAt.getTime()
      ? formatOccurrenceTime(format, occurrence.originalScheduledAt, occurrence)
      : null;
  const released = occurrence.releasedTask;

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
      <StateIcon
        className={cn(
          "size-4 shrink-0",
          state.isProblem ? "text-destructive" : "text-muted-foreground",
        )}
        aria-hidden
      />
      <span className="text-sm tabular-nums">
        {formatOccurrenceTime(
          format,
          occurrence.effectiveScheduledAt,
          occurrence,
        )}
      </span>
      <span
        className={cn(
          "text-xs",
          state.isProblem ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {state.label}
      </span>
      {movedFrom ? (
        <span className="text-muted-foreground text-xs">
          {t("movedFrom", { original: movedFrom })}
        </span>
      ) : null}
      {onMove || onRestore || onSkip ? (
        <span className="ms-auto flex items-center gap-2">
          {onMove ? (
            <Button size="sm" type="button" variant="outline" onClick={onMove}>
              {t("move")}
            </Button>
          ) : null}
          {onSkip ? (
            <Button size="sm" type="button" variant="outline" onClick={onSkip}>
              {t("skip")}
            </Button>
          ) : null}
          {onRestore ? (
            <Button
              size="sm"
              type="button"
              variant="outline"
              onClick={onRestore}
            >
              {t("restore")}
            </Button>
          ) : null}
        </span>
      ) : null}
      {released ? (
        <span className="ms-auto flex min-w-0 items-center gap-2">
          {released.archivedAt ? (
            <>
              {/* Archived Tasks are no longer readable, so the row keeps the
                  record without a link that would only 404. */}
              <span
                className="text-muted-foreground truncate text-sm"
                title={released.name}
              >
                {released.name}
              </span>
              <span className="text-muted-foreground shrink-0 text-xs">
                {t("archivedRun")}
              </span>
            </>
          ) : (
            <Link
              href={`/tasks/${released.id}`}
              title={released.name}
              className="hover:text-primary inline-flex min-h-6 min-w-0 items-center text-sm font-medium transition-colors"
            >
              <span className="truncate">{released.name}</span>
            </Link>
          )}
        </span>
      ) : null}
    </li>
  );
}

/**
 * Every state carries an icon and a word. `isProblem` adds the destructive hue
 * to the one state that is a failure — a run whose time passed without
 * releasing — and never carries the meaning on its own.
 */
function resolveOccurrenceState(
  occurrence: TaskScheduleOccurrence,
  t: Translate,
): { label: string; Icon: LucideIcon; isProblem: boolean } {
  switch (occurrence.state) {
    case "RELEASED":
      return {
        label: t("stateReleased"),
        Icon: CircleCheck,
        isProblem: false,
      };
    case "CANCELED":
      return { label: t("stateCanceled"), Icon: Ban, isProblem: false };
    case "SKIPPED":
      return {
        label: t("stateSkipped"),
        Icon: CircleSlash2,
        isProblem: false,
      };
    default:
      return occurrence.isMissed
        ? { label: t("stateMissed"), Icon: CircleAlert, isProblem: true }
        : {
            label: t("statePlanned"),
            Icon: CalendarClock,
            isProblem: false,
          };
  }
}

/**
 * Rendered in the timezone the rule was captured with, so server and client
 * agree regardless of where either sits. Legacy rows without one fall back to
 * the formatter's configured zone: the viewer's (see `TimeZoneSync`).
 *
 * History pages backwards without bound, so a run outside the current year
 * carries its year. "Current" is judged in the same captured zone, not in the
 * reader's, so the two halves of the comparison agree.
 */
function formatOccurrenceTime(
  format: Format,
  value: Date,
  occurrence: TaskScheduleOccurrence,
): string {
  // `undefined` lets `format` apply its configured viewer zone.
  const timeZone = occurrence.timezone ?? undefined;
  const year = format.dateTime(value, { year: "numeric", timeZone });
  const currentYear = format.dateTime(new Date(), {
    year: "numeric",
    timeZone,
  });

  return format.dateTime(
    value,
    year === currentYear ? "dateTime" : "dateTimeWithYear",
    { timeZone },
  );
}
