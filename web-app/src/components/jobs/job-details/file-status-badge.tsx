"use client";

import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface FileStatusBadgeProps {
  status?: string | null; // "PENDING" | "FAILED" | undefined
  className?: string;
}

export function FileStatusBadge({ status, className }: FileStatusBadgeProps) {
  const t = useTranslations("Components.Jobs.JobDetails.FileStatusBadge");
  const normalized = (status ?? "").toUpperCase();

  if (normalized === "PENDING") {
    return (
      <Badge
        variant="default"
        className={cn("bg-yellow-100 text-yellow-800", className)}
      >
        {t("pending")}
      </Badge>
    );
  }
  if (normalized === "FAILED") {
    return (
      <Badge
        variant="default"
        className={cn("bg-red-100 text-red-800", className)}
      >
        {t("failed")}
      </Badge>
    );
  }
  return null;
}
