"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useOptionalHistorySearch } from "@/app/components/history-search-dialog-provider";
import { Kbd } from "@/components/ui/kbd";
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
        "bg-quinary text-muted-foreground hover:bg-quaternary hover:text-foreground focus-visible:ring-ring-halo items-center justify-center gap-2 rounded-md text-sm outline-none transition-[color,background-color] focus-visible:ring-[3px] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-transparent lg:justify-start lg:px-2.5",
      )}
    >
      <Search className="size-4 shrink-0" />
      <span className="hidden flex-1 truncate text-left lg:inline">
        {t("searchPlaceholder")}
      </span>
      <Kbd aria-hidden className="hidden lg:inline">
        {historySearch.searchShortcutLabel}
      </Kbd>
    </button>
  );
}
