import {
  getToneStyle,
  MARKER_ICONS,
  StatusMarker,
  type StatusMarkerSpec,
} from "@/components/ui/status-marker";
import { TaskStatus } from "@/lib/clients/generated/core";

import { cn } from "@/lib/utils";

const STATUS_LABELS: Partial<Record<TaskStatus, string>> = {
  [TaskStatus.DRAFT]: "Draft",
  [TaskStatus.QUEUED]: "Scheduled",
  [TaskStatus.READY]: "Ready",
  [TaskStatus.INPUT_REQUIRED]: "Input required",
  [TaskStatus.APPROVAL_REQUIRED]: "Approval required",
  [TaskStatus.GRANT_PENDING]: "Grant pending",
  [TaskStatus.AUTHENTICATION_REQUIRED]: "Authentication required",
  [TaskStatus.OUT_OF_CREDITS]: "Paused: credits needed",
  [TaskStatus.CREDITS_TOPPED_UP]: "Credits topped up",
  [TaskStatus.RUNNING]: "Running",
  [TaskStatus.AWAITING_EXTERNAL]: "Awaiting external",
  [TaskStatus.COMPLETED]: "Complete",
  [TaskStatus.FAILED]: "Failed",
  [TaskStatus.CANCELED]: "Canceled",
};

/**
 * Hue follows `task-column.ts`, which is the board's own grouping and the
 * only one the reader can see. Weight separates the statuses inside a column.
 *
 * `todo` holds two, so it gets a filled state and an outline one.
 * `input-required` holds five, which no weight scale can carry, so four of
 * them are filled and the glyph separates them.
 *
 * `backlog` holds two as well but is currently an exception to rule 1:
 * `QUEUED` wears `staged` rather than the column's `dormant`. See the note on
 * that entry.
 *
 * `GRANT_PENDING` takes the outline because it is blocked by something other
 * than the reader. The other four are the coworker asking this person for
 * something, and a person cannot even set them by hand. A parked task is not
 * asking at all: Core refuses every write to it (`kind: "task_parked"`), it
 * resumes to `grantResumeStatus` once a vendor workspace grant is approved,
 * and the approval reaches an org OWNER or ADMIN through the grants surface
 * rather than through this task. Blocked, but not by anything the reader does
 * here, which is what `outline` says everywhere else in the scale.
 *
 * `done` is the other exception to rule 1. Its three members are outcomes,
 * and the outcome is the whole point of that column, so they take three hues
 * rather than one.
 */
const TASK_STATUS_MARKERS: Record<TaskStatus, StatusMarkerSpec> = {
  // backlog: not picked up yet.
  [TaskStatus.DRAFT]: {
    tone: { hue: "dormant", weight: "outline" },
    icon: MARKER_ICONS.draft,
  },
  // Exception to rule 1, and a deliberately temporary one. A scheduled task
  // sits in `backlog` on the board but wears `staged`, the Ready hue, because
  // that is what it is: waiting to start, with the start already arranged.
  // Nothing in the backlog column is waiting to start, which is why the
  // column's own hue says the wrong thing about it.
  //
  // It shares the tone with READY and separates by glyph, the way the five
  // `blocked` statuses do. The board is due to stop showing these rows at all
  // and send the reader to the schedules surface instead (SOK-1112); the
  // exception goes when that lands.
  [TaskStatus.QUEUED]: {
    tone: { hue: "staged", weight: "filled" },
    icon: MARKER_ICONS.queued,
  },

  // todo: staged, waiting to start.
  [TaskStatus.READY]: {
    tone: { hue: "staged", weight: "filled" },
    icon: MARKER_ICONS.ready,
  },
  [TaskStatus.CREDITS_TOPPED_UP]: {
    tone: { hue: "staged", weight: "outline" },
    icon: MARKER_ICONS.toppedUp,
  },

  // in-progress: running now, or held mid-flight.
  [TaskStatus.RUNNING]: {
    tone: { hue: "active", weight: "filled" },
    icon: MARKER_ICONS.running,
    spin: true,
  },
  [TaskStatus.AWAITING_EXTERNAL]: {
    tone: { hue: "active", weight: "outline" },
    icon: MARKER_ICONS.awaiting,
  },

  // input-required: nothing proceeds until someone answers.
  // Parked on a vendor workspace grant. See the note above the table.
  [TaskStatus.GRANT_PENDING]: {
    tone: { hue: "blocked", weight: "outline" },
    icon: MARKER_ICONS.grant,
  },
  [TaskStatus.INPUT_REQUIRED]: {
    tone: { hue: "blocked", weight: "filled" },
    icon: MARKER_ICONS.input,
  },
  [TaskStatus.APPROVAL_REQUIRED]: {
    tone: { hue: "blocked", weight: "filled" },
    icon: MARKER_ICONS.approval,
  },
  [TaskStatus.AUTHENTICATION_REQUIRED]: {
    tone: { hue: "blocked", weight: "filled" },
    icon: MARKER_ICONS.auth,
  },
  [TaskStatus.OUT_OF_CREDITS]: {
    tone: { hue: "blocked", weight: "filled" },
    icon: MARKER_ICONS.credits,
  },

  // done: the outcome is the point, so hue carries it.
  [TaskStatus.COMPLETED]: {
    tone: { hue: "resolved", weight: "filled" },
    icon: MARKER_ICONS.completed,
  },
  [TaskStatus.FAILED]: {
    tone: { hue: "fault", weight: "solid" },
    icon: MARKER_ICONS.failed,
  },
  [TaskStatus.CANCELED]: {
    tone: { hue: "dormant", weight: "outline" },
    icon: MARKER_ICONS.canceled,
  },
};

