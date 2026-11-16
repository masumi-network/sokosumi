import type { SocialPostStatus } from "@sokosumi/core-client";
import {
  getToneStyle,
  MARKER_ICONS,
  StatusMarker,
  type StatusMarkerSpec,
} from "@/components/ui/status-marker";
import { cn } from "@/lib/utils";

/**
 * Original Task board grouping, retained here for context:
 *
 * The Task board's status scale, read for a post: hue says where it stands,
 * weight separates statuses that share a hue, and the glyph names it.
 *
 * A draft and a canceled post are `dormant`, like a draft or canceled task.
 * Needs approval is `staged` and outline: a person still has to let it go.
 * A scheduled post is `staged`, like a scheduled task: the start is
 * arranged. Publishing is `active` and spins. Published is `resolved`.
 * Failed is `fault` at full weight, and missed is `blocked`: it waits on the
 * reader to retry or reschedule it.
 *
 * Social now uses semantic ink instead of column hues: approval and attention
 * are warning, scheduled/publishing info, published success and failed
 * destructive. Draft and canceled stay dormant; every glyph stays distinct.
 */
const STATUS_MARKERS: Record<SocialPostStatus, StatusMarkerSpec> = {
  DRAFT: {
    tone: { hue: "dormant", weight: "outline" },
    icon: MARKER_ICONS.draft,
  },
  NEEDS_APPROVAL: {
    tone: { hue: "warning", weight: "outline" },
    icon: MARKER_ICONS.approval,
  },
  SCHEDULED: {
    tone: { hue: "info", weight: "filled" },
    icon: MARKER_ICONS.queued,
  },
  PUBLISHING: {
    tone: { hue: "info", weight: "filled" },
    icon: MARKER_ICONS.running,
    spin: true,
  },
  PUBLISHED: {
    tone: { hue: "success", weight: "filled" },
    icon: MARKER_ICONS.completed,
  },
  FAILED: {
    tone: { hue: "destructive", weight: "filled" },
    icon: MARKER_ICONS.failed,
  },
  MISSED: {
    tone: { hue: "warning", weight: "filled" },
    icon: MARKER_ICONS.warning,
  },
  CANCELED: {
    tone: { hue: "dormant", weight: "outline" },
    icon: MARKER_ICONS.canceled,
  },
};

/** The status's hue and weight, for a mark drawn outside the badge. */
export function socialPostStatusTone(
  status: SocialPostStatus,
  display: {
    partiallyPublished?: boolean;
    waitingForQuotedPost?: boolean;
  } = {},
) {
  return socialPostStatusMarker(status, display).tone;
}

function socialPostStatusMarker(
  status: SocialPostStatus,
  {
    partiallyPublished = false,
    waitingForQuotedPost = false,
  }: {
    partiallyPublished?: boolean;
    waitingForQuotedPost?: boolean;
  },
): StatusMarkerSpec {
  return partiallyPublished
    ? { tone: { hue: "warning", weight: "filled" }, icon: MARKER_ICONS.warning }
    : waitingForQuotedPost
      ? {
          tone: { hue: "warning", weight: "outline" },
          icon: MARKER_ICONS.awaiting,
        }
      : STATUS_MARKERS[status];
}

interface SocialPostStatusBadgeProps {
  label: string;
  status: SocialPostStatus;
  showLabel?: boolean;
  className?: string;
  partiallyPublished?: boolean;
  waitingForQuotedPost?: boolean;
}

/** A post's status, drawn the way the Task board draws a task's. */
export function SocialPostStatusBadge({
  label,
  status,
  showLabel = true,
  className,
  partiallyPublished = false,
  waitingForQuotedPost = false,
}: SocialPostStatusBadgeProps) {
  const marker = socialPostStatusMarker(status, {
    partiallyPublished,
    waitingForQuotedPost,
  });
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
