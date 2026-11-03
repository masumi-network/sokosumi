"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useOptionalHistorySearch } from "@/app/components/history-search-dialog-provider";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Search in the sidebar header, before New task, as in Linear: opens the
 * history search dialog, which ⌘K / Ctrl+K opens from anywhere. Desktop
 * only; the phone keeps Search in its top bar.
 */
export function SidebarSearchButton() {
  const t = useTranslations("App.Header.Search");
  // Soft read: the Instant Nav shell mounts before HistorySearchDialogProvider.
  const historySearch = useOptionalHistorySearch();

  if (!historySearch) {
    return null;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("open")}
          aria-keyshortcuts="Meta+K Control+K"
          onClick={historySearch.openHistorySearch}
          className="hidden size-10 shrink-0 md:inline-flex md:size-8"
        >
          <Search aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        sideOffset={6}
        className="flex items-center gap-2"
      >
        {t("open")}
        <Kbd className="opacity-70">{historySearch.searchShortcutLabel}</Kbd>
      </TooltipContent>
    </Tooltip>
  );
}
