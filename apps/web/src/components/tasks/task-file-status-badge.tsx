"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import {
  MARKER_ICONS,
  STATUS_ROLE_STYLES,
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
const FILE_STATUS_MARKERS: Partial<Record<TaskFileStatus, StatusMarkerSpec>> = {
  [TaskFileStatus.PENDING]: { role: "queued", icon: MARKER_ICONS.queued },
  [TaskFileStatus.FAILED]: { role: "failure", icon: MARKER_ICONS.failed },
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

  const role = STATUS_ROLE_STYLES[marker.role];
  const label = status === TaskFileStatus.PENDING ? t("pending") : t("failed");

  return (
    <Badge
      variant="default"
      className={cn(role.bg, role.text, "gap-1.5", className)}
    >
      <StatusMarker spec={marker} />
      {label}
    </Badge>
  );
}
