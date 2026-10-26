"use client";

import {
  type SocialPostCalendarItem,
  SocialPostStatus,
  type WorkspaceCalendarEntry,
} from "@sokosumi/core-client";
import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type DateTimeFormatOptions,
  useFormatter,
  useTranslations,
} from "next-intl";
import {
  type DragEvent,
  type KeyboardEvent,
  useId,
  useRef,
  useState,
} from "react";
import { Temporal } from "temporal-polyfill";
import {
  SocialPostStatusBadge,
  socialPostStatusDotClass,
} from "@/app/projects/components/social-posts/social-post-status-badge";
import { useSocialCompose } from "@/app/social/components/social-compose-context";
import { SocialPostProviderIcon } from "@/components/social-post-provider-icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getCalendarItemDateKey } from "./calendar-day-key";
import { SocialPostPlannerCard } from "./social-post-calendar-event";
import {
  isChangeableSocialPost,
  rescheduleSocialPost,
  useReportSocialRescheduleFailure,
} from "./social-post-change";
import { usePendingMoves } from "./use-pending-moves";

type PostStatusFilter = Exclude<SocialPostStatus, "DRAFT">;

/** The order a planner reads statuses in: what is coming, then what is done, then what needs a hand. */
const SUMMARY_STATUSES: readonly PostStatusFilter[] = [
  SocialPostStatus.SCHEDULED,
  SocialPostStatus.NEEDS_APPROVAL,
  SocialPostStatus.PUBLISHING,
  SocialPostStatus.PUBLISHED,
  SocialPostStatus.FAILED,
  SocialPostStatus.MISSED,
  SocialPostStatus.CANCELED,
];

/** Bar segments a month cell draws before it stops adding them. */
const MAX_DAY_SEGMENTS = 6;
/** Platform marks a month cell draws before it counts the rest. */
const MAX_DAY_PROVIDERS = 3;
/** The hour a post planned for a later day starts on. */
const DEFAULT_PLAN_TIME = Temporal.PlainTime.from("09:00");

function dayKeyOf(day: Date): string {
  return format(day, "yyyy-MM-dd");
}

/** The days the view lays out: whole weeks around the month, or one week. */
function plannerDays(date: Date, view: "month" | "week"): Date[] {
  return view === "week"
    ? eachDayOfInterval({ start: startOfWeek(date), end: endOfWeek(date) })
    : eachDayOfInterval({
        start: startOfWeek(startOfMonth(date)),
        end: endOfWeek(endOfMonth(date)),
      });
}

/**
 * The same wall-clock time on another calendar day, in the calendar's zone.
 * Dragging a post to Thursday keeps it at 9:00, as the reader planned it.
 */
export function moveToDay(
  scheduledAt: Date,
  dayKey: string,
  timeZone: string,
): Date {
  const time = Temporal.Instant.fromEpochMilliseconds(scheduledAt.getTime())
    .toZonedDateTimeISO(timeZone)
    .toPlainTime();
  const moved = Temporal.PlainDate.from(dayKey).toZonedDateTime({
    timeZone,
    plainTime: time,
  });
  return new Date(moved.epochMilliseconds);
}

/**
 * When a post planned for `dayKey` starts: 9:00 that day, or the next whole
 * hour at least an hour out when 9:00 has already passed.
 */
export function planTimeForDay(
  dayKey: string,
  timeZone: string,
  now: Temporal.ZonedDateTime = Temporal.Now.zonedDateTimeISO(timeZone),
): Date {
  const planned = Temporal.PlainDate.from(dayKey).toZonedDateTime({
    timeZone,
    plainTime: DEFAULT_PLAN_TIME,
  });
  const earliest = now
    .add({ hours: 1 })
    .round({ smallestUnit: "hour", roundingMode: "ceil" });
  const start =
    Temporal.ZonedDateTime.compare(planned, earliest) < 0 ? earliest : planned;
  return new Date(start.epochMilliseconds);
}

/**
 * The day the planner opens on: the one in the URL, else today, else the
 * first day with posts, else the first day of the period.
 */
