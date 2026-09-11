"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { TaskFileStatus } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

export interface TaskFileStatusBadgeProps {
  status?: TaskFileStatus;
  className?: string;
}

export function TaskFileStatusBadge({
  status,
  className,
}: TaskFileStatusBadgeProps) {
  const t = useTranslations("Components.Tasks.TaskFileStatusBadge");

  if (status === TaskFileStatus.PENDING) {
    return (
      <Badge
        variant="default"
        className={cn("bg-semantic-warning-quinary text-foreground", className)}
      >
        {t("pending")}
      </Badge>
    );
  }
  if (status === TaskFileStatus.FAILED) {
    return (
      <Badge
        variant="default"
        className={cn(
          "bg-semantic-destructive-quinary text-foreground",
          className,
        )}
      >
        {t("failed")}
      </Badge>
    );
  }
  return null;
}
