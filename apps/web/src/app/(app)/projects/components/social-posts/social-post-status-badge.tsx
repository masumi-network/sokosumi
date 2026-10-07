import type { SocialPostStatus } from "@sokosumi/core-client";
import {
  getToneStyle,
  MARKER_ICONS,
  StatusMarker,
  type StatusMarkerSpec,
} from "@/components/ui/status-marker";
import { cn } from "@/lib/utils";

/**
 * The Task board's status scale, read for a post: hue says where it stands,
 * weight separates statuses that share a hue, and the glyph names it.
 *
 * A draft and a canceled post are `dormant`, like a draft or canceled task.
 * A scheduled post is `staged`, like a scheduled task: the start is
 * arranged. Publishing is `active` and spins. Published is `resolved`.
 * Failed is `fault` at full weight, and missed is `blocked`: it waits on the
 * reader to retry or reschedule it.
 */
const STATUS_MARKERS: Record<SocialPostStatus, StatusMarkerSpec> = {
  DRAFT: {
    tone: { hue: "dormant", weight: "outline" },
    icon: MARKER_ICONS.draft,
  },
  SCHEDULED: {
    tone: { hue: "staged", weight: "filled" },
    icon: MARKER_ICONS.queued,
  },
  PUBLISHING: {
    tone: { hue: "active", weight: "filled" },
    icon: MARKER_ICONS.running,
    spin: true,
  },
  PUBLISHED: {
    tone: { hue: "resolved", weight: "filled" },
    icon: MARKER_ICONS.completed,
  },
  FAILED: {
    tone: { hue: "fault", weight: "solid" },
    icon: MARKER_ICONS.failed,
  },
  MISSED: {
    tone: { hue: "blocked", weight: "filled" },
    icon: MARKER_ICONS.warning,
  },
  CANCELED: {
    tone: { hue: "dormant", weight: "outline" },
    icon: MARKER_ICONS.canceled,
  },
};

interface SocialPostStatusBadgeProps {
  label: string;
  status: SocialPostStatus;
  showLabel?: boolean;
  className?: string;
}

/** A post's status, drawn the way the Task board draws a task's. */
export function SocialPostStatusBadge({
  label,
  status,
  showLabel = true,
  className,
}: SocialPostStatusBadgeProps) {
  const marker = STATUS_MARKERS[status];
  const style = getToneStyle(marker.tone);
  return (
    <span
      aria-label={showLabel ? undefined : label}
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1.5 rounded-sm border text-xs font-medium",
        showLabel ? "px-2.5 py-1" : "size-5 justify-center p-0",
        style.box,
        style.label,
        className,
      )}
      data-testid={`social-post-status-${status}`}
      role={showLabel ? undefined : "img"}
      title={showLabel ? undefined : label}
    >
      <StatusMarker spec={marker} />
      {showLabel ? <span>{label}</span> : null}
    </span>
  );
}
