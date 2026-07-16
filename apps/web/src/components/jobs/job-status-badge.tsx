"use client";

import { CircleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { getJobStatusBadgeLabelKey } from "@/components/jobs/job-status-label";
import { getJobStatusPillStyle } from "@/components/jobs/job-status-styles";
import { SokosumiJobStatus } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

interface JobStatusBadgeProps {
  status: SokosumiJobStatus;
  className?: string;
  variant?: "badge" | "dot";
}

function shouldShowWarningIcon(status: SokosumiJobStatus): boolean {
  return status === SokosumiJobStatus.INPUT_REQUIRED;
}

export function JobStatusBadge({
  status,
  className,
  variant = "badge",
}: JobStatusBadgeProps) {
  const t = useTranslations("Components.Jobs.StatusBadge");
  const label = t(getJobStatusBadgeLabelKey(status));
  const styles = getJobStatusPillStyle(status);
  const showIcon = shouldShowWarningIcon(status);

  if (variant === "dot") {
    return (
      <span
        aria-label={label}
        className={cn(
          "inline-flex size-1.5 shrink-0 rounded-full",
          styles.dot,
          className,
        )}
      />
    );
  }

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium",
        styles.bg,
        styles.text,
        className,
      )}
    >
      {showIcon ? (
        <CircleAlert
          className={cn("size-3 shrink-0", styles.text)}
          aria-hidden
        />
      ) : null}
      <span>{label}</span>
    </span>
  );
}
