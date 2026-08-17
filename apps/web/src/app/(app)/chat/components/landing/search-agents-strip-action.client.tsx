"use client";

import { Bot } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

interface SearchAgentsStripActionProps {
  size?: "compact" | "default";
}

/**
 * "Search agents" trailing action for the coworker strip (mobile only).
 * Matches the strip's chip size and styling.
 */
export function SearchAgentsStripAction({
  size = "default",
}: SearchAgentsStripActionProps) {
  const t = useTranslations("App.Channels.MobileNav");

  const scale =
    size === "compact"
      ? {
          itemWidth: "w-[5.5rem]",
          iconSize: "size-11",
          name: "text-xs",
          title: "text-[0.625rem]",
        }
      : {
          itemWidth: "w-28 xl:w-36",
          iconSize: "size-16 xl:size-20",
          name: "text-sm",
          title: "text-xs",
        };

  return (
    <Link
      href="/agents"
      className={cn(
        "flex shrink-0 flex-col items-center gap-2 text-center outline-none",
        "focus-visible:ring-ring rounded-md focus-visible:ring-2 focus-visible:ring-offset-2",
        scale.itemWidth,
      )}
    >
      <span
        className={cn(
          "ring-border bg-muted text-muted-foreground relative flex shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 opacity-70 hover:opacity-100",
          scale.iconSize,
        )}
      >
        <Bot className="size-1/2" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span
          className={cn(
            "text-foreground truncate font-medium leading-tight",
            scale.name,
          )}
        >
          {t("searchAgents")}
        </span>
        <span
          className={cn(
            "text-muted-foreground line-clamp-2 min-h-[2lh]",
            scale.title,
          )}
        >
          {"\u00a0"}
        </span>
      </span>
    </Link>
  );
}
