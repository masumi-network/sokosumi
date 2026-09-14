import { CalendarDays } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

export interface TaskScheduleSeriesLabels {
  title: string;
  calendar: string;
  repeats: string;
  timezone: string;
  nextRun: string;
  removed: string;
}

export interface TaskScheduleSeriesCalendar {
  /** Project or workspace the series releases into. */
  name: string;
  href: string;
  /** Translated Calendar source kind, e.g. "Project" or "Workspace". */
  sourceLabel: string;
}

interface TaskScheduleSeriesProps {
  labels: TaskScheduleSeriesLabels;
  calendar: TaskScheduleSeriesCalendar;
  /** Human recurrence rule; null once the series has been removed. */
  recurrenceLabel: string | null;
  timezone: string | null;
  /** Formatted `Task.nextRunAt`; the canonical next-occurrence summary. */
  nextRunLabel: string | null;
  isActive: boolean;
  /** Occurrence tabs. Rendered here so the series stays their heading. */
  children?: ReactNode;
}

/**
 * Task detail is the home of a Calendar schedule series: which Calendar it
 * belongs to, what rule it follows, and when it next runs. Values arrive
 * already translated and formatted so this stays server-rendered — only the
 * occurrence tabs below it need client state.
 */
export function TaskScheduleSeries({
  labels,
  calendar,
  recurrenceLabel,
  timezone,
  nextRunLabel,
  isActive,
  children,
}: TaskScheduleSeriesProps) {
  return (
    <section className="space-y-4">
      <h2 className="text-muted-foreground/60 text-xs font-medium">
        {labels.title}
      </h2>

      <dl className="space-y-3">
        <SeriesRow label={labels.calendar}>
          <span className="text-muted-foreground shrink-0 text-xs">
            {calendar.sourceLabel}
          </span>
          <Link
            href={calendar.href}
            title={calendar.name}
            className="hover:text-primary inline-flex min-h-6 min-w-0 items-center gap-1.5 font-medium transition-colors"
          >
            <CalendarDays className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{calendar.name}</span>
          </Link>
        </SeriesRow>

        {recurrenceLabel ? (
          <SeriesRow label={labels.repeats}>
            <span className="min-w-0 font-medium">{recurrenceLabel}</span>
          </SeriesRow>
        ) : null}

        {timezone ? (
          <SeriesRow label={labels.timezone}>
            <span className="min-w-0 font-medium">{timezone}</span>
          </SeriesRow>
        ) : null}

        {nextRunLabel ? (
          <SeriesRow label={labels.nextRun}>
            <span className="min-w-0 font-medium tabular-nums">
              {nextRunLabel}
            </span>
          </SeriesRow>
        ) : null}
      </dl>

      {isActive ? null : (
        <p className="text-muted-foreground text-sm">{labels.removed}</p>
      )}

      {children}
    </section>
  );
}

function SeriesRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="flex min-w-0 items-center gap-2 text-sm">{children}</dd>
    </div>
  );
}
