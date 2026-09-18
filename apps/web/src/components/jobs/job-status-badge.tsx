"use client";

import { useTranslations } from "next-intl";
import { getJobStatusBadgeLabelKey } from "@/components/jobs/job-status-label";
import { getJobStatusMarker } from "@/components/jobs/job-status-styles";
import { getToneStyle, StatusMarker } from "@/components/ui/status-marker";
import { SokosumiJobStatus } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

interface JobStatusBadgeProps {
  status: SokosumiJobStatus;
  className?: string;
  variant?: "badge" | "dot";
  /**
   * Glyph colour for the `dot` variant, for rows that paint their own
   * background. The role colours are measured against the card surface and
   * none of them clears 3:1 on a filled selection.
   */
  tone?: string;
}

export function JobStatusBadge({
  status,
  className,
  variant = "badge",
  tone,
}: JobStatusBadgeProps) {
  const t = useTranslations("Components.Jobs.StatusBadge");
  const label = t(getJobStatusBadgeLabelKey(status));
  const marker = getJobStatusMarker(status);
  const style = getToneStyle(marker.tone);

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
      // `role="img"` because ARIA forbids `aria-label` on a generic element,
      // and the glyph inside is aria-hidden, so without it the mark has no
      // accessible name of its own.
      <span
        role="img"
        aria-label={label}
        className={cn("inline-flex shrink-0", className)}
      >
        <StatusMarker spec={marker} tone={tone ?? style.onSurface} />
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-sm border px-2.5 py-1 text-xs font-medium",
        style.box,
        style.label,
        className,
      )}
    >
      <StatusMarker spec={marker} />
      <span>{label}</span>
    </span>
  );
}