function pickSelectedDay(
  periodKeys: string[],
  requestedDayKey: string | null,
  todayKey: string,
  postsByDay: Map<string, SocialPostCalendarItem[]>,
): string {
  if (requestedDayKey && periodKeys.includes(requestedDayKey)) {
    return requestedDayKey;
  }
  if (periodKeys.includes(todayKey)) return todayKey;
  return (
    periodKeys.find((key) => postsByDay.has(key)) ?? periodKeys[0] ?? todayKey
  );
}

interface SocialPlannerProps {
  date: Date;
  view: "month" | "week";
  /** The posts the filters let through. */
  items: WorkspaceCalendarEntry[];
  /** The same posts before the status filter, so its counts stay whole. */
  summaryItems: WorkspaceCalendarEntry[];
  timeZone: string;
  /** The day in the URL, which the planner selects when it is in view. */
  requestedDayKey: string | null;
  onSelectDay: (dayKey: string) => void;
  postStatus: PostStatusFilter | null;
  onPostStatusChange: (status: PostStatusFilter | null) => void;
  /** Name each post's project: posts from several projects share the page. */
  showProject: boolean;
}

/**
 * Social's own calendar, laid out for planning a feed rather than reading a
 * grid.
 *
 * A status summary leads and doubles as the status filter. The month is an
 * overview of every day (how many posts, in which state, on which platforms,
 * and which days ahead are still open) beside the selected day's posts in
 * full. The week is seven day lanes. Both stack on a phone instead of
 * scrolling sideways. A post that can still move drags onto another day and
 * keeps its time; the move shows at once and rolls back if Core refuses it.
 */
