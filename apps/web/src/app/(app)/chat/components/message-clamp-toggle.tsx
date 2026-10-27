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
        "text-primary press hover:text-primary-hover text-xs font-medium outline-none focus-visible:underline",
        className,
      )}
      onClick={onToggle}
    >
      {expanded ? t("showLess") : t("showMore")}
    </button>
  );
}
