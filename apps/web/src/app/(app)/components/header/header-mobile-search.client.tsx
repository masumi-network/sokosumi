"use client";

import { ChevronLeft, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { createPortal } from "react-dom";
import {
  APP_HEADER_SAFE_AREA_PADDING_CLASS,
  APP_HEADER_SAFE_AREA_UNDERLAY_CLASS,
} from "@/app/components/app-shell-safe-area";
import { HISTORY_SEARCH_MAX_LENGTH } from "@/app/history/utils/history-filters";
import { Input } from "@/components/ui/input";
import { useHeaderMobileSearch } from "@/hooks/effects/use-header-mobile-search";
import { cn } from "@/lib/utils";

/** Same chrome as `HeaderLeadingControl` mobile back. */
const MOBILE_HEADER_BACK_BUTTON_CLASS =
  "text-foreground press hover:bg-accent inline-flex size-10 shrink-0 items-center justify-center rounded-md";

export function HeaderMobileSearchControl() {
  const t = useTranslations("App.Header.Search");
  const tNav = useTranslations("App.Channels.MobileNav");
  const { expanded, query, openSearch, collapse, handleInputChange } =
    useHeaderMobileSearch();

  return (
    <>
      <button
        type="button"
        className="press hover:bg-muted relative flex size-10 shrink-0 items-center justify-center rounded-full transition-colors md:hidden"
        aria-label={t("open")}
        data-testid="header-mobile-search-trigger"
        onClick={openSearch}
      >
        <Search className="text-foreground size-4" aria-hidden />
      </button>

      {expanded
        ? createPortal(
            <div
              className={cn(
                "border-grid fixed inset-x-0 top-0 z-[60] border-b bg-background md:hidden",
                APP_HEADER_SAFE_AREA_PADDING_CLASS,
              )}
              data-testid="header-mobile-search-expanded"
              role="search"
            >
              <div
                aria-hidden="true"
                className={APP_HEADER_SAFE_AREA_UNDERLAY_CLASS}
              />
              <div className="relative z-10 flex h-16 w-full items-center gap-2 px-2">
                <button
                  type="button"
                  className={MOBILE_HEADER_BACK_BUTTON_CLASS}
                  aria-label={tNav("back")}
                  data-testid="header-mobile-search-dismiss"
                  onClick={collapse}
                >
                  <ChevronLeft className="size-5" aria-hidden />
                </button>
                <Input
                  autoFocus
                  value={query}
                  onChange={(event) => handleInputChange(event.target.value)}
                  placeholder={t("searchPlaceholder")}
                  aria-label={t("inputLabel")}
                  maxLength={HISTORY_SEARCH_MAX_LENGTH}
                  className="h-10 flex-1"
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
