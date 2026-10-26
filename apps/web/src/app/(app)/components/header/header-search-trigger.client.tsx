"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useOptionalHistorySearch } from "@/app/components/history-search-dialog-provider";
import { cn } from "@/lib/utils";
import { HEADER_SEARCH_BOX_CLASS } from "./header-search-box";

/**
 * Desktop header Search. Looks like an input but opens the history search
 * dialog, which owns the query. Mobile keeps `HeaderMobileSearchControl`.
 */
export function HeaderSearchTrigger() {
  const t = useTranslations("App.Header.Search");
  // Soft read: Instant Nav shell may mount before HistorySearchDialogProvider.
  const historySearch = useOptionalHistorySearch();

  if (!historySearch) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={historySearch.openHistorySearch}
      aria-label={t("open")}
      aria-keyshortcuts="Meta+K Control+K"
      data-testid="header-search-trigger"
      className={cn(
        HEADER_SEARCH_BOX_CLASS,
        "border-control-border bg-background text-muted-foreground hover:border-ring focus-visible:border-ring focus-visible:ring-ring-halo items-center justify-center gap-2 rounded-md border text-sm outline-none transition-[color,border-color] focus-visible:ring-[3px] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-transparent lg:justify-start lg:px-2.5",
      )}
    >
      <Search className="size-4 shrink-0" />
      <span className="hidden flex-1 truncate text-left lg:inline">
        {t("searchPlaceholder")}
      </span>
      <kbd
        aria-hidden
        className="bg-muted text-muted-foreground hidden shrink-0 rounded border px-1.5 py-0.5 font-sans text-2xs leading-none tracking-widest lg:inline"
      >
        {historySearch.searchShortcutLabel}
      </kbd>
    </button>
  );
}