const DEFAULT_MARKER: StatusMarkerSpec = {
  tone: { hue: "dormant", weight: "outline" },
  icon: MARKER_ICONS.queued,
};

export function getTaskStatusMarker(status: TaskStatus): StatusMarkerSpec {
  return TASK_STATUS_MARKERS[status] ?? DEFAULT_MARKER;
}

/** Kept for callers that paint a bare dot outside a badge. */
export function getTaskStatusDotColorClass(status: TaskStatus): string {
  return getToneStyle(getTaskStatusMarker(status).tone).dot;
}

export function getTaskStatusBorderColorClass(status: TaskStatus): string {
  if (status === TaskStatus.COMPLETED) {
    return "border-semantic-success-tertiary";
  }

  return "border-border";
}

function getTaskStatusLabel(status: TaskStatus): string {
  return STATUS_LABELS[status] ?? "Unknown";
}

interface TaskStatusBadgeProps {
  status: TaskStatus;
  /** When set, overrides the default English label (e.g. from next-intl). */
  label?: string;
  className?: string;
  showLabel?: boolean;
}

export function TaskStatusBadge({
  status,
  label,
  className,
  showLabel = true,
}: TaskStatusBadgeProps) {
  const marker = getTaskStatusMarker(status);
  const style = getToneStyle(marker.tone);
  const statusLabel = label ?? getTaskStatusLabel(status);

  return (
    <span
      role={showLabel ? undefined : "img"}
      aria-label={showLabel ? undefined : statusLabel}
      title={showLabel ? undefined : statusLabel}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-sm border px-2.5 py-1 text-xs font-medium",
        style.box,
        style.label,
        className,
      )}
    >
      <StatusMarker spec={marker} />
      {showLabel && <span>{statusLabel}</span>}
    </span>
  );
}

export interface TaskStatusInlineProps {
  status: TaskStatus;
  /** Overrides the default English label (e.g. from next-intl). */
  label?: string;
  className?: string;
}

/**
 * The historic form: a dot and the word, with no box around them.
 *
 * An activity row already carries an actor, an origin and a timestamp. A
 * filled badge in that line is heavy furniture competing with all three,
 * where a dot and a word read as part of the sentence.
 *
 * It also sidesteps the glyph problem. A history row is a value someone set
 * hours ago, so `StatusMarker` would hold the running glyph still, and a
 * stopped `LoaderCircle` is an arc with a gap in it: the glyph means motion
 * and nothing else, so at rest it reads as a rendering fault. The dot has no
 * resting problem because it was never moving.
 *
 * Colour still does its job here. The dot carries the hue, which says which
 * column the task moved into, and the word names the exact status, so nothing
 * depends on colour alone.
 */
export function TaskStatusInline({
  status,
  label,
  className,
}: TaskStatusInlineProps) {
  const marker = getTaskStatusMarker(status);
  const style = getToneStyle(marker.tone);

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 text-xs font-medium",
        style.labelOnSurface,
        className,
      )}
    >
      <span
        aria-hidden
        className={cn("size-2 shrink-0 rounded-full", style.dot)}
      />
      <span>{label ?? getTaskStatusLabel(status)}</span>
    </span>
  );
}
