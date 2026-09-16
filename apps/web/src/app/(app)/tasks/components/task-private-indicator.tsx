"use client";

import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import { TaskVisibility } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

interface TaskPrivateIndicatorProps {
  visibility: TaskVisibility;
  className?: string;
}

export function TaskPrivateIndicator({
  visibility,
  className,
}: TaskPrivateIndicatorProps) {
  const t = useTranslations("App.Tasks.Detail");

  if (visibility !== TaskVisibility.PRIVATE) {
    return null;
  }

  return (
    <Lock
      className={cn("text-muted-foreground size-3.5 shrink-0", className)}
      aria-label={t("privateBadge")}
    />
  );
}
