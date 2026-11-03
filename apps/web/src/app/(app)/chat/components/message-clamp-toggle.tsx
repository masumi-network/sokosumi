"use client";

import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

/** Show more / Show less under a collapsed message body or brief card. */
export function MessageClampToggle({
  expanded,
  onToggle,
  className,
}: {
  expanded: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const t = useTranslations("App.Channels.Message");
  return (
    <button
      type="button"
      className={cn(
        "text-foreground press underline underline-offset-4 text-xs font-medium rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      onClick={onToggle}
    >
      {expanded ? t("showLess") : t("showMore")}
    </button>
  );
}
