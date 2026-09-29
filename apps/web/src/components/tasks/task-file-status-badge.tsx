"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import {
  getToneStyle,
  MARKER_ICONS,
  StatusMarker,
  type StatusMarkerSpec,
} from "@/components/ui/status-marker";
import { TaskFileStatus } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

/**
 * A pending file is queued for processing: the reader waits, nothing is wrong,
 * and there is nothing to do. A failed one is terminal for that file, which is
 * the solid fill.
 */
export const FILE_STATUS_MARKERS: Partial<
  Record<TaskFileStatus, StatusMarkerSpec>
> = {
  [TaskFileStatus.PENDING]: {
    tone: { hue: "staged", weight: "filled" },
    icon: MARKER_ICONS.queued,
  },
  [TaskFileStatus.FAILED]: {
    tone: { hue: "fault", weight: "solid" },
    icon: MARKER_ICONS.failed,
  },
};

export interface TaskFileStatusBadgeProps {
  status?: TaskFileStatus;
  className?: string;
}

export function TaskFileStatusBadge({
  status,
  className,
}: TaskFileStatusBadgeProps) {
  const t = useTranslations("Components.Tasks.TaskFileStatusBadge");
  const marker = status ? FILE_STATUS_MARKERS[status] : undefined;

  if (!(status && marker)) {
    return null;
  }

  const style = getToneStyle(marker.tone);
  const label = status === TaskFileStatus.PENDING ? t("pending") : t("failed");

  return (
    <Badge
      variant="default"
      // Badge sets [&>svg]:size-3 on the parent, and `.badge > svg` outranks
      // the size-3.5 StatusMarker puts on the svg itself, so the glyph
      // rendered at the 12px the marker exists to avoid. Restated here, where
      // className merges last and wins.
      className={cn(
        style.box,
        style.label,
        "gap-1.5 [&>svg]:size-3.5",
        className,
      )}
    >
      <StatusMarker spec={marker} />
      {label}
    </Badge>
  );
}
