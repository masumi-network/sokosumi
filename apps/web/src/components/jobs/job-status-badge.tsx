"use client";

import { JobType, SokosumiJobStatus } from "@sokosumi/utils";
import { CircleAlert } from "lucide-react";
import { useTranslations } from "next-intl";

import { getJobStatusBadgeLabelKey } from "@/components/jobs/job-status-label";
import { getJobStatusPillStyle } from "@/components/jobs/job-status-styles";
import { cn } from "@/lib/utils";

interface JobStatusBadgeProps {
  status: SokosumiJobStatus;
  jobType?: JobType;
  className?: string;
  variant?: "badge" | "dot";
}

function shouldShowWarningIcon(status: SokosumiJobStatus): boolean {
  return status === SokosumiJobStatus.INPUT_REQUIRED;
}

export function JobStatusBadge({
  status,
  jobType,
  className,
  variant = "badge",
}: JobStatusBadgeProps) {
  const t = useTranslations("Components.Jobs.StatusBadge");
  const label = t(getJobStatusBadgeLabelKey(status, jobType));
  const styles = getJobStatusPillStyle(status, jobType);
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
      {showIcon ? <CircleAlert className="size-3" aria-hidden /> : null}
      <span>{label}</span>
    </span>
  );
}
