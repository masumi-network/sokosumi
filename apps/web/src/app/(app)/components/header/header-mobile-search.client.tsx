"use client";

import { ArrowLeft, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { createPortal } from "react-dom";
import {
  APP_HEADER_SAFE_AREA_PADDING_CLASS,
  APP_HEADER_SAFE_AREA_UNDERLAY_CLASS,
} from "@/app/components/app-shell-safe-area";
import { HistorySearchItemStatus } from "@/app/components/history-search-item-status";
import { mobileChromeSurfaceClass } from "@/app/components/mobile-chrome-surface";
import { useHistorySearchCorpus } from "@/app/components/use-history-search-corpus";
import { getHistoryItemHref } from "@/app/history/components/history-list-item";
import {
  HistoryMetaTime,
  HistoryOwnerAvatar,
} from "@/app/history/components/history-meta";
import { HistoryTypeIcon } from "@/app/history/components/history-type-icon";
import { Input } from "@/components/ui/input";
import useIsApplePlatform from "@/hooks/use-is-apple-platform";
import type { HistoryItem } from "@/lib/clients/generated/core/types.gen";
import { cn } from "@/lib/utils";
import { useLocalizedDateTime } from "@/lib/utils/datetime.client";

interface HeaderMobileSearchControlProps {
  activeOrganizationId: string | null;
}

export function HeaderMobileSearchControl({
  activeOrganizationId,
}: HeaderMobileSearchControlProps) {
  const t = useTranslations("App.Header.Search");
  const tHistory = useTranslations("App.History");
  const [expanded, setExpanded] = useState(false);
  const isApple = useIsApplePlatform();
  const router = useRouter();
  const { formatTimeAgo } = useLocalizedDateTime();
  const showOwner = activeOrganizationId !== null;
  const { query, setQuery, history, error, isLoading, reset } =
    useHistorySearchCorpus({
      open: expanded,
      activeOrganizationId,
      errorLabel: t("error"),
    });

  function collapse() {
    reset();
    setExpanded(false);
  }

  function handleSelect(item: HistoryItem) {
    const href = getHistoryItemHref(item);
    collapse();
    if (href) {
      router.push(href);
    }
  }

  return (
    <>
      <button
        type="button"
        className="hover:bg-muted relative flex size-8 shrink-0 items-center justify-center rounded-full transition-colors md:hidden"
        aria-label={t("open")}
        data-testid="header-mobile-search-trigger"
        onClick={() => setExpanded(true)}
      >
        <Search className="text-foreground size-4" aria-hidden />
      </button>

      {expanded
        ? createPortal(
            <div
              className="fixed inset-0 z-[60] md:hidden"
              data-testid="header-mobile-search-expanded"
              role="search"
            >
              <button
                type="button"
                className="absolute inset-0 cursor-default bg-black/20"
                aria-label={t("dismissBackdrop")}
                onClick={collapse}
              />
              <div
                className={cn(
                  "border-grid relative z-10 w-full border-b",
                  APP_HEADER_SAFE_AREA_PADDING_CLASS,
                  mobileChromeSurfaceClass(isApple),
                )}
              >
                <div
                  aria-hidden="true"
                  className={APP_HEADER_SAFE_AREA_UNDERLAY_CLASS}
                />
                <div className="relative z-10 flex h-16 w-full items-center gap-2 px-2">
                  <button
                    type="button"
                    className="hover:bg-muted flex size-8 shrink-0 items-center justify-center rounded-full transition-colors"
                    aria-label={t("dismiss")}
                    data-testid="header-mobile-search-dismiss"
                    onClick={collapse}
                  >
                    <ArrowLeft className="text-foreground size-4" aria-hidden />
                  </button>
                  <Input
                    autoFocus
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t("searchPlaceholder")}
                    aria-label={t("open")}
                    className="h-10 flex-1"
                  />
                </div>
              </div>

              <div className="bg-background relative z-10 max-h-[min(50svh,24rem)] overflow-y-auto border-b shadow-sm">
                {isLoading && history.length === 0 ? (
                  <p className="text-muted-foreground px-4 py-6 text-center text-sm">
                    {t("loading")}
                  </p>
                ) : null}

                {!isLoading && error && history.length === 0 ? (
                  <p className="text-muted-foreground px-4 py-6 text-center text-sm">
                    {error}
                  </p>
                ) : null}

                {!isLoading && !error && history.length === 0 ? (
                  <p className="text-muted-foreground px-4 py-6 text-center text-sm">
                    {t("empty")}
                  </p>
                ) : null}

                {history.length > 0 ? (
                  <ul className="py-1" aria-label={t("resultsHeading")}>
                    {history.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          className="hover:bg-muted flex w-full items-start gap-2 px-4 py-2.5 text-left"
                          onClick={() => handleSelect(item)}
                        >
                          <HistoryTypeIcon
                            item={item}
                            className="mt-0.5 size-4"
                          />
                          <div className="min-w-0 flex-1">
                            <span className="block truncate text-sm">
                              {item.title}
                            </span>
                            <HistoryMetaTime
                              updatedAt={item.updatedAt}
                              formatTimeAgo={formatTimeAgo}
                              updatedLabel={tHistory("Row.updated")}
                              className="text-muted-foreground/70 mt-0.5 block text-left text-xs"
                            />
                          </div>
                          <div className="flex shrink-0 items-center gap-2 self-center">
                            {showOwner ? (
                              <HistoryOwnerAvatar owner={item.owner} />
                            ) : null}
                            <HistorySearchItemStatus item={item} />
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
