"use client";

import { useTranslations } from "next-intl";
import { useQueryState } from "nuqs";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useDebouncedCallback } from "use-debounce";

import { loadMoreFeed } from "@/app/feed/actions";
import { useFeedData } from "@/app/feed/components/feed-data-provider";
import { FeedResultsList } from "@/app/feed/components/feed-results-list";
import { FeedSearchInput } from "@/app/feed/components/feed-search-input";
import { FeedSummary } from "@/app/feed/components/feed-summary";
import { useFeedSummary } from "@/app/feed/hooks/use-feed-summary";
import { Button } from "@/components/ui/button";
import { getEnvPublicConfig } from "@/config/env.public";
import { feedItemMatchesQuery } from "@/lib/feed";
import type { FeedItem } from "@/lib/services/feed.service";

const PAGE_SIZE = 20;

function mergeFeedItems(
  currentItems: FeedItem[],
  nextItems: FeedItem[],
): FeedItem[] {
  const mergedById = new Map(currentItems.map((item) => [item.id, item]));
  for (const item of nextItems) {
    mergedById.set(item.id, item);
  }

  return Array.from(mergedById.values()).sort(
    (a, b) =>
      new Date(b.activityAt).getTime() - new Date(a.activityAt).getTime(),
  );
}

export function FeedList() {
  const t = useTranslations("App.Feed");
  const {
    items: initialItems,
    jobsCursor: initialJobsCursor,
    tasksCursor: initialTasksCursor,
    hasMore: initialHasMore,
  } = useFeedData();
  const [items, setItems] = useState(initialItems);
  const [jobsCursor, setJobsCursor] = useState<string | null>(
    initialJobsCursor,
  );
  const [tasksCursor, setTasksCursor] = useState<string | null>(
    initialTasksCursor,
  );
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [isPending, startTransition] = useTransition();
  const [queryParam, setQueryParam] = useQueryState("query", {
    defaultValue: "",
  });
  const [searchValue, setSearchValue] = useState<string>(queryParam);

  useEffect(() => {
    setItems(initialItems);
    setJobsCursor(initialJobsCursor);
    setTasksCursor(initialTasksCursor);
    setHasMore(initialHasMore);
    setVisibleCount(PAGE_SIZE);
  }, [initialHasMore, initialItems, initialJobsCursor, initialTasksCursor]);

  useEffect(() => {
    setSearchValue(queryParam);
  }, [queryParam]);

  const debouncedSetQuery = useDebouncedCallback(
    (next: string) => setQueryParam(next),
    getEnvPublicConfig().NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME,
  );

  const topFiveItems = useMemo(() => items.slice(0, 5), [items]);
  const fallbackBullets = topFiveItems.map((item) => {
    const fallbackName =
      item.type === "job" ? t("untitledJob") : t("untitledTask");
    return item.displayTitle?.trim() || fallbackName;
  });
  const feedSummary = useFeedSummary(topFiveItems);
  const filteredItems = useMemo(() => {
    const query = searchValue.trim();
    return items.filter((item) => feedItemMatchesQuery(item, query));
  }, [items, searchValue]);
  const visibleItems = filteredItems.slice(0, visibleCount);
  const hasHiddenLoadedItems = visibleCount < filteredItems.length;

  function handleInputChange(next: string) {
    setSearchValue(next);
    debouncedSetQuery(next);
  }

  function handleClearSearch() {
    debouncedSetQuery.cancel();
    setSearchValue("");
    setQueryParam("");
  }

  function handleLoadMore() {
    if (hasHiddenLoadedItems) {
      setVisibleCount((prev) => prev + PAGE_SIZE);
      return;
    }

    if (!hasMore || isPending) {
      return;
    }

    startTransition(async () => {
      const nextPage = await loadMoreFeed({ jobsCursor, tasksCursor });
      setItems((prev) => mergeFeedItems(prev, nextPage.items));
      setJobsCursor(nextPage.jobsCursor);
      setTasksCursor(nextPage.tasksCursor);
      setHasMore(nextPage.hasMore);
      setVisibleCount((prev) => prev + PAGE_SIZE);
    });
  }

  return (
    <div className="w-full space-y-5 px-2">
      <FeedSummary
        title={t("aiInsights")}
        summaryDescription={t("summaryDescription")}
        summary={feedSummary.summary ?? t("summaryDescription")}
        bullets={
          feedSummary.bullets.length > 0 ? feedSummary.bullets : fallbackBullets
        }
        isGenerating={feedSummary.isGenerating}
        shouldAnimateStream={feedSummary.shouldAnimateStream}
        generatingLabel={t("generating")}
        errorLabel={t("generationError")}
        hasError={feedSummary.hasError}
      />
      <FeedSearchInput
        placeholder={t("search")}
        clearLabel={t("clearSearch")}
        value={searchValue}
        onValueChange={handleInputChange}
        onClear={handleClearSearch}
      />
      <FeedResultsList emptyLabel={t("emptyState")} items={visibleItems} />
      {hasMore || hasHiddenLoadedItems ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={handleLoadMore}
            disabled={isPending}
          >
            {isPending ? t("loadingMore") : t("loadMore")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
