"use client";

import { Bot } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { forwardRef } from "react";

import { cn } from "@/lib/utils";

interface SearchAgentsStripActionProps {
  size?: "compact" | "default";
  isSelected: boolean;
  onSelect: () => void;
}

const SEARCH_AGENTS_STRIP_SCALE = {
  compact: {
    featured: "size-20",
    other: "size-11",
    itemWidth: "w-[5.5rem]",
    featuredInitial: "text-xl",
    otherInitial: "text-xs",
    name: "text-xs",
    title: "text-[0.625rem]",
  },
  default: {
    featured: "size-28 xl:size-32",
    other: "size-16 xl:size-20",
    itemWidth: "w-28 xl:w-36",
    featuredInitial: "text-2xl",
    otherInitial: "text-sm",
    name: "text-sm",
    title: "text-xs",
  },
} as const;

/**
 * "Search" trailing action for the coworker strip (mobile only).
 * Matches the strip's chip size and styling, participates in focus/selection.
 */
export const SearchAgentsStripAction = forwardRef<
  HTMLButtonElement,
  SearchAgentsStripActionProps
>(function SearchAgentsStripAction(
  { size = "default", isSelected, onSelect },
  ref,
) {
  const t = useTranslations("App.Chat.Landing");
  const router = useRouter();
  const scale = SEARCH_AGENTS_STRIP_SCALE[size];

  function handleClick(): void {
    onSelect();
    router.push("/agents");
  }

  return (
    <button
      ref={ref}
      type="button"
      role="option"
      aria-selected={isSelected}
      aria-label={t("searchAgents.label")}
      className={cn(
        "flex shrink-0 cursor-pointer flex-col items-center gap-2 text-center transition-opacity outline-none",
        "focus-visible:ring-ring rounded-md focus-visible:ring-2 focus-visible:ring-offset-2",
        scale.itemWidth,
      )}
      onClick={handleClick}
    >
      <span
        className={cn(
          "ring-border bg-muted text-muted-foreground relative flex shrink-0 items-center justify-center overflow-hidden rounded-full ring-1",
          isSelected
            ? scale.featured
            : cn("opacity-70 hover:opacity-100", scale.other),
        )}
      >
        <Bot
          className={cn(
            "shrink-0",
            isSelected ? scale.featuredInitial : scale.otherInitial,
          )}
          aria-hidden
        />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span
          className={cn(
            "text-foreground truncate font-medium leading-tight",
            scale.name,
          )}
        >
          {t("searchAgents.label")}
        </span>
        <span
          className={cn(
            "text-muted-foreground line-clamp-2 min-h-[2lh]",
            scale.title,
          )}
        >
          {t("searchAgents.subtitle")}
        </span>
      </span>
    </button>
  );
});