export function SocialPlanner({
  date,
  view,
  items,
  summaryItems,
  timeZone,
  requestedDayKey,
  onSelectDay,
  postStatus,
  onPostStatusChange,
  showProject,
}: SocialPlannerProps) {
  const t = useTranslations("App.Calendar.planner");
  const formatter = useFormatter();
  const router = useRouter();
  const compose = useSocialCompose();
  const reportFailure = useReportSocialRescheduleFailure();
  const dragHintId = useId();
  const { pendingMoves, addPendingMove, clearPendingMove } =
    usePendingMoves(items);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const days = plannerDays(date, view);
  const monthKey = format(date, "yyyy-MM");
  const periodKeys = days
    .map(dayKeyOf)
    .filter((key) => view === "week" || key.startsWith(monthKey));
  const todayKey = Temporal.Now.plainDateISO(timeZone).toString();
  const posts = items
    .filter((item) => item.kind === "socialPost")
    .map((item) => {
      const moved = pendingMoves[item.id]?.scheduledAt;
      return moved ? { ...item, scheduledAt: moved } : item;
    })
    .sort(
      (left, right) => left.scheduledAt.getTime() - right.scheduledAt.getTime(),
    );
  const postsByDay = Map.groupBy(posts, (post) =>
    getCalendarItemDateKey(post.scheduledAt, timeZone),
  );
  const selectedDayKey = pickSelectedDay(
    periodKeys,
    requestedDayKey,
    todayKey,
    postsByDay,
  );

  // Day labels are calendar days, not instants: format them as themselves.
  function formatDay(dayKey: string, options: DateTimeFormatOptions) {
    return formatter.dateTime(new Date(`${dayKey}T12:00:00Z`), {
      ...options,
      timeZone: "UTC",
    });
  }
  const longDay = (dayKey: string) =>
    formatDay(dayKey, { weekday: "long", month: "long", day: "numeric" });

  function canPlan(dayKey: string) {
    return compose !== null && dayKey >= todayKey;
  }

  function planPost(dayKey: string) {
    compose?.setOpen(true, { scheduledAt: planTimeForDay(dayKey, timeZone) });
  }

  function dragProps(post: SocialPostCalendarItem) {
    if (!isChangeableSocialPost(post)) return {};
    return {
      dragHintId,
      onDragStart: (event: DragEvent) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", post.id);
        setDraggingId(post.id);
      },
      onDragEnd: () => {
        setDraggingId(null);
        setDropKey(null);
      },
    };
  }

  const draggingPost = draggingId
    ? posts.find((post) => post.id === draggingId)
    : undefined;
  function acceptsDrop(dayKey: string) {
    return (
      draggingPost !== undefined &&
      dayKey >= todayKey &&
      dayKey !== getCalendarItemDateKey(draggingPost.scheduledAt, timeZone)
    );
  }

  async function moveDraggedPost(dayKey: string) {
    const item = items.find(({ id }) => id === draggingId);
    setDraggingId(null);
    setDropKey(null);
    if (!item || !isChangeableSocialPost(item)) return;
    const scheduledAt = moveToDay(
      pendingMoves[item.id]?.scheduledAt ?? item.scheduledAt,
      dayKey,
      timeZone,
    );
    addPendingMove(item, scheduledAt);
    if (view === "month") onSelectDay(dayKey);
    setAnnouncement(t("moved", { date: longDay(dayKey) }));
    try {
      const result = await rescheduleSocialPost(item, scheduledAt);
      if (!result.ok) {
        clearPendingMove(item.id);
        reportFailure(result.error);
        return;
      }
      router.refresh();
    } catch {
      clearPendingMove(item.id);
      reportFailure();
    }
  }

  function dropTargetProps(dayKey: string) {
    return {
      onDragOver: (event: DragEvent) => {
        if (!acceptsDrop(dayKey)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        if (dropKey !== dayKey) setDropKey(dayKey);
      },
      onDragLeave: (event: DragEvent) => {
        if (
          dropKey === dayKey &&
          !event.currentTarget.contains(event.relatedTarget as Node | null)
        ) {
          setDropKey(null);
        }
      },
      onDrop: (event: DragEvent) => {
        if (!acceptsDrop(dayKey)) return;
        event.preventDefault();
        void moveDraggedPost(dayKey);
      },
    };
  }

  const dropHighlight = (dayKey: string) =>
    dropKey === dayKey
      ? "ring-2 ring-ring inset-ring-1 inset-ring-ring"
      : undefined;

  const postCards = (dayPosts: SocialPostCalendarItem[]) =>
    dayPosts.map((post) => (
      <li key={post.id} className="min-w-0">
        <SocialPostPlannerCard
          item={post}
          moving={post.id in pendingMoves}
          showProject={showProject}
          timeZone={timeZone}
          {...dragProps(post)}
        />
      </li>
    ));

  const planButton = (dayKey: string) =>
    canPlan(dayKey) ? (
      <Button
        aria-label={t("planFor", { date: longDay(dayKey) })}
        className="max-md:min-h-10"
        onClick={() => planPost(dayKey)}
        size="sm"
        type="button"
        variant="outline"
      >
        <Plus aria-hidden />
        {t("plan")}
      </Button>
    ) : null;

  const periodPosts = posts.filter((post) =>
    periodKeys.includes(getCalendarItemDateKey(post.scheduledAt, timeZone)),
  );
  // A day is open when nothing goes out on it, whatever the status filter
  // shows: a canceled post leaves its day open.
  const occupiedDays = new Set(
    summaryItems
      .filter(
        (item) => item.kind === "socialPost" && item.status !== "CANCELED",
      )
      .map((item) =>
        getCalendarItemDateKey(
          pendingMoves[item.id]?.scheduledAt ?? item.scheduledAt,
          timeZone,
        ),
      ),
  );
  const isOpenDay = (dayKey: string) =>
    dayKey >= todayKey && !occupiedDays.has(dayKey);
  const openDaysAhead = periodKeys.filter(isOpenDay).length;

  return (
    <div
      className="flex min-w-0 flex-col gap-3"
      data-testid={`calendar-${view}`}
      data-view={view}
    >
      <PlannerSummary
        items={summaryItems}
        openDaysAhead={openDaysAhead}
        periodKeys={periodKeys}
        postCount={periodPosts.length}
        postStatus={postStatus}
        timeZone={timeZone}
        onPostStatusChange={onPostStatusChange}
      />
      <p className="sr-only" id={dragHintId}>
        {t("dragHint")}
      </p>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {view === "month" ? (
        <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)] lg:items-start">
          <MonthOverview
            days={days}
            dropHighlight={dropHighlight}
            dropTargetProps={dropTargetProps}
            formatDay={formatDay}
            isOpenDay={isOpenDay}
            label={formatDay(dayKeyOf(date), {
              month: "long",
              year: "numeric",
            })}
            longDay={longDay}
            monthKey={monthKey}
            onSelectDay={onSelectDay}
            postsByDay={postsByDay}
            selectedDayKey={selectedDayKey}
            todayKey={todayKey}
          />
          <DayPanel
            dayKey={selectedDayKey}
            heading={longDay(selectedDayKey)}
            planButton={planButton(selectedDayKey)}
            posts={postsByDay.get(selectedDayKey) ?? []}
            renderPosts={postCards}
          />
        </div>
      ) : (
        <div
          className="grid min-w-0 gap-2 xl:grid-cols-7"
          data-testid="planner-week-lanes"
        >
          {periodKeys.map((dayKey) => {
            const dayPosts = postsByDay.get(dayKey) ?? [];
            const isToday = dayKey === todayKey;
            const isPast = dayKey < todayKey;
            const headingId = `${dragHintId}-${dayKey}`;
            return (
              <section
                aria-labelledby={headingId}
                className={cn(
                  "bg-card-background flex min-w-0 flex-col gap-2 rounded-xl p-2 xl:min-h-64",
                  dropHighlight(dayKey),
                )}
                data-testid="planner-day-lane"
                key={dayKey}
                {...dropTargetProps(dayKey)}
              >
                <header className="flex min-h-8 items-center gap-2 px-1">
                  <h3
                    className={cn(
                      "flex items-baseline gap-1.5 text-sm font-semibold",
                      isPast && "text-muted-foreground",
                    )}
                    id={headingId}
                  >
                    <span>{formatDay(dayKey, { weekday: "short" })}</span>
                    <span
                      className={cn(
                        "tabular-nums",
                        isToday &&
                          "bg-primary-solid text-primary-solid-foreground rounded-full px-1.5",
                      )}
                    >
                      {formatDay(dayKey, { day: "numeric" })}
                    </span>
                    <span className="sr-only">
                      {formatDay(dayKey, { month: "long" })}
                      {isToday ? `, ${t("today")}` : null}
                    </span>
                  </h3>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {t("posts", { count: dayPosts.length })}
                  </span>
                  <DayStatusBar
                    className="ms-auto w-12 xl:w-8"
                    posts={dayPosts}
                  />
                </header>
                {dayPosts.length > 0 ? (
                  <ul className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-1">
                    {postCards(dayPosts)}
                  </ul>
                ) : (
                  <div
                    className={cn(
                      "text-muted-foreground flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs xl:flex-1 xl:flex-col xl:justify-center",
                      isOpenDay(dayKey) &&
                        "border-control-border border border-dashed",
                    )}
                  >
                    <span>{t(isOpenDay(dayKey) ? "openDay" : "noPosts")}</span>
                    {planButton(dayKey)}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PlannerSummary({
  items,
  openDaysAhead,
  periodKeys,
  postCount,
  postStatus,
  timeZone,
  onPostStatusChange,
}: {
  items: WorkspaceCalendarEntry[];
  openDaysAhead: number;
  periodKeys: string[];
  postCount: number;
  postStatus: PostStatusFilter | null;
  timeZone: string;
  onPostStatusChange: (status: PostStatusFilter | null) => void;
}) {
  const t = useTranslations("App.Calendar.planner");
  const statuses = useTranslations("App.Projects.SocialPosts.status");
  const counts = new Map<PostStatusFilter, number>();
  for (const item of items) {
    if (
      item.kind !== "socialPost" ||
      item.status === "DRAFT" ||
      !periodKeys.includes(getCalendarItemDateKey(item.scheduledAt, timeZone))
    ) {
      continue;
    }
    counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
  }
  const shown = SUMMARY_STATUSES.filter(
    (status) => counts.has(status) || status === postStatus,
  );

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
      {shown.length > 0 ? (
        <fieldset className="flex min-w-0 flex-wrap items-center gap-1.5">
          <legend className="sr-only">{t("statusFilter")}</legend>
          {shown.map((status) => {
            const active = postStatus === status;
            return (
              <button
                aria-pressed={active}
                className={cn(
                  "press border-control-border bg-background hover:bg-card-background-hover inline-flex h-8 items-center gap-1.5 rounded-full border ps-1 pe-2.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background max-md:min-h-10 motion-safe:transition-colors motion-safe:duration-150 motion-safe:ease-out",
                  active && "border-primary bg-primary-quinary",
                )}
                data-testid={`planner-status-${status}`}
                key={status}
                onClick={() => onPostStatusChange(active ? null : status)}
                type="button"
              >
                <span aria-hidden className="flex">
                  <SocialPostStatusBadge
                    className="rounded-full"
                    label={statuses(status)}
                    showLabel={false}
                    status={status}
                  />
                </span>
                <span>{statuses(status)}</span>
                <span className="text-muted-foreground tabular-nums">
                  {counts.get(status) ?? 0}
                </span>
              </button>
            );
          })}
        </fieldset>
      ) : null}
      <p className="text-muted-foreground flex flex-wrap gap-x-3 text-xs">
        <span data-testid="planner-post-count">
          {t("posts", { count: postCount })}
        </span>
        <span data-testid="planner-open-days">
          {t("openDays", { count: openDaysAhead })}
        </span>
      </p>
    </div>
  );
}

/** One coloured segment per post, in time order: the day's mix at a glance. */
function DayStatusBar({
  posts,
  className,
}: {
  posts: SocialPostCalendarItem[];
  className?: string;
}) {
  if (posts.length === 0) return null;
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-1.5 gap-px overflow-hidden rounded-full",
        className,
      )}
      data-testid="planner-day-status-bar"
    >
      {posts.slice(0, MAX_DAY_SEGMENTS).map((post) => (
        <span
          className={cn(
            "min-w-0 flex-1",
            socialPostStatusDotClass(post.status),
          )}
          key={post.id}
        />
      ))}
    </span>
  );
}

function MonthOverview({
  days,
  dropHighlight,
  dropTargetProps,
  formatDay,
  isOpenDay,
  label,
  longDay,
  monthKey,
  onSelectDay,
  postsByDay,
  selectedDayKey,
  todayKey,
}: {
  days: Date[];
  dropHighlight: (dayKey: string) => string | undefined;
  dropTargetProps: (dayKey: string) => object;
  formatDay: (dayKey: string, options: DateTimeFormatOptions) => string;
  isOpenDay: (dayKey: string) => boolean;
  label: string;
  longDay: (dayKey: string) => string;
  monthKey: string;
  onSelectDay: (dayKey: string) => void;
  postsByDay: Map<string, SocialPostCalendarItem[]>;
  selectedDayKey: string;
  todayKey: string;
}) {
  const t = useTranslations("App.Calendar.planner");
  const dayButtons = useRef(new Map<string, HTMLButtonElement>());
  const monthKeys = days
    .map(dayKeyOf)
    .filter((key) => key.startsWith(monthKey));

  // Arrow keys walk the days, as in a date picker; Tab leaves the month.
  function handleKeyDown(event: KeyboardEvent, dayKey: string) {
    const step = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    }[event.key];
    const index = monthKeys.indexOf(dayKey);
    const next =
      step !== undefined
        ? monthKeys[index + step]
        : event.key === "Home"
          ? monthKeys[0]
          : event.key === "End"
            ? monthKeys.at(-1)
            : undefined;
    if (!next) return;
    event.preventDefault();
    onSelectDay(next);
    dayButtons.current.get(next)?.focus();
  }

  return (
    <div
      aria-label={label}
      className="bg-card-background min-w-0 rounded-xl p-2"
      data-testid="planner-month-overview"
      role="group"
    >
      <div aria-hidden className="grid grid-cols-7 gap-1 pb-1">
        {days.slice(0, 7).map((day) => (
          <span
            className="text-muted-foreground text-center text-xs font-medium"
            key={dayKeyOf(day)}
          >
            {formatDay(dayKeyOf(day), { weekday: "short" })}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const dayKey = dayKeyOf(day);
          if (!dayKey.startsWith(monthKey)) {
            return <span aria-hidden key={dayKey} />;
          }
          const dayPosts = postsByDay.get(dayKey) ?? [];
          const isSelected = dayKey === selectedDayKey;
          const isToday = dayKey === todayKey;
          const isPast = dayKey < todayKey;
          const isOpen = isOpenDay(dayKey);
          const providers = [...new Set(dayPosts.map((post) => post.provider))];
          return (
            <button
              aria-current={isToday ? "date" : undefined}
              aria-label={t("dayLabel", {
                date: longDay(dayKey),
                count: dayPosts.length,
              })}
              aria-pressed={isSelected}
              className={cn(
                "press bg-background hover:bg-card-background-hover flex min-h-12 min-w-0 flex-col gap-1 rounded-lg border p-1 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring-halo focus-visible:inset-ring-1 focus-visible:inset-ring-ring sm:min-h-20 sm:p-1.5 motion-safe:transition-colors motion-safe:duration-150 motion-safe:ease-out",
                isOpen
                  ? "border-control-border border-dashed"
                  : "border-border",
                isSelected && "border-primary bg-primary-quinary",
                dropHighlight(dayKey),
              )}
              data-open-day={isOpen || undefined}
              data-testid="planner-day"
              key={dayKey}
              onClick={() => onSelectDay(dayKey)}
              onKeyDown={(event) => handleKeyDown(event, dayKey)}
              ref={(element) => {
                if (element) dayButtons.current.set(dayKey, element);
                else dayButtons.current.delete(dayKey);
              }}
              tabIndex={isSelected ? 0 : -1}
              type="button"
              {...dropTargetProps(dayKey)}
            >
              <span className="flex min-w-0 items-center justify-between gap-1">
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium tabular-nums",
                    isPast && !isToday && "text-muted-foreground",
                    isToday && "bg-primary-solid text-primary-solid-foreground",
                  )}
                >
                  {formatDay(dayKey, { day: "numeric" })}
                </span>
                {dayPosts.length > 0 ? (
                  <span className="text-muted-foreground hidden text-xs tabular-nums sm:inline">
                    {dayPosts.length}
                  </span>
                ) : null}
              </span>
              {providers.length > 0 ? (
                <span className="text-muted-foreground hidden min-w-0 items-center gap-1 sm:flex">
                  {providers.slice(0, MAX_DAY_PROVIDERS).map((provider) => (
                    <SocialPostProviderIcon
                      aria-hidden
                      className="size-3 shrink-0"
                      key={provider}
                      provider={provider}
                    />
                  ))}
                  {providers.length > MAX_DAY_PROVIDERS ? (
                    <span className="text-2xs tabular-nums">
                      +{providers.length - MAX_DAY_PROVIDERS}
                    </span>
                  ) : null}
                </span>
              ) : null}
              <DayStatusBar className="mt-auto w-full" posts={dayPosts} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DayPanel({
  dayKey,
  heading,
  planButton,
  posts,
  renderPosts,
}: {
  dayKey: string;
  heading: string;
  planButton: React.ReactNode;
  posts: SocialPostCalendarItem[];
  renderPosts: (posts: SocialPostCalendarItem[]) => React.ReactNode;
}) {
  const t = useTranslations("App.Calendar.planner");
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="bg-card-background flex min-w-0 flex-col gap-2 rounded-xl p-2 lg:sticky lg:top-4"
      data-day={dayKey}
      data-testid="planner-day-panel"
    >
      <header className="flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1 px-1">
        <h3 className="text-sm font-semibold" id={headingId}>
          {heading}
        </h3>
        <span className="text-muted-foreground text-xs tabular-nums">
          {t("posts", { count: posts.length })}
        </span>
        {planButton ? <span className="ms-auto">{planButton}</span> : null}
      </header>
      {posts.length > 0 ? (
        <ul className="flex min-w-0 flex-col gap-2">{renderPosts(posts)}</ul>
      ) : (
        <p className="text-muted-foreground border-control-border rounded-lg border border-dashed px-3 py-6 text-center text-sm">
          {t("emptyDay")}
        </p>
      )}
    </section>
  );
}
