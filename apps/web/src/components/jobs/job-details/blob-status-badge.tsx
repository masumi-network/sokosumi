"use client";

import { BlobStatus } from "@sokosumi/database";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface BlobStatusBadgeProps {
  status?: BlobStatus;
  className?: string;
}

export function BlobStatusBadge({ status, className }: BlobStatusBadgeProps) {
  const t = useTranslations("Components.Jobs.JobDetails.BlobStatusBadge");

  if (status === BlobStatus.PENDING) {
    return (
      <Badge
        variant="default"
        className={cn("bg-yellow-100 text-yellow-800", className)}
      >
        {t("pending")}
      </Badge>
    );
  }
  if (status === BlobStatus.FAILED) {
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
