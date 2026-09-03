"use client";

import { ChevronLeft, Search } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDebouncedCallback } from "use-debounce";
import {
  APP_HEADER_SAFE_AREA_PADDING_CLASS,
  APP_HEADER_SAFE_AREA_UNDERLAY_CLASS,
} from "@/app/components/app-shell-safe-area";
import {
  HISTORY_FILTER_PARAM_KEYS,
  HISTORY_SEARCH_MAX_LENGTH,
} from "@/app/history/utils/history-filters";
import { Input } from "@/components/ui/input";
import { getEnvPublicConfig } from "@/config/env.public";
import { cn } from "@/lib/utils";

const HISTORY_PATH = "/history";

/** Same chrome as `HeaderLeadingControl` mobile back. */
const MOBILE_HEADER_BACK_BUTTON_CLASS =
  "text-foreground hover:bg-accent inline-flex size-8 shrink-0 items-center justify-center rounded-md";

function isHistoryPath(pathname: string): boolean {
  return pathname === HISTORY_PATH || pathname.endsWith(HISTORY_PATH);
}

function readLocationSearch(): string {
  if (typeof window === "undefined") {
    return "";
  }
  return window.location.search;
}

function readHistoryQueryFromLocation(): string {
  return (
    new URLSearchParams(readLocationSearch()).get(
      HISTORY_FILTER_PARAM_KEYS.q,
    ) ?? ""
  );
}

export function HeaderMobileSearchControl() {
  const t = useTranslations("App.Header.Search");
  const tNav = useTranslations("App.Channels.MobileNav");
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const router = useRouter();
  const pathname = usePathname();
  const previousPathnameRef = useRef(pathname);
  const navigatedToHistoryRef = useRef(false);
  const queryRef = useRef(query);
  queryRef.current = query;

  function replaceHistoryQuery(nextQuery: string | null) {
    const currentPath =
      typeof window !== "undefined" ? window.location.pathname : pathname;
    if (!isHistoryPath(currentPath)) {
      return;
    }

    const paramsForMerge = new URLSearchParams(readLocationSearch());

    if (nextQuery) {
      paramsForMerge.set(HISTORY_FILTER_PARAM_KEYS.q, nextQuery);
    } else {
      paramsForMerge.delete(HISTORY_FILTER_PARAM_KEYS.q);
    }

    const nextQueryString = paramsForMerge.toString();
    router.replace(
      nextQueryString ? `${HISTORY_PATH}?${nextQueryString}` : HISTORY_PATH,
    );
  }

  const debouncedReplaceHistoryQuery = useDebouncedCallback(
    replaceHistoryQuery,
    getEnvPublicConfig().NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME,
  );

  useEffect(() => {
    const previousPathname = previousPathnameRef.current;
    previousPathnameRef.current = pathname;

    if (
      expanded &&
      isHistoryPath(previousPathname) &&
      !isHistoryPath(pathname)
    ) {
      debouncedReplaceHistoryQuery.cancel();
      navigatedToHistoryRef.current = false;
      setExpanded(false);
      setQuery("");
      return;
    }

    // Opened search from a non-history route: typing can race `router.push`.
    // Debounced replaces no-op off /history and used to be cancelled on arrival.
    // Flush the local query once navigation lands so `?q=` reaches the URL.
    if (
      expanded &&
      !isHistoryPath(previousPathname) &&
      isHistoryPath(pathname)
    ) {
      debouncedReplaceHistoryQuery.cancel();
      const trimmedQuery = queryRef.current.trim();
      if (trimmedQuery) {
        replaceHistoryQuery(trimmedQuery);
      }
    }
  }, [pathname, expanded, debouncedReplaceHistoryQuery]);

  useEffect(() => {
    return () => {
      debouncedReplaceHistoryQuery.cancel();
    };
  }, [debouncedReplaceHistoryQuery]);

  function openSearch() {
    setExpanded(true);
    if (!isHistoryPath(pathname)) {
      setQuery("");
      navigatedToHistoryRef.current = true;
      router.push(HISTORY_PATH);
      return;
    }
    navigatedToHistoryRef.current = false;
    setQuery(readHistoryQueryFromLocation());
  }

  function collapse() {
    debouncedReplaceHistoryQuery.cancel();
    const shouldNavigateBack = navigatedToHistoryRef.current;
    const hadQuery =
      query.trim().length > 0 ||
      (isHistoryPath(pathname) && readHistoryQueryFromLocation().length > 0);
    navigatedToHistoryRef.current = false;
    setQuery("");
    setExpanded(false);
    if (shouldNavigateBack) {
      router.back();
      return;
    }
    if (isHistoryPath(pathname) && hadQuery) {
      replaceHistoryQuery(null);
    }
  }

  function handleInputChange(next: string) {
    const capped = next.slice(0, HISTORY_SEARCH_MAX_LENGTH);
    setQuery(capped);
    debouncedReplaceHistoryQuery(capped.trim() || null);
  }

  return (
    <>
      <button
        type="button"
        className="hover:bg-muted relative flex size-8 shrink-0 items-center justify-center rounded-full transition-colors md:hidden"
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
