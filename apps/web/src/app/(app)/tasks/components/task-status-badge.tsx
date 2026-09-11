import {
  MARKER_ICONS,
  STATUS_ROLE_STYLES,
  StatusMarker,
  type StatusMarkerSpec,
} from "@/components/ui/status-marker";
import { TaskStatus } from "@/lib/clients/generated/core";

import { cn } from "@/lib/utils";

const STATUS_LABELS: Partial<Record<TaskStatus, string>> = {
  [TaskStatus.DRAFT]: "Draft",
  [TaskStatus.QUEUED]: "Queued",
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
 * One role per status for colour, one glyph per status for identity. The role
 * table and the glyph vocabulary live in `status-marker.tsx`, so the job,
 * file and risk badges say the same thing the same way.
 */
const TASK_STATUS_MARKERS: Record<TaskStatus, StatusMarkerSpec> = {
  [TaskStatus.DRAFT]: { role: "idle", icon: MARKER_ICONS.draft },
  [TaskStatus.QUEUED]: { role: "queued", icon: MARKER_ICONS.queued },
  [TaskStatus.READY]: { role: "queued", icon: MARKER_ICONS.ready },
  [TaskStatus.GRANT_PENDING]: { role: "waiting", icon: MARKER_ICONS.grant },
  [TaskStatus.INPUT_REQUIRED]: { role: "action", icon: MARKER_ICONS.input },
  [TaskStatus.APPROVAL_REQUIRED]: {
    role: "action",
    icon: MARKER_ICONS.approval,
  },
  [TaskStatus.AUTHENTICATION_REQUIRED]: {
    role: "action",
    icon: MARKER_ICONS.auth,
  },
  [TaskStatus.OUT_OF_CREDITS]: {
    role: "action",
    icon: MARKER_ICONS.credits,
  },
  [TaskStatus.CREDITS_TOPPED_UP]: {
    role: "success",
    icon: MARKER_ICONS.toppedUp,
  },
  [TaskStatus.RUNNING]: {
    role: "active",
    icon: MARKER_ICONS.running,
    spin: true,
  },
  [TaskStatus.AWAITING_EXTERNAL]: {
    role: "waiting",
    icon: MARKER_ICONS.awaiting,
  },
  [TaskStatus.COMPLETED]: { role: "success", icon: MARKER_ICONS.completed },
  [TaskStatus.FAILED]: { role: "failure", icon: MARKER_ICONS.failed },
  [TaskStatus.CANCELED]: { role: "closed", icon: MARKER_ICONS.canceled },
};

const DEFAULT_MARKER: StatusMarkerSpec = {
  role: "idle",
  icon: MARKER_ICONS.queued,
};

export function getTaskStatusMarker(status: TaskStatus): StatusMarkerSpec {
  return TASK_STATUS_MARKERS[status] ?? DEFAULT_MARKER;
}

/** Kept for callers that paint a bare dot outside a badge. */
export function getTaskStatusDotColorClass(status: TaskStatus): string {
  return STATUS_ROLE_STYLES[getTaskStatusMarker(status).role].marker.replace(
    "text-",
    "bg-",
  );
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
  /** Ignored. The marker glyph is always drawn; this keeps old call sites. */
  showDot?: boolean;
  showLabel?: boolean;
}

export function TaskStatusBadge({
  status,
  label,
  className,
  showLabel = true,
}: TaskStatusBadgeProps) {
  const marker = getTaskStatusMarker(status);

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium",
        STATUS_ROLE_STYLES[marker.role].bg,
        STATUS_ROLE_STYLES[marker.role].text,
        className,
      )}
    >
      <StatusMarker spec={marker} />
      {showLabel && <span>{label ?? getTaskStatusLabel(status)}</span>}
    </span>
  );
}
