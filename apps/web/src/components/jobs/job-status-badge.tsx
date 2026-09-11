"use client";

import { useTranslations } from "next-intl";
import { getJobStatusBadgeLabelKey } from "@/components/jobs/job-status-label";
import { getJobStatusMarker } from "@/components/jobs/job-status-styles";
import {
  STATUS_ROLE_STYLES,
  StatusMarker,
} from "@/components/ui/status-marker";
import { SokosumiJobStatus } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

interface JobStatusBadgeProps {
  status: SokosumiJobStatus;
  className?: string;
  variant?: "badge" | "dot";
}

export function JobStatusBadge({
  status,
  className,
  variant = "badge",
}: JobStatusBadgeProps) {
  const t = useTranslations("Components.Jobs.StatusBadge");
  const label = t(getJobStatusBadgeLabelKey(status));
  const marker = getJobStatusMarker(status);

  // The compact variant drops the label, not the glyph: a bare colour dot was
  // the whole problem, since two statuses could share a hue.
  if (variant === "dot") {
    return (
      <span aria-label={label} className={cn("inline-flex", className)}>
        <StatusMarker spec={marker} />
      </span>
    );
  }

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
      <span>{label}</span>
    </span>
  );
}
