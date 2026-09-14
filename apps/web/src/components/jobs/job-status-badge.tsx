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
  //
  // It also drops the badge fill, so the glyph cannot take `marker`, which is
  // the colour of the label ON that fill. For the failure role that is the
  // near-white label, which measured 1.06:1 on --card-background: an invisible
  // mark on exactly the status that most needs to be seen. `onSurface` is the
  // field that carries a colour readable against the surface instead of the
  // fill. It is `dot` as a text colour, and it has to be its own field: the
  // glyph here is an svg painted by `currentColor`, so a `bg-` class does
  // nothing to it.
  if (variant === "dot") {
    return (
      <span aria-label={label} className={cn("inline-flex", className)}>
        <StatusMarker
          spec={marker}
          className={STATUS_ROLE_STYLES[marker.role].onSurface}
        />
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
